import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const examSchema = z.object({
    title: z.string().min(2),
    description: z.string().optional(),
    durationMinutes: z.number().int().positive(),
    totalMarks: z.number().positive(),
    negativeMarks: z.number().nonnegative().default(0),
    isPublished: z.boolean().default(false)
});

const questionSchema = z.object({
    type: z.enum(['mcq', 'true_false', 'fill_blank', 'descriptive']),
    questionText: z.string().min(2),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string(),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    explanation: z.string().optional()
});

/**
 * 1. Get all exams
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        let query = 'SELECT id, title, description, duration_minutes, total_marks, negative_marks, is_published, created_at FROM exams WHERE tenant_id = $1';
        const params: any[] = [tenantId];

        if (user.role === 'student' || user.role === 'parent') {
            query += ' AND is_published = TRUE';
        }

        query += ' ORDER BY created_at DESC';

        const result = await db.query(query, params);
        res.json({ exams: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get exam details (no answers included for students unless they have finished)
 */
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            'SELECT id, title, description, duration_minutes, total_marks, negative_marks, is_published FROM exams WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Exam not found.' });
            return;
        }

        res.json({ exam: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Create Exam (Admin/Teacher only)
 */
router.post('/', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = examSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `INSERT INTO exams (tenant_id, title, description, duration_minutes, total_marks, negative_marks, is_published)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, title, description, duration_minutes, total_marks, negative_marks, is_published`,
            [tenantId, body.title, body.description || null, body.durationMinutes, body.totalMarks, body.negativeMarks, body.isPublished]
        );

        res.status(201).json({
            message: 'Exam created successfully',
            exam: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Add Question to Exam (Admin/Teacher only)
 */
router.post('/:id/questions', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const body = questionSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify exam belongs to tenant
        const examCheck = await db.query('SELECT id FROM exams WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (examCheck.rows.length === 0) {
            res.status(404).json({ error: 'Exam not found.' });
            return;
        }

        const result = await db.query(
            `INSERT INTO questions (tenant_id, exam_id, type, question_text, options, correct_answer, difficulty, explanation)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, type, question_text, options, difficulty`,
            [
                tenantId,
                id,
                body.type,
                body.questionText,
                body.options ? JSON.stringify(body.options) : null,
                body.correctAnswer,
                body.difficulty,
                body.explanation || null
            ]
        );

        res.status(201).json({
            message: 'Question added successfully',
            question: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Get Questions inside Exam (anti-cheat: hide correct answers from students)
 */
router.get('/:id/questions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const user = req.user!;

        // Verify exam
        const examCheck = await db.query('SELECT id, is_published FROM exams WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (examCheck.rows.length === 0) {
            res.status(404).json({ error: 'Exam not found.' });
            return;
        }

        let selectFields = 'id, type, question_text, options, difficulty';
        // Only teachers and admins get correct answers and explanations directly
        if (user.role === 'admin' || user.role === 'teacher') {
            selectFields += ', correct_answer, explanation';
        }

        const result = await db.query(
            `SELECT ${selectFields} FROM questions WHERE exam_id = $1 ORDER BY created_at ASC`,
            [id]
        );

        res.json({ questions: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Start timed attempt (Students only)
 */
router.post('/:id/attempt', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const studentId = req.user!.id;

        // Verify exam is published
        const examRes = await db.query('SELECT id, is_published FROM exams WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (examRes.rows.length === 0 || !examRes.rows[0].is_published) {
            res.status(400).json({ error: 'This exam is not available.' });
            return;
        }

        // Check if student has an active ongoing attempt or has already submitted
        const attemptRes = await db.query(
            'SELECT id, status, started_at FROM exam_attempts WHERE exam_id = $1 AND student_id = $2',
            [id, studentId]
        );

        if (attemptRes.rows.length > 0) {
            const attempt = attemptRes.rows[0];
            if (attempt.status === 'ongoing') {
                res.json({ message: 'Resuming ongoing attempt.', attemptId: attempt.id, startedAt: attempt.started_at });
                return;
            } else {
                res.status(400).json({ error: 'You have already submitted this exam.' });
                return;
            }
        }

        // Create new attempt
        const result = await db.query(
            'INSERT INTO exam_attempts (exam_id, student_id, started_at, status) VALUES ($1, $2, CURRENT_TIMESTAMP, \'ongoing\') RETURNING id, started_at',
            [id, studentId]
        );

        res.status(210).json({
            message: 'Attempt initialized successfully.',
            attemptId: result.rows[0].id,
            startedAt: result.rows[0].started_at
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 7. Save student intermediate answer state (Students only)
 */
router.post('/attempts/:attemptId/save', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { attemptId } = req.params;
        const { questionId, selectedAnswer } = z.object({
            questionId: z.string().uuid(),
            selectedAnswer: z.string()
        }).parse(req.body);

        // Verify attempt belongs to student and is ongoing
        const attemptCheck = await db.query(
            'SELECT id, status FROM exam_attempts WHERE id = $1 AND student_id = $2',
            [attemptId, req.user!.id]
        );

        if (attemptCheck.rows.length === 0 || attemptCheck.rows[0].status !== 'ongoing') {
            res.status(400).json({ error: 'No active attempt session found.' });
            return;
        }

        // Record or Update Answer
        await db.query(
            `INSERT INTO exam_answers (attempt_id, question_id, selected_answer)
             VALUES ($1, $2, $3)
             ON CONFLICT (attempt_id, question_id) DO UPDATE
             SET selected_answer = EXCLUDED.selected_answer`,
            [attemptId, questionId, selectedAnswer]
        );

        res.json({ message: 'Answer saved successfully.' });
    } catch (error) {
        next(error);
    }
});

/**
 * 8. Submit and Auto-Grade MCQs (Students only)
 */
router.post('/attempts/:attemptId/submit', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { attemptId } = req.params;
        const studentId = req.user!.id;

        await client.query('BEGIN');

        // Fetch attempt details
        const attemptRes = await client.query(
            `SELECT ea.id, ea.status, e.id as exam_id, e.negative_marks, e.total_marks
             FROM exam_attempts ea
             JOIN exams e ON ea.exam_id = e.id
             WHERE ea.id = $1 AND ea.student_id = $2 FOR UPDATE`,
            [attemptId, studentId]
        );

        if (attemptRes.rows.length === 0 || attemptRes.rows[0].status !== 'ongoing') {
            res.status(400).json({ error: 'Session is inactive or already submitted.' });
            await client.query('ROLLBACK');
            return;
        }

        const { exam_id, negative_marks } = attemptRes.rows[0];

        // Fetch questions correct answers
        const questionsRes = await client.query(
            'SELECT id, type, correct_answer FROM questions WHERE exam_id = $1',
            [exam_id]
        );

        // Fetch student answers
        const answersRes = await client.query(
            'SELECT question_id, selected_answer FROM exam_answers WHERE attempt_id = $1',
            [attemptId]
        );

        const studentAnswersMap = new Map(answersRes.rows.map(a => [a.question_id, a.selected_answer]));
        let totalScore = 0;
        let requiresManualGrading = false;
        
        // Calculate dynamic per-question marks allocation
        const questionCount = questionsRes.rows.length;
        const marksPerQuestion = questionCount > 0 ? parseFloat(attemptRes.rows[0].total_marks) / questionCount : 0;

        for (const q of questionsRes.rows) {
            const selected = studentAnswersMap.get(q.id);
            let isCorrect = false;
            let questionScore = 0.00;

            if (q.type === 'descriptive') {
                requiresManualGrading = true;
                continue; // Descriptive answers require manual grading by teacher
            }

            if (selected) {
                // MCQ, True-False, Fill-Blank check
                isCorrect = selected.trim().toLowerCase() === q.correct_answer.trim().toLowerCase();
                if (isCorrect) {
                    questionScore = marksPerQuestion;
                } else {
                    questionScore = -parseFloat(negative_marks);
                }
            }

            totalScore += questionScore;

            // Log details inside answers table
            await client.query(
                `INSERT INTO exam_answers (attempt_id, question_id, selected_answer, is_correct, marks_obtained)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (attempt_id, question_id) DO UPDATE
                 SET is_correct = EXCLUDED.is_correct, marks_obtained = EXCLUDED.marks_obtained`,
                [attemptId, q.id, selected || null, isCorrect, questionScore]
            );
        }

        const finalStatus = requiresManualGrading ? 'completed' : 'graded';

        // Update Exam Attempt score
        await client.query(
            `UPDATE exam_attempts 
             SET submitted_at = CURRENT_TIMESTAMP, score = $1, status = $2
             WHERE id = $3`,
            [totalScore, finalStatus, attemptId]
        );

        await client.query('COMMIT');
        res.json({ message: 'Exam submitted successfully.', score: totalScore, status: finalStatus });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 9. Get attempt scorecard results
 */
router.get('/attempts/:attemptId/scorecard', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { attemptId } = req.params;
        const tenantId = req.tenant!.id;
        const user = req.user!;

        // Retrieve attempt with exam summary
        const attemptRes = await db.query(
            `SELECT ea.id, ea.started_at, ea.submitted_at, ea.score, ea.status, ea.student_id,
                    e.title as exam_title, e.total_marks, e.negative_marks,
                    u.first_name, u.last_name
             FROM exam_attempts ea
             JOIN exams e ON ea.exam_id = e.id
             JOIN users u ON ea.student_id = u.id
             WHERE ea.id = $1 AND e.tenant_id = $2`,
            [attemptId, tenantId]
        );

        if (attemptRes.rows.length === 0) {
            res.status(404).json({ error: 'Scorecard not found.' });
            return;
        }

        const attempt = attemptRes.rows[0];

        // Security check: Students/Parents can only read their own scorecards
        if (user.role === 'student' && attempt.student_id !== user.id) {
            res.status(403).json({ error: 'Access forbidden.' });
            return;
        }
        if (user.role === 'parent') {
            const relationshipCheck = await db.query(
                'SELECT 1 FROM parents_students WHERE parent_id = $1 AND student_id = $2',
                [user.id, attempt.student_id]
            );
            if (relationshipCheck.rows.length === 0) {
                res.status(403).json({ error: 'Access forbidden.' });
                return;
            }
        }

        // Fetch detailed questions along with selected answers
        const scorecardRes = await db.query(
            `SELECT q.id as question_id, q.type, q.question_text, q.options, q.correct_answer, q.explanation,
                    ea.selected_answer, ea.is_correct, ea.marks_obtained
             FROM questions q
             LEFT JOIN exam_answers ea ON q.id = ea.question_id AND ea.attempt_id = $1
             WHERE q.exam_id = (SELECT exam_id FROM exam_attempts WHERE id = $1)
             ORDER BY q.created_at ASC`,
            [attemptId]
        );

        res.json({
            attempt,
            answers: scorecardRes.rows
        });
    } catch (error) {
        next(error);
    }
});

export default router;
