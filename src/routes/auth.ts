import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { authenticate, AUTH_COOKIE_NAME, requireRole } from '../middlewares/auth';
import { CSRF_COOKIE_NAME } from '../middlewares/csrf';

const router = Router();
const SALT_ROUNDS = 10;

// Validations
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8)
});

const registerTenantSchema = z.object({
    tenantName: z.string().min(2),
    subdomain: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Subdomain must be alphanumeric with dashes'),
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1)
});

const createUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    role: z.enum(['admin', 'teacher', 'student', 'parent']),
    phone: z.string().optional()
});

/**
 * 1. Register a new tenant organization + Admin user
 */
router.post('/register-tenant', async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const body = registerTenantSchema.parse(req.body);
        const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);

        await client.query('BEGIN');

        // Check if subdomain is taken
        const tenantCheck = await client.query('SELECT id FROM tenants WHERE subdomain = $1', [body.subdomain]);
        if (tenantCheck.rows.length > 0) {
            res.status(400).json({ error: 'Subdomain is already taken' });
            await client.query('ROLLBACK');
            return;
        }

        // Create Tenant
        const tenantRes = await client.query(
            'INSERT INTO tenants (name, subdomain) VALUES ($1, $2) RETURNING id, name, subdomain, branding',
            [body.tenantName, body.subdomain]
        );
        const tenant = tenantRes.rows[0];

        // Create Admin User
        const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role)
             VALUES ($1, $2, $3, $4, $5, 'admin')
             RETURNING id, email, first_name, last_name, role`,
            [tenant.id, body.email, passwordHash, body.firstName, body.lastName]
        );
        const user = userRes.rows[0];

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Tenant and Admin created successfully',
            tenant,
            user
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 2. Login User
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password } = loginSchema.parse(req.body);
        const tenant = req.tenant;

        if (!tenant) {
            res.status(400).json({ error: 'Tenant context is missing.' });
            return;
        }

        // Retrieve user under the current tenant context
        const result = await db.query(
            'SELECT id, email, password_hash, first_name, last_name, role, status FROM users WHERE tenant_id = $1 AND email = $2',
            [tenant.id, email]
        );

        if (result.rows.length === 0) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const user = result.rows[0];

        if (user.status !== 'active') {
            res.status(403).json({ error: 'Your account has been deactivated.' });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        // Generate JWT token
        const payload = {
            id: user.id,
            tenant_id: tenant.id,
            email: user.email,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name
        };

        const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });

        // Set token cookie
        res.cookie(AUTH_COOKIE_NAME, token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role
            },
            tenant
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Logout User
 */
router.post('/logout', (req: Request, res: Response) => {
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
    res.json({ message: 'Logged out successfully' });
});

/**
 * 4. Get Current User Profile
 */
router.get('/me', authenticate, (req: Request, res: Response) => {
    res.json({
        user: req.user,
        tenant: req.tenant
    });
});

/**
 * 5. Create a user (Admin only)
 */
router.post('/users', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = createUserSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const passwordHash = await bcrypt.hash(body.password, SALT_ROUNDS);

        const result = await db.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, phone)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, email, first_name, last_name, role, phone, status`,
            [tenantId, body.email, passwordHash, body.firstName, body.lastName, body.role, body.phone || null]
        );

        res.status(201).json({
            message: 'User created successfully',
            user: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Get all users (Admin/Teacher view)
 */
router.get('/users', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const roleFilter = req.query.role as string;

        let query = 'SELECT id, email, first_name, last_name, role, phone, status, created_at FROM users WHERE tenant_id = $1';
        const params: any[] = [tenantId];

        if (roleFilter) {
            query += ' AND role = $2';
            params.push(roleFilter);
        }

        query += ' ORDER BY first_name ASC';

        const result = await db.query(query, params);
        res.json({ users: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 7. Map Parent to Student (Admin only)
 */
router.post('/parents-students', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { parentId, studentId } = z.object({
            parentId: z.string().uuid(),
            studentId: z.string().uuid()
        }).parse(req.body);

        // Check if both users exist and belong to the same tenant
        const userCheck = await db.query(
            'SELECT id, role, tenant_id FROM users WHERE id IN ($1, $2)',
            [parentId, studentId]
        );

        if (userCheck.rows.length !== 2) {
            res.status(400).json({ error: 'One or both users do not exist.' });
            return;
        }

        const tenantId = req.tenant!.id;
        for (const row of userCheck.rows) {
            if (row.tenant_id !== tenantId) {
                res.status(403).json({ error: 'Users do not belong to this organization.' });
                return;
            }
        }

        await db.query(
            'INSERT INTO parents_students (parent_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [parentId, studentId]
        );

        res.json({ message: 'Parent-Student mapping completed successfully.' });
    } catch (error) {
        next(error);
    }
});

export default router;
