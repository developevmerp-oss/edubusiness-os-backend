import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const markAttendanceSchema = z.object({
    batchId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    records: z.array(
        z.object({
            studentId: z.string(),
            status: z.enum(['present', 'absent', 'late', 'excused']),
            remarks: z.string().optional()
        })
    )
});

/**
 * 1. Mark attendance for a list of students in a batch (Admin/Teacher only)
 */
router.post('/', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const body = markAttendanceSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        // Verify batch exists under tenant
        const batchCheck = await client.query('SELECT id, teacher_id FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, body.batchId]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found.' });
            return;
        }

        // Teachers can only mark attendance for their own batches
        if (req.user!.role === 'teacher' && batchCheck.rows[0].teacher_id !== userId) {
            res.status(403).json({ error: 'You are not assigned to mark attendance for this batch.' });
            return;
        }

        await client.query('BEGIN');

        for (const record of body.records) {
            // Check student enrollment in batch
            const enrollmentCheck = await client.query(
                'SELECT student_id FROM batch_students WHERE batch_id = $1 AND student_id = $2',
                [body.batchId, record.studentId]
            );

            if (enrollmentCheck.rows.length === 0) {
                // Ignore students not in batch to prevent invalid records injection
                continue;
            }

            await client.query(
                `INSERT INTO attendance (tenant_id, batch_id, student_id, date, status, remarks, marked_by, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
                 ON CONFLICT (batch_id, student_id, date) DO UPDATE
                 SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by, updated_at = CURRENT_TIMESTAMP`,
                [tenantId, body.batchId, record.studentId, body.date, record.status, record.remarks || null, userId]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Attendance marked successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 2. Get batch attendance for a specific date (Admin/Teacher only)
 */
router.get('/batch/:batchId', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { batchId } = req.params;
        const date = req.query.date as string;
        const tenantId = req.tenant!.id;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.status(400).json({ error: 'Invalid or missing date parameter (YYYY-MM-DD).' });
            return;
        }

        // Verify batch exists
        const batchCheck = await db.query('SELECT id FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, batchId]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found.' });
            return;
        }

        // Fetch students and their attendance status for that date
        const result = await db.query(
            `SELECT u.id as student_id, u.first_name, u.last_name, u.email,
                    a.status, a.remarks, a.date
             FROM batch_students bs
             JOIN users u ON bs.student_id = u.id
             LEFT JOIN attendance a ON bs.batch_id = a.batch_id AND bs.student_id = a.student_id AND a.date = $2
             WHERE bs.batch_id = $1
             ORDER BY u.first_name ASC`,
            [batchId, date]
        );

        res.json({ attendance: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Get attendance history for a student
 */
router.get('/student/:studentId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { studentId } = req.params;
        const tenantId = req.tenant!.id;
        const user = req.user!;

        // Security check:
        // - Students can only query their own attendance
        // - Parents can only query their children's attendance
        if (user.role === 'student' && user.id !== studentId) {
            res.status(403).json({ error: 'Access denied. You can only view your own attendance.' });
            return;
        }

        if (user.role === 'parent') {
            const relationshipCheck = await db.query(
                'SELECT 1 FROM parents_students WHERE parent_id = $1 AND student_id = $2',
                [user.id, studentId]
            );
            if (relationshipCheck.rows.length === 0) {
                res.status(403).json({ error: "Access denied. You can only view your children's attendance." });
                return;
            }
        }

        const result = await db.query(
            `SELECT a.id, a.date, a.status, a.remarks, b.name as batch_name
             FROM attendance a
             JOIN batches b ON a.batch_id = b.id
             WHERE a.tenant_id = $1 AND a.student_id = $2
             ORDER BY a.date DESC`,
            [tenantId, studentId]
        );

        res.json({ attendance: result.rows });
    } catch (error) {
        next(error);
    }
});

export default router;
