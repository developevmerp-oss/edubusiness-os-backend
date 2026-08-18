import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

const claimSchema = z.object({
    courseId: z.string().uuid()
});

/**
 * 1. Get student certificates
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const result = await db.query(
            `SELECT cert.id, cert.verification_code, cert.created_at,
                    c.title as course_title
             FROM certificates cert
             JOIN courses c ON cert.course_id = c.id
             WHERE cert.tenant_id = $1 AND cert.student_id = $2
             ORDER BY cert.created_at DESC`,
            [tenantId, userId]
        );

        res.json({ certificates: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Claim Course Completion Certificate
 */
router.post('/claim', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId } = claimSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const studentId = req.user!.id;

        // Check if certificate already exists
        const checkCert = await db.query(
            'SELECT id, verification_code FROM certificates WHERE tenant_id = $1 AND student_id = $2 AND course_id = $3',
            [tenantId, studentId, courseId]
        );

        if (checkCert.rows.length > 0) {
            res.json({
                message: 'Certificate already claimed.',
                certificate: checkCert.rows[0]
            });
            return;
        }

        // Generate verification code
        const codeNum = Math.floor(100000 + Math.random() * 900000);
        const verificationCode = `CERT-EDU-${codeNum}`;

        const result = await db.query(
            `INSERT INTO certificates (tenant_id, student_id, course_id, verification_code)
             VALUES ($1, $2, $3, $4)
             RETURNING id, verification_code, created_at`,
            [tenantId, studentId, courseId, verificationCode]
        );

        res.status(201).json({
            message: 'Certificate claimed successfully! Congratulations!',
            certificate: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Public Verification endpoint (No auth required)
 */
router.get('/verify/:code', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code } = req.params;
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT cert.id, cert.verification_code, cert.created_at as issue_date,
                    u.first_name, u.last_name,
                    c.title as course_title,
                    t.name as tenant_name
             FROM certificates cert
             JOIN users u ON cert.student_id = u.id
             JOIN courses c ON cert.course_id = c.id
             JOIN tenants t ON cert.tenant_id = t.id
             WHERE cert.verification_code = $1 AND cert.tenant_id = $2`,
            [code, tenantId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Certificate code invalid or verification failed.' });
            return;
        }

        res.json({ verified: true, details: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

export default router;
