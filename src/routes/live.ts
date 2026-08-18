import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const liveClassSchema = z.object({
    batchId: z.string().uuid(),
    title: z.string().min(2),
    topic: z.string().optional(),
    meetingLink: z.string().url().optional(),
    provider: z.enum(['zoom', 'google_meet', 'jitsi', 'custom']).default('jitsi'),
    scheduledAt: z.string().datetime(), // ISO datetime string
    durationMinutes: z.number().int().positive().default(60)
});

/**
 * 1. Get live classes for a batch (accessible by everyone mapped to batch)
 */
router.get('/batch/:batchId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { batchId } = req.params;
        const tenantId = req.tenant!.id;
        const user = req.user!;

        // Security check: Verify enrollment or association to the batch
        if (user.role === 'student') {
            const enrollCheck = await db.query(
                'SELECT 1 FROM batch_students WHERE batch_id = $1 AND student_id = $2',
                [batchId, user.id]
            );
            if (enrollCheck.rows.length === 0) {
                res.status(403).json({ error: 'Access denied. You are not enrolled in this batch.' });
                return;
            }
        } else if (user.role === 'teacher') {
            const batchCheck = await db.query(
                'SELECT 1 FROM batches WHERE id = $1 AND teacher_id = $2',
                [batchId, user.id]
            );
            if (batchCheck.rows.length === 0) {
                res.status(403).json({ error: 'Access denied. You are not assigned to this batch.' });
                return;
            }
        } else if (user.role === 'parent') {
            const parentCheck = await db.query(
                `SELECT 1 FROM batch_students bs
                 JOIN parents_students ps ON bs.student_id = ps.student_id
                 WHERE bs.batch_id = $1 AND ps.parent_id = $2`,
                [batchId, user.id]
            );
            if (parentCheck.rows.length === 0) {
                res.status(403).json({ error: "Access denied. Your child is not enrolled in this batch." });
                return;
            }
        }

        const result = await db.query(
            `SELECT id, title, topic, meeting_link, provider, scheduled_at, duration_minutes 
             FROM live_classes 
             WHERE tenant_id = $1 AND batch_id = $2
             ORDER BY scheduled_at ASC`,
            [tenantId, batchId]
        );

        res.json({ liveClasses: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create Live Class (Admin/Teacher only)
 */
router.post('/', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = liveClassSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify batch ownership
        const batchCheck = await db.query('SELECT id, teacher_id FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, body.batchId]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Selected batch does not exist.' });
            return;
        }

        // If teacher, they must be assigned to this batch
        if (req.user!.role === 'teacher' && batchCheck.rows[0].teacher_id !== req.user!.id) {
            res.status(403).json({ error: 'You are not authorized to schedule live classes for this batch.' });
            return;
        }

        // Auto-generate Jitsi link if meetingLink is empty
        let finalMeetingLink = body.meetingLink;
        if (!finalMeetingLink && body.provider === 'jitsi') {
            const cleanTitle = body.title.toLowerCase().replace(/[^a-z0-9]/g, '-');
            finalMeetingLink = `https://meet.jit.si/edubusiness-${tenantId.slice(0,8)}-${cleanTitle}`;
        } else if (!finalMeetingLink) {
            res.status(400).json({ error: 'Meeting link is required unless Jitsi provider is chosen.' });
            return;
        }

        const result = await db.query(
            `INSERT INTO live_classes (tenant_id, batch_id, title, topic, meeting_link, provider, scheduled_at, duration_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, topic, meeting_link, provider, scheduled_at, duration_minutes`,
            [tenantId, body.batchId, body.title, body.topic || null, finalMeetingLink, body.provider, body.scheduledAt, body.durationMinutes]
        );

        res.status(201).json({
            message: 'Live lecture scheduled successfully',
            liveClass: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Cancel Live Class (Admin/Teacher only)
 */
router.delete('/:id', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Verify ownership
        const liveCheck = await db.query(
            `SELECT l.id, b.teacher_id FROM live_classes l
             JOIN batches b ON l.batch_id = b.id
             WHERE l.id = $1 AND l.tenant_id = $2`,
            [id, tenantId]
        );

        if (liveCheck.rows.length === 0) {
            res.status(404).json({ error: 'Live class not found.' });
            return;
        }

        if (req.user!.role === 'teacher' && liveCheck.rows[0].teacher_id !== req.user!.id) {
            res.status(403).json({ error: 'Access denied. You did not schedule this live class.' });
            return;
        }

        await db.query('DELETE FROM live_classes WHERE id = $1', [id]);
        res.json({ message: 'Live class cancelled successfully.' });
    } catch (error) {
        next(error);
    }
});

export default router;
