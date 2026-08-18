import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const sectionSchema = z.object({
    title: z.string().min(2),
    sortOrder: z.number().int().default(0)
});

const materialSchema = z.object({
    title: z.string().min(2),
    type: z.enum(['video', 'pdf', 'notes', 'link']),
    url: z.string().url(),
    sortOrder: z.number().int().default(0)
});

/**
 * 1. Get all sections and materials for a course
 */
router.get('/courses/:courseId/sections', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId } = req.params;
        const tenantId = req.tenant!.id;

        // Verify course belongs to tenant
        const courseCheck = await db.query('SELECT id FROM courses WHERE id = $1 AND tenant_id = $2', [courseId, tenantId]);
        if (courseCheck.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        // Fetch sections
        const sectionsRes = await db.query(
            'SELECT id, title, sort_order FROM course_sections WHERE course_id = $1 ORDER BY sort_order ASC, created_at ASC',
            [courseId]
        );

        const sections = sectionsRes.rows;

        // Fetch all materials for these sections
        for (const sec of sections) {
            const materialsRes = await db.query(
                'SELECT id, title, type, url, sort_order FROM course_materials WHERE section_id = $1 ORDER BY sort_order ASC, created_at ASC',
                [sec.id]
            );
            sec.materials = materialsRes.rows;
        }

        res.json({ sections });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create Section (Admin/Teacher only)
 */
router.post('/courses/:courseId/sections', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId } = req.params;
        const body = sectionSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify course exists under tenant
        const courseCheck = await db.query('SELECT id FROM courses WHERE id = $1 AND tenant_id = $2', [courseId, tenantId]);
        if (courseCheck.rows.length === 0) {
            res.status(404).json({ error: 'Course not found' });
            return;
        }

        const result = await db.query(
            `INSERT INTO course_sections (course_id, title, sort_order)
             VALUES ($1, $2, $3)
             RETURNING id, title, sort_order, created_at`,
            [courseId, body.title, body.sortOrder]
        );

        res.status(201).json({
            message: 'Section created successfully',
            section: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Create Material under Section (Admin/Teacher only)
 */
router.post('/courses/sections/:sectionId/materials', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sectionId } = req.params;
        const body = materialSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify section belongs to a course owned by the tenant
        const sectionCheck = await db.query(
            `SELECT cs.id FROM course_sections cs
             JOIN courses c ON cs.course_id = c.id
             WHERE cs.id = $1 AND c.tenant_id = $2`,
            [sectionId, tenantId]
        );

        if (sectionCheck.rows.length === 0) {
            res.status(404).json({ error: 'Section not found' });
            return;
        }

        const result = await db.query(
            `INSERT INTO course_materials (section_id, title, type, url, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, title, type, url, sort_order, created_at`,
            [sectionId, body.title, body.type, body.url, body.sortOrder]
        );

        res.status(201).json({
            message: 'Material added successfully',
            material: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Delete Material (Admin/Teacher only)
 */
router.delete('/courses/sections/materials/:id', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Verify material belongs to tenant course section
        const materialCheck = await db.query(
            `SELECT cm.id FROM course_materials cm
             JOIN course_sections cs ON cm.section_id = cs.id
             JOIN courses c ON cs.course_id = c.id
             WHERE cm.id = $1 AND c.tenant_id = $2`,
            [id, tenantId]
        );

        if (materialCheck.rows.length === 0) {
            res.status(404).json({ error: 'Material not found.' });
            return;
        }

        await db.query('DELETE FROM course_materials WHERE id = $1', [id]);
        res.json({ message: 'Material deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Delete Section (Admin/Teacher only)
 */
router.delete('/courses/sections/:id', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const sectionCheck = await db.query(
            `SELECT cs.id FROM course_sections cs
             JOIN courses c ON cs.course_id = c.id
             WHERE cs.id = $1 AND c.tenant_id = $2`,
            [id, tenantId]
        );

        if (sectionCheck.rows.length === 0) {
            res.status(404).json({ error: 'Section not found.' });
            return;
        }

        await db.query('DELETE FROM course_sections WHERE id = $1', [id]);
        res.json({ message: 'Section and all its materials deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

export default router;
