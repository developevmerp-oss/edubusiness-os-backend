import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

const createDoubtSchema = z.object({
    subject: z.string().min(2),
    title: z.string().min(3),
    description: z.string().min(10),
    courseId: z.string().uuid(),
    batchId: z.string().uuid().optional(),
    attachmentUrl: z.string().url().optional().or(z.literal(''))
});

const resolveDoubtSchema = z.object({
    resolutionNotes: z.string().min(5),
    isPublicFaq: z.boolean().default(false)
});

/**
 * 1. Fetch Doubts
 * - Students: see their doubts + public resolved FAQs
 * - Teachers/Admins: see all doubts with status filter
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;
        const { status, subject } = req.query;

        let query = '';
        let params: any[] = [];

        if (user.role === 'student') {
            query = `
                SELECT d.*, c.title as course_title,
                       u.first_name as student_first_name, u.last_name as student_last_name,
                       t.first_name as teacher_first_name, t.last_name as teacher_last_name
                FROM doubts d
                JOIN courses c ON d.course_id = c.id
                JOIN users u ON d.student_id = u.id
                LEFT JOIN users t ON d.assigned_to = t.id
                WHERE d.tenant_id = $1 AND (d.student_id = $2 OR d.is_public_faq = TRUE)
            `;
            params = [tenantId, user.id];

            if (status) {
                params.push(status);
                query += ` AND d.status = $${params.length}`;
            }
            if (subject) {
                params.push(subject);
                query += ` AND d.subject = $${params.length}`;
            }

            query += ` ORDER BY d.created_at DESC`;
        } else {
            // Teacher / Admin
            query = `
                SELECT d.*, c.title as course_title,
                       u.first_name as student_first_name, u.last_name as student_last_name,
                       t.first_name as teacher_first_name, t.last_name as teacher_last_name
                FROM doubts d
                JOIN courses c ON d.course_id = c.id
                JOIN users u ON d.student_id = u.id
                LEFT JOIN users t ON d.assigned_to = t.id
                WHERE d.tenant_id = $1
            `;
            params = [tenantId];

            if (status) {
                params.push(status);
                query += ` AND d.status = $${params.length}`;
            }
            if (subject) {
                params.push(subject);
                query += ` AND d.subject = $${params.length}`;
            }

            query += ` ORDER BY d.created_at DESC`;
        }

        const result = await db.query(query, params);
        res.json({ doubts: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create Doubt Ticket (Student only or Admin on behalf)
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { subject, title, description, courseId, batchId, attachmentUrl } = createDoubtSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const studentId = req.user!.id;

        // Auto-assign to course creator or head teacher if available
        const courseTeacherRes = await db.query(
            'SELECT created_by FROM courses WHERE id = $1 AND tenant_id = $2',
            [courseId, tenantId]
        );
        const assignedTo = courseTeacherRes.rows[0]?.created_by || null;

        const result = await db.query(`
            INSERT INTO doubts (tenant_id, student_id, course_id, batch_id, subject, title, description, attachment_url, assigned_to, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
            RETURNING *
        `, [tenantId, studentId, courseId, batchId || null, subject, title, description, attachmentUrl || null, assignedTo]);

        res.status(201).json({
            message: 'Doubt ticket submitted successfully.',
            doubt: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Resolve Doubt Ticket (Teacher / Admin only)
 */
router.patch('/:id/resolve', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user!;
        if (user.role === 'student' || user.role === 'parent') {
            res.status(403).json({ error: 'Only teachers or admins can resolve doubt tickets.' });
            return;
        }

        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const { resolutionNotes, isPublicFaq } = resolveDoubtSchema.parse(req.body);

        const result = await db.query(`
            UPDATE doubts
            SET status = 'resolved',
                resolution_notes = $1,
                is_public_faq = $2,
                resolved_at = CURRENT_TIMESTAMP,
                assigned_to = COALESCE(assigned_to, $3)
            WHERE id = $4 AND tenant_id = $5
            RETURNING *
        `, [resolutionNotes, isPublicFaq, user.id, id, tenantId]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Doubt ticket not found.' });
            return;
        }

        res.json({
            message: 'Doubt resolved successfully.',
            doubt: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

export default router;
