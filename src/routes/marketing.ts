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

/**
 * ========================================================
 * PHASE 3: AFFILIATE & INFLUENCER PARTNER ENGINE
 * ========================================================
 */

const affiliateSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    referralCode: z.string().min(3).regex(/^[A-Z0-9_-]+$/i, 'Referral code must be alphanumeric'),
    commissionRate: z.number().min(1).max(50).default(15),
    upiId: z.string().optional()
});

/**
 * 8. Get All Affiliates with Summary Metrics (Admin/Teacher only)
 */
router.get('/affiliates', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const affiliatesRes = await db.query(
            `SELECT a.*, 
                    COUNT(rc.id) as total_conversions,
                    COALESCE(SUM(rc.order_amount), 0) as total_sales_generated
             FROM affiliates a
             LEFT JOIN referral_conversions rc ON a.id = rc.affiliate_id AND rc.status = 'approved'
             WHERE a.tenant_id = $1
             GROUP BY a.id
             ORDER BY a.created_at DESC`,
            [tenantId]
        );

        const conversionsRes = await db.query(
            `SELECT rc.*, a.name as affiliate_name, a.referral_code
             FROM referral_conversions rc
             JOIN affiliates a ON rc.affiliate_id = a.id
             WHERE rc.tenant_id = $1
             ORDER BY rc.created_at DESC LIMIT 30`,
            [tenantId]
        );

        res.json({
            affiliates: affiliatesRes.rows,
            conversions: conversionsRes.rows
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 9. Register a New Affiliate Partner (Admin/Teacher only)
 */
router.post('/affiliates', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = affiliateSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const code = body.referralCode.toUpperCase();

        // Check if referral code exists
        const codeCheck = await db.query('SELECT id FROM affiliates WHERE tenant_id = $1 AND referral_code = $2', [tenantId, code]);
        if (codeCheck.rows.length > 0) {
            res.status(400).json({ error: `Referral code "${code}" is already taken.` });
            return;
        }

        const result = await db.query(
            `INSERT INTO affiliates (tenant_id, name, email, phone, referral_code, commission_rate, upi_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [tenantId, body.name, body.email, body.phone || null, code, body.commissionRate, body.upiId || null]
        );

        res.status(201).json({
            message: 'Affiliate partner registered successfully.',
            affiliate: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 10. Process Affiliate Payout (Admin only)
 */
router.post('/affiliates/:id/payout', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const affRes = await db.query(
            'SELECT id, name, pending_payout, upi_id FROM affiliates WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (affRes.rows.length === 0) {
            res.status(404).json({ error: 'Affiliate not found.' });
            return;
        }

        const affiliate = affRes.rows[0];
        const payoutAmount = parseFloat(affiliate.pending_payout);

        if (payoutAmount <= 0) {
            res.status(400).json({ error: 'No pending payout balance to settle.' });
            return;
        }

        // Settle pending payout
        await db.query(
            'UPDATE affiliates SET pending_payout = 0 WHERE id = $1',
            [id]
        );

        res.json({
            message: `Payout of ₹${payoutAmount.toFixed(2)} processed to ${affiliate.name} (${affiliate.upiId || 'Direct Bank/UPI'}).`,
            paidAmount: payoutAmount
        });
    } catch (error) {
        next(error);
    }
});

/**
 * ========================================================
 * PHASE 3: ABANDONED CART & WHATSAPP AUTOMATION
 * ========================================================
 */

/**
 * 11. Get Abandoned Carts (Admin/Teacher only)
 */
router.get('/abandoned-carts', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT ac.*, c.title as current_course_title
             FROM abandoned_carts ac
             LEFT JOIN courses c ON ac.course_id = c.id
             WHERE ac.tenant_id = $1
             ORDER BY ac.last_activity DESC`,
            [tenantId]
        );

        res.json({ abandonedCarts: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 12. Trigger Automated WhatsApp Recovery Nudge
 */
router.post('/abandoned-carts/:id/recover', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;

        const cartRes = await db.query(
            'SELECT * FROM abandoned_carts WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (cartRes.rows.length === 0) {
            res.status(404).json({ error: 'Abandoned cart record not found.' });
            return;
        }

        const cart = cartRes.rows[0];

        // Update recovery status
        await db.query(
            `UPDATE abandoned_carts 
             SET recovery_status = 'nudge_sent', last_activity = NOW() 
             WHERE id = $1`,
            [id]
        );

        // Record simulated delivery log
        await db.query(
            `INSERT INTO marketing_logs (tenant_id, campaign_id, recipient_email, channel, status)
             SELECT $1, id, $2, 'whatsapp', 'sent'
             FROM marketing_campaigns
             WHERE tenant_id = $1
             LIMIT 1`,
            [tenantId, cart.student_email || `${cart.student_phone}@whatsapp`]
        );

        res.json({
            message: `WhatsApp Recovery Nudge dispatched to ${cart.student_name} (${cart.student_phone}) with 15% discount coupon code "${cart.coupon_code}".`,
            cartId: id,
            status: 'nudge_sent'
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 13. Public Record Checkout Abandonment (Triggered on store checkout start)
 */
router.post('/abandoned-carts/record', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { studentName, studentPhone, studentEmail, courseId, courseTitle, cartValue } = z.object({
            studentName: z.string().min(2),
            studentPhone: z.string().min(10),
            studentEmail: z.string().email().optional(),
            courseId: z.string().uuid().optional(),
            courseTitle: z.string().min(2),
            cartValue: z.number().min(0)
        }).parse(req.body);

        const tenantId = req.tenant!.id;

        const result = await db.query(
            `INSERT INTO abandoned_carts (tenant_id, student_name, student_phone, student_email, course_id, course_title, cart_value, recovery_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'abandoned')
             RETURNING id, student_name, recovery_status`,
            [tenantId, studentName, studentPhone, studentEmail || null, courseId || null, courseTitle, cartValue]
        );

        res.status(201).json({
            message: 'Cart tracking initialized',
            cart: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

export default router;

