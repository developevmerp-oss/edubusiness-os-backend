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

        let userResult;
        
        // If subdomain is 'abc' (default fallback) or not present, do a global search by email
        if (!tenant || tenant.subdomain === 'abc') {
            userResult = await db.query(
                `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.role, u.status, u.tenant_id,
                        t.name as tenant_name, t.subdomain as tenant_subdomain, t.branding as tenant_branding
                 FROM users u
                 JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.email = $1`,
                [email]
            );
        } else {
            userResult = await db.query(
                `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.role, u.status, u.tenant_id,
                        t.name as tenant_name, t.subdomain as tenant_subdomain, t.branding as tenant_branding
                 FROM users u
                 JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.tenant_id = $1 AND u.email = $2`,
                [tenant.id, email]
            );
        }

        if (userResult.rows.length === 0) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const user = userResult.rows[0];

        if (user.status !== 'active') {
            res.status(403).json({ error: 'Your account has been deactivated.' });
            return;
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }

        const resolvedTenant = {
            id: user.tenant_id,
            name: user.tenant_name,
            subdomain: user.tenant_subdomain,
            branding: typeof user.tenant_branding === 'string' ? JSON.parse(user.tenant_branding) : user.tenant_branding
        };

        // Generate JWT token
        const payload = {
            id: user.id,
            tenant_id: resolvedTenant.id,
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
            sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
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
            tenant: resolvedTenant
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

/**
 * 7b. Get Linked Students for Parent (Admin & Parent)
 */
router.get('/parents-students/:parentId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { parentId } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, ps.created_at as linked_at
             FROM parents_students ps
             JOIN users u ON ps.student_id = u.id
             WHERE ps.parent_id = $1 AND u.tenant_id = $2
             ORDER BY u.first_name ASC`,
            [parentId, tenantId]
        );

        res.json({ students: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 7c. Remove Parent-Student Link (Admin only)
 */
router.delete('/parents-students/:parentId/:studentId', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { parentId, studentId } = req.params;
        await db.query('DELETE FROM parents_students WHERE parent_id = $1 AND student_id = $2', [parentId, studentId]);
        res.json({ message: 'Parent-Student link removed successfully.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 7d. Update User details (Admin only)
 */
router.put('/users/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const { firstName, lastName, phone, role, email } = z.object({
            firstName: z.string().min(1).optional(),
            lastName: z.string().min(1).optional(),
            phone: z.string().optional().nullable(),
            role: z.enum(['admin', 'teacher', 'student', 'parent']).optional(),
            email: z.string().email().optional()
        }).parse(req.body);

        const checkRes = await db.query('SELECT id FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }

        const result = await db.query(
            `UPDATE users
             SET first_name = COALESCE($1, first_name),
                 last_name = COALESCE($2, last_name),
                 phone = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE phone END,
                 role = COALESCE($4, role),
                 email = COALESCE($5, email)
             WHERE tenant_id = $6 AND id = $7
             RETURNING id, email, first_name, last_name, role, phone, status`,
            [firstName || null, lastName || null, phone !== undefined ? phone : null, role || null, email || null, tenantId, id]
        );

        res.json({ message: 'User updated successfully.', user: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 7e. Toggle User Status (Active / Suspended) (Admin only)
 */
router.patch('/users/:id/status', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const checkRes = await db.query('SELECT id, status FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }

        const newStatus = checkRes.rows[0].status === 'active' ? 'suspended' : 'active';
        const result = await db.query(
            'UPDATE users SET status = $1 WHERE tenant_id = $2 AND id = $3 RETURNING id, status',
            [newStatus, tenantId, id]
        );

        res.json({ message: `User account is now ${newStatus}.`, user: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 7f. Admin Password Reset (Admin only)
 */
router.post('/users/:id/reset-password', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const { newPassword } = z.object({ newPassword: z.string().min(8) }).parse(req.body);

        const checkRes = await db.query('SELECT id FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await db.query('UPDATE users SET password_hash = $1 WHERE tenant_id = $2 AND id = $3', [passwordHash, tenantId, id]);

        res.json({ message: 'Password has been successfully reset.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 7g. Delete User (Admin only)
 */
router.delete('/users/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Prevent self deletion
        if (req.user!.id === id) {
            res.status(400).json({ error: 'You cannot delete your own admin account.' });
            return;
        }

        const checkRes = await db.query('SELECT id FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'User not found.' });
            return;
        }

        // Clean up mappings first
        await db.query('DELETE FROM parents_students WHERE parent_id = $1 OR student_id = $1', [id]);
        await db.query('DELETE FROM batch_students WHERE student_id = $1', [id]);
        await db.query('DELETE FROM users WHERE tenant_id = $1 AND id = $2', [tenantId, id]);

        res.json({ message: 'User account removed successfully.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 8. Send Instant Mobile OTP (Simulated / Gateway ready)
 */
router.post('/send-otp', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phone } = z.object({
            phone: z.string().min(10, 'Valid phone number required')
        }).parse(req.body);

        // Sanitize phone number: strip non-digit characters except +
        const cleanedPhone = phone.trim().replace(/[^\d+]/g, '');

        // Generate 6-digit random code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await db.query(
            `INSERT INTO otp_verifications (phone, otp_code, expires_at)
             VALUES ($1, $2, $3)`,
            [cleanedPhone, otpCode, expiresAt]
        );

        res.json({
            message: `OTP sent successfully to ${cleanedPhone}`,
            demoOtp: otpCode, // For testing & demo verification
            expiresInSeconds: 600
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 9. Verify Mobile OTP and Log In / Provision Student
 */
router.post('/verify-otp', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phone, otp } = z.object({
            phone: z.string().min(10),
            otp: z.string().length(6, 'OTP must be 6 digits')
        }).parse(req.body);

        const cleanedPhone = phone.trim().replace(/[^\d+]/g, '');

        // Validate OTP
        const otpResult = await db.query(
            `SELECT id FROM otp_verifications 
             WHERE phone = $1 AND otp_code = $2 AND expires_at > NOW() AND verified = false
             ORDER BY created_at DESC LIMIT 1`,
            [cleanedPhone, otp]
        );

        if (otpResult.rows.length === 0) {
            res.status(400).json({ error: 'Invalid or expired OTP. Please request a new code.' });
            return;
        }

        // Mark OTP as verified
        await db.query('UPDATE otp_verifications SET verified = true WHERE id = $1', [otpResult.rows[0].id]);

        // Find or provision user
        let userResult = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, u.phone, u.tenant_id,
                    t.name as tenant_name, t.subdomain as tenant_subdomain, t.branding as tenant_branding
             FROM users u
             JOIN tenants t ON u.tenant_id = t.id
             WHERE u.phone = $1 OR u.email = $2 LIMIT 1`,
            [cleanedPhone, `${cleanedPhone.replace('+', '')}@mobile.student`]
        );

        let user;
        let tenantInfo;

        if (userResult.rows.length > 0) {
            user = userResult.rows[0];
            tenantInfo = {
                id: user.tenant_id,
                name: user.tenant_name,
                subdomain: user.tenant_subdomain,
                branding: typeof user.tenant_branding === 'string' ? JSON.parse(user.tenant_branding) : user.tenant_branding
            };
        } else {
            // Auto-provision student with default tenant
            const tenantRes = await db.query('SELECT id, name, subdomain, branding FROM tenants LIMIT 1');
            const tenant = tenantRes.rows[0];
            tenantInfo = {
                id: tenant.id,
                name: tenant.name,
                subdomain: tenant.subdomain,
                branding: typeof tenant.branding === 'string' ? JSON.parse(tenant.branding) : tenant.branding
            };

            const randomPasswordHash = await bcrypt.hash(Math.random().toString(36), SALT_ROUNDS);
            const newUserRes = await db.query(
                `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, phone)
                 VALUES ($1, $2, $3, $4, $5, 'student', $6)
                 RETURNING id, email, first_name, last_name, role, phone`,
                [tenant.id, `${cleanedPhone.replace('+', '')}@mobile.student`, randomPasswordHash, 'Student', cleanedPhone.slice(-4), cleanedPhone]
            );
            user = newUserRes.rows[0];
        }

        // Generate JWT
        const payload = {
            id: user.id,
            tenant_id: tenantInfo.id,
            email: user.email,
            role: user.role,
            first_name: user.first_name,
            last_name: user.last_name
        };

        const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });

        res.cookie(AUTH_COOKIE_NAME, token, {
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000
        });

        res.json({
            message: 'OTP authentication successful',
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                phone: user.phone
            },
            tenant: tenantInfo
        });
    } catch (error) {
        next(error);
    }
});

export default router;



