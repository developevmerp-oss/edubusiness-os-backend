import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const batchSchema = z.object({
    courseId: z.string().uuid(),
    teacherId: z.string().uuid().nullable(),
    name: z.string().min(2),
    schedule: z.array(
        z.object({
            day: z.string(),
            startTime: z.string(),
            endTime: z.string()
        })
    ).optional(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    capacity: z.number().int().positive().optional().nullable(),
    fees: z.number().nonnegative().default(0)
});

/**
 * 1. Get all batches
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        let query = `
            SELECT b.id, b.course_id, b.teacher_id, b.name, b.schedule, b.start_date, b.end_date, b.capacity, b.fees, b.created_at,
                   c.title as course_title,
                   u.first_name as teacher_first_name, u.last_name as teacher_last_name
            FROM batches b
            JOIN courses c ON b.course_id = c.id
            LEFT JOIN users u ON b.teacher_id = u.id
            WHERE b.tenant_id = $1
        `;
        const params: any[] = [tenantId];

        // Filter based on roles
        if (user.role === 'teacher') {
            query += ' AND b.teacher_id = $2';
            params.push(user.id);
        } else if (user.role === 'student') {
            query += ' AND b.id IN (SELECT batch_id FROM batch_students WHERE student_id = $2)';
            params.push(user.id);
        } else if (user.role === 'parent') {
            // Get batches for parent's children
            query += ` AND b.id IN (
                SELECT batch_id FROM batch_students bs
                JOIN parents_students ps ON bs.student_id = ps.student_id
                WHERE ps.parent_id = $2
            )`;
            params.push(user.id);
        }

        query += ' ORDER BY b.created_at DESC';

        const result = await db.query(query, params);
        res.json({ batches: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get batch by ID
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT b.id, b.course_id, b.teacher_id, b.name, b.schedule, b.start_date, b.end_date, b.capacity, b.fees,
                    c.title as course_title,
                    u.first_name as teacher_first_name, u.last_name as teacher_last_name
             FROM batches b
             JOIN courses c ON b.course_id = c.id
             LEFT JOIN users u ON b.teacher_id = u.id
             WHERE b.tenant_id = $1 AND b.id = $2`,
            [tenantId, id]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        res.json({ batch: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Create Batch (Admin only)
 */
router.post('/', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = batchSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify course exists
        const courseRes = await db.query('SELECT id FROM courses WHERE tenant_id = $1 AND id = $2', [tenantId, body.courseId]);
        if (courseRes.rows.length === 0) {
            res.status(400).json({ error: 'Selected course does not exist.' });
            return;
        }

        // Verify teacher exists and has correct role if provided
        if (body.teacherId) {
            const teacherRes = await db.query(
                "SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND role = 'teacher'",
                [tenantId, body.teacherId]
            );
            if (teacherRes.rows.length === 0) {
                res.status(400).json({ error: 'Selected teacher does not exist.' });
                return;
            }
        }

        const result = await db.query(
            `INSERT INTO batches (tenant_id, course_id, teacher_id, name, schedule, start_date, end_date, capacity, fees)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, schedule, start_date, end_date, capacity, fees, created_at`,
            [
                tenantId,
                body.courseId,
                body.teacherId,
                body.name,
                body.schedule ? JSON.stringify(body.schedule) : null,
                body.startDate || null,
                body.endDate || null,
                body.capacity || null,
                body.fees
            ]
        );

        res.status(201).json({
            message: 'Batch created successfully',
            batch: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Enroll Student in Batch (Admin only)
 */
router.post('/:id/students', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { id } = req.params;
        const { studentId } = z.object({ studentId: z.string().min(1, 'Student ID is required') }).parse(req.body);
        const tenantId = req.tenant!.id;

        await client.query('BEGIN');

        // Check if batch exists
        const batchCheck = await client.query('SELECT id, capacity, fees FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found' });
            await client.query('ROLLBACK');
            return;
        }
        const batch = batchCheck.rows[0];

        // Check if student exists and belongs to tenant
        const studentCheck = await client.query(
            "SELECT id FROM users WHERE tenant_id = $1 AND id = $2 AND role = 'student'",
            [tenantId, studentId]
        );
        if (studentCheck.rows.length === 0) {
            res.status(400).json({ error: 'Selected student is not registered under this tenant.' });
            await client.query('ROLLBACK');
            return;
        }

        // Check batch capacity
        const enrollCount = await client.query('SELECT COUNT(*) FROM batch_students WHERE batch_id = $1', [id]);
        const currentEnrollments = parseInt(enrollCount.rows[0].count, 10);
        if (batch.capacity && currentEnrollments >= batch.capacity) {
            res.status(400).json({ error: 'Batch capacity limit reached.' });
            await client.query('ROLLBACK');
            return;
        }

        // Enroll Student
        await client.query(
            'INSERT INTO batch_students (batch_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, studentId]
        );

        // Auto-create fee record for student for this batch
        if (batch.fees > 0) {
            // Set due date to 30 days from now
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            await client.query(
                `INSERT INTO fees (tenant_id, student_id, batch_id, amount_due, due_date, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending')`,
                [tenantId, studentId, id, batch.fees, dueDate.toISOString().split('T')[0]]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Student enrolled and fee scheduled successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 5. Remove Student from Batch (Admin only)
 */
router.delete('/:id/students/:studentId', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id, studentId } = req.params;
        const tenantId = req.tenant!.id;

        // Verify batch ownership
        const batchCheck = await db.query('SELECT id FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        const result = await db.query(
            'DELETE FROM batch_students WHERE batch_id = $1 AND student_id = $2 RETURNING student_id',
            [id, studentId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Student enrollment not found in this batch.' });
            return;
        }

        res.json({ message: 'Student removed from batch successfully.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Get Students enrolled in a batch (Admin/Teacher view)
 */
router.get('/:id/students', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Verify batch exists
        const batchCheck = await db.query('SELECT id FROM batches WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        if (batchCheck.rows.length === 0) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        const result = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, bs.enrolled_at
             FROM batch_students bs
             JOIN users u ON bs.student_id = u.id
             WHERE bs.batch_id = $1 AND u.tenant_id = $2
             ORDER BY u.first_name ASC`,
            [id, tenantId]
        );

        res.json({ students: result.rows });
    } catch (error) {
        next(error);
    }
});

export default router;
