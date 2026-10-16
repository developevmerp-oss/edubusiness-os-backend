import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

const createAssignmentSchema = z.object({
    courseId: z.string().uuid(),
    batchId: z.string().uuid(),
    title: z.string().min(3),
    description: z.string().min(10),
    dueDate: z.string().datetime(),
    totalMarks: z.number().positive().default(100),
    attachmentUrl: z.string().url().optional().or(z.literal(''))
});

const submitAssignmentSchema = z.object({
    submissionContent: z.string().min(5),
    attachmentUrl: z.string().url().optional().or(z.literal(''))
});

const gradeSubmissionSchema = z.object({
    marksObtained: z.number().min(0),
    feedback: z.string().min(2)
});

/**
 * 1. Fetch Assignments
 * - If student: returns assignments for their batches + submission status & marks
 * - If teacher/admin: returns all assignments with submission counts
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        if (user.role === 'student') {
            const query = `
                SELECT a.*, b.name as batch_name, c.title as course_title,
                       s.id as submission_id, s.status as submission_status, 
                       s.marks_obtained, s.feedback, s.submitted_at
                FROM assignments a
                JOIN batches b ON a.batch_id = b.id
                JOIN courses c ON a.course_id = c.id
                JOIN batch_students bs ON bs.batch_id = a.batch_id AND bs.student_id = $1
                LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = $1
                WHERE a.tenant_id = $2
                ORDER BY a.due_date ASC
            `;
            const result = await db.query(query, [user.id, tenantId]);
            res.json({ assignments: result.rows });
        } else {
            // Teacher / Admin
            const query = `
                SELECT a.*, b.name as batch_name, c.title as course_title,
                       (SELECT COUNT(*)::int FROM assignment_submissions WHERE assignment_id = a.id) as submission_count,
                       (SELECT COUNT(*)::int FROM batch_students WHERE batch_id = a.batch_id) as total_students
                FROM assignments a
                JOIN batches b ON a.batch_id = b.id
                JOIN courses c ON a.course_id = c.id
                WHERE a.tenant_id = $1
                ORDER BY a.created_at DESC
            `;
            const result = await db.query(query, [tenantId]);
            res.json({ assignments: result.rows });
        }
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create Assignment (Teacher / Admin only)
 */
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user!;
        if (user.role === 'student' || user.role === 'parent') {
            res.status(403).json({ error: 'Only teachers or administrators can publish assignments.' });
            return;
        }

        const tenantId = req.tenant!.id;
        const { courseId, batchId, title, description, dueDate, totalMarks, attachmentUrl } = createAssignmentSchema.parse(req.body);

        const result = await db.query(`
            INSERT INTO assignments (tenant_id, course_id, batch_id, title, description, due_date, total_marks, attachment_url, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [tenantId, courseId, batchId, title, description, dueDate, totalMarks, attachmentUrl || null, user.id]);

        res.status(201).json({
            message: 'Homework assignment published successfully.',
            assignment: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. View Submissions for an Assignment (Teacher / Admin only)
 */
router.get('/:id/submissions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { id } = req.params;

        const query = `
            SELECT s.*, u.first_name, u.last_name, u.email, u.phone
            FROM assignment_submissions s
            JOIN users u ON s.student_id = u.id
            WHERE s.assignment_id = $1 AND s.tenant_id = $2
            ORDER BY s.submitted_at DESC
        `;
        const result = await db.query(query, [id, tenantId]);
        res.json({ submissions: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Submit Homework (Student only)
 */
router.post('/:id/submit', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user!;
        const tenantId = req.tenant!.id;
        const assignmentId = req.params.id;
        const { submissionContent, attachmentUrl } = submitAssignmentSchema.parse(req.body);

        const result = await db.query(`
            INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submission_content, attachment_url, status, submitted_at)
            VALUES ($1, $2, $3, $4, $5, 'submitted', CURRENT_TIMESTAMP)
            ON CONFLICT (assignment_id, student_id)
            DO UPDATE SET
                submission_content = EXCLUDED.submission_content,
                attachment_url = EXCLUDED.attachment_url,
                submitted_at = CURRENT_TIMESTAMP,
                status = 'submitted'
            RETURNING *
        `, [tenantId, assignmentId, user.id, submissionContent, attachmentUrl || null]);

        res.json({
            message: 'Assignment submitted successfully.',
            submission: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Grade Assignment Submission (Teacher / Admin only)
 */
router.patch('/submissions/:id/grade', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user!;
        if (user.role === 'student' || user.role === 'parent') {
            res.status(403).json({ error: 'Only teachers or administrators can grade assignments.' });
            return;
        }

        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const { marksObtained, feedback } = gradeSubmissionSchema.parse(req.body);

        const result = await db.query(`
            UPDATE assignment_submissions
            SET marks_obtained = $1,
                feedback = $2,
                status = 'graded',
                graded_by = $3,
                graded_at = CURRENT_TIMESTAMP
            WHERE id = $4 AND tenant_id = $5
            RETURNING *
        `, [marksObtained, feedback, user.id, id, tenantId]);

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Submission not found.' });
            return;
        }

        res.json({
            message: 'Submission graded successfully.',
            submission: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

export default router;
