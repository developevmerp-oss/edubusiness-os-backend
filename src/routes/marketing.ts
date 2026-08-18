import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const publicLeadSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    courseId: z.string().uuid().optional()
});

const leadStatusSchema = z.object({
    status: z.enum(['new', 'contacted', 'converted', 'closed'])
});

const campaignSchema = z.object({
    title: z.string().min(2),
    triggerType: z.enum(['inactive_7_days', 'course_completed', 'manual']),
    channel: z.enum(['email', 'whatsapp', 'both']),
    messageTemplate: z.string().min(2)
});

/**
 * 1. Public Lead Submission (No auth required)
 */
router.post('/leads', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = publicLeadSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `INSERT INTO leads (tenant_id, name, email, phone, course_id, status)
             VALUES ($1, $2, $3, $4, $5, 'new')
             RETURNING id, name, email, status, created_at`,
            [tenantId, body.name, body.email, body.phone || null, body.courseId || null]
        );

        res.status(201).json({
            message: 'Inquiry submitted successfully. An advisor will contact you shortly.',
            lead: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Get CRM Leads (Admin/Teacher only)
 */
router.get('/leads', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT l.id, l.name, l.email, l.phone, l.status, l.created_at,
                    c.title as course_title
             FROM leads l
             LEFT JOIN courses c ON l.course_id = c.id
             WHERE l.tenant_id = $1
             ORDER BY l.created_at DESC`,
            [tenantId]
        );

        res.json({ leads: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Update Lead Status (Admin/Teacher only)
 */
router.post('/leads/:id/status', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { status } = leadStatusSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Verify lead belongs to tenant
        const leadCheck = await db.query('SELECT id FROM leads WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
        if (leadCheck.rows.length === 0) {
            res.status(404).json({ error: 'Lead profile not found.' });
            return;
        }

        const result = await db.query(
            'UPDATE leads SET status = $1 WHERE id = $2 RETURNING id, status',
            [status, id]
        );

        res.json({
            message: 'Lead status updated.',
            lead: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Get Marketing Campaigns (Admin/Teacher only)
 */
router.get('/campaigns', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            'SELECT id, title, trigger_type, channel, message_template, status, created_at FROM marketing_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC',
            [tenantId]
        );

        res.json({ campaigns: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Create Campaign Template (Admin/Teacher only)
 */
router.post('/campaigns', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = campaignSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `INSERT INTO marketing_campaigns (tenant_id, title, trigger_type, channel, message_template, status)
             VALUES ($1, $2, $3, $4, $5, 'active')
             RETURNING id, title, trigger_type, channel, message_template, status`,
            [tenantId, body.title, body.triggerType, body.channel, body.messageTemplate]
        );

        res.status(201).json({
            message: 'Campaign created successfully.',
            campaign: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Trigger Simulated Campaign Dispatch (Admin/Teacher only)
 */
router.post('/campaigns/:id/trigger', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        // Verify campaign template exists
        const campaignRes = await client.query(
            'SELECT id, title, channel, trigger_type FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (campaignRes.rows.length === 0) {
            res.status(404).json({ error: 'Campaign template not found.' });
            return;
        }

        const campaign = campaignRes.rows[0];

        await client.query('BEGIN');

        // Fetch target audience based on trigger
        let targets: string[] = [];
        if (campaign.trigger_type === 'inactive_7_days') {
            // Find students (we mock warning 3 students)
            const studentsRes = await client.query(
                "SELECT email FROM users WHERE tenant_id = $1 AND role = 'student' LIMIT 3",
                [tenantId]
            );
            targets = studentsRes.rows.map(r => r.email);
        } else if (campaign.trigger_type === 'course_completed') {
            targets = ['completed-student1@abc.com', 'completed-student2@abc.com'];
        } else {
            // manual
            const leadsRes = await client.query(
                "SELECT email FROM leads WHERE tenant_id = $1 LIMIT 5",
                [tenantId]
            );
            targets = leadsRes.rows.map(r => r.email);
        }

        if (targets.length === 0) {
            targets = ['mock-recipient@gmail.com'];
        }

        // Record simulated delivery logs
        for (const email of targets) {
            const channelsToSend = campaign.channel === 'both' ? ['email', 'whatsapp'] : [campaign.channel];
            for (const ch of channelsToSend) {
                await client.query(
                    `INSERT INTO marketing_logs (tenant_id, campaign_id, recipient_email, channel, status)
                     VALUES ($1, $2, $3, $4, 'sent')`,
                    [tenantId, id, email, ch]
                );
            }
        }

        await client.query('COMMIT');
        res.json({
            message: `Campaign manual trigger dispatched simulation complete. Sent to ${targets.length} recipients.`,
            recipientsCount: targets.length
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 7. Get Simulated Delivery Logs (Admin/Teacher only)
 */
router.get('/logs', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT ml.id, ml.recipient_email, ml.channel, ml.status, ml.sent_at,
                    mc.title as campaign_title
             FROM marketing_logs ml
             JOIN marketing_campaigns mc ON ml.campaign_id = mc.id
             WHERE ml.tenant_id = $1
             ORDER BY ml.sent_at DESC LIMIT 50`,
            [tenantId]
        );

        res.json({ logs: result.rows });
    } catch (error) {
        next(error);
    }
});

export default router;
