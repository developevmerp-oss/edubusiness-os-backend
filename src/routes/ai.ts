import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const chatSchema = z.object({
    courseId: z.string(),
    message: z.string().min(1)
});

const generateQuestionsSchema = z.object({
    topic: z.string().min(2),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    questionCount: z.number().int().positive().max(10).default(3)
});

const contentSchema = z.object({
    topic: z.string().min(2),
    contentType: z.enum(['lesson_plan', 'notes_summary', 'revision_flashcards'])
});

/**
 * Helper function to call the Gemini API REST endpoint natively using fetch
 */
async function callGemini(prompt: string, jsonResponse: boolean = false): Promise<string> {
    const apiKey = (env as any).GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured in backend .env file.');
    }

    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody: any = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }]
    };

    if (jsonResponse) {
        requestBody.generationConfig = {
            responseMimeType: 'application/json'
        };
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();
    const outputText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!outputText) {
        throw new Error('Empty response received from Gemini API.');
    }

    return outputText;
}

/**
 * 1. AI Student Tutor Chat conversation
 */
router.post('/tutor/chat', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId, message } = chatSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        // Fetch course details for context
        const courseRes = await db.query(
            'SELECT title, description FROM courses WHERE id = $1 AND tenant_id = $2',
            [courseId, tenantId]
        );
        const courseTitle = courseRes.rows[0]?.title || 'Physics Class 12';

        const prompt = `You are a helpful, professional academic AI Tutor for a student enrolled in the course: "${courseTitle}".
Student asks: "${message}"
Provide a clear, detailed explanation. Keep the tone friendly and encouraging.`;

        // Request response from Gemini API
        const aiResponse = await callGemini(prompt);

        // Save conversation
        const result = await db.query(
            `INSERT INTO ai_tutor_chats (tenant_id, user_id, course_id, message, response)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, message, response, created_at`,
            [tenantId, userId, courseId, message, aiResponse]
        );

        res.status(201).json({
            message: 'Tutor response generated.',
            chat: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get tutor chat history logs
 */
router.get('/tutor/chat/:courseId', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId } = req.params;
        const userId = req.user!.id;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT id, message, response, created_at 
             FROM ai_tutor_chats 
             WHERE tenant_id = $1 AND user_id = $2 AND course_id = $3
             ORDER BY created_at ASC`,
            [tenantId, userId, courseId]
        );

        res.json({ chats: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. AI Question Bank Generator using Gemini API
 */
router.post('/exams/generate', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { topic, difficulty, questionCount } = generateQuestionsSchema.parse(req.body);

        const prompt = `You are an expert exam designer. Generate ${questionCount} multiple choice questions (MCQ) on the topic "${topic}" with difficulty "${difficulty}".
Return a JSON array of objects. Do not include markdown code fence formatting. Return ONLY the raw JSON string matching this TypeScript interface structure:
Array<{
  type: "mcq",
  questionText: string,
  options: string[],
  correctAnswer: string,
  difficulty: "easy" | "medium" | "hard",
  explanation: string
}>
Make sure the correct answer is exactly one of the values inside options array.`;

        // Retrieve structured JSON questions from Gemini
        const rawJsonText = await callGemini(prompt, true);
        const questions = JSON.parse(rawJsonText.trim());

        res.json({
            message: 'AI questions generated successfully.',
            questions
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. AI Student Cohort Risk Analysis (Admin/Teacher only)
 */
router.get('/risk/analysis', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        // Pull seeded risk logs with student details
        const result = await db.query(
            `SELECT r.id, r.attendance_percentage, r.average_score, r.risk_level, r.recommendation, r.analyzed_at,
                    u.first_name, u.last_name, u.email
             FROM ai_risk_analyses r
             JOIN users u ON r.student_id = u.id
             WHERE r.tenant_id = $1
             ORDER BY 
                CASE r.risk_level 
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    ELSE 3
                END ASC, r.analyzed_at DESC`,
            [tenantId]
        );

        res.json({ riskAnalysis: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. AI Teacher Content Generator using Gemini API
 */
router.post('/teacher/content', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { topic, contentType } = contentSchema.parse(req.body);

        const prompt = `Create a lesson plan or study guide for the topic "${topic}" with content type "${contentType}".
Format the response using clear Markdown with headers.`;

        const content = await callGemini(prompt);

        res.json({
            message: 'Content generated successfully.',
            content
        });
    } catch (error) {
        next(error);
    }
});

export default router;
