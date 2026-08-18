import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const courseSchema = z.object({
    title: z.string().min(2),
    description: z.string().optional(),
    price: z.number().nonnegative().default(0),
    isPublished: z.boolean().default(false)
});

/**
 * 1. Get all courses
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        let query = 'SELECT id, title, description, price, is_published, created_at FROM courses WHERE tenant_id = $1';
        const params: any[] = [tenantId];

        // Restrict students and parents from viewing unpublished courses
        if (user.role === 'student' || user.role === 'parent') {
            query += ' AND is_published = TRUE';
        }

        query += ' ORDER BY created_at DESC';

        const result = await db.query(query, params);
        res.json({ courses: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get course by ID
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            'SELECT id, title, description, price, is_published, created_at FROM courses WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        res.json({ course: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Create Course (Admin and Teacher)
 */
router.post('/', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = courseSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const result = await db.query(
            `INSERT INTO courses (tenant_id, title, description, price, is_published, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, description, price, is_published, created_at`,
            [tenantId, body.title, body.description || null, body.price, body.isPublished, userId]
        );

        res.status(201).json({
            message: 'Course created successfully',
            course: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Update Course (Admin and Teacher)
 */
router.put('/:id', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const body = courseSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const checkRes = await db.query('SELECT id FROM courses WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        const result = await db.query(
            `UPDATE courses
             SET title = $1, description = $2, price = $3, is_published = $4, updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = $5 AND id = $6
             RETURNING id, title, description, price, is_published, updated_at`,
            [body.title, body.description || null, body.price, body.isPublished, tenantId, id]
        );

        res.json({
            message: 'Course updated successfully',
            course: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4b. Toggle Course Publish Status (Admin and Teacher)
 */
router.patch('/:id/toggle-publish', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const checkRes = await db.query('SELECT id, is_published FROM courses WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (checkRes.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        const newStatus = !checkRes.rows[0].is_published;
        const result = await db.query(
            `UPDATE courses
             SET is_published = $1, updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = $2 AND id = $3
             RETURNING id, title, price, is_published`,
            [newStatus, tenantId, id]
        );

        res.json({
            message: newStatus ? 'Course is now published on the Storefront!' : 'Course unpublished and saved as draft.',
            course: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Delete Course (Admin only)
 */
router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            'DELETE FROM courses WHERE tenant_id = $1 AND id = $2 RETURNING id',
            [tenantId, id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        next(error);
    }
});

export default router;
