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
 * Helper: Dispatch Meta WhatsApp Cloud API Message
 */
async function dispatchMetaWhatsAppMessage(
    config: { phoneNumberId?: string; accessToken?: string },
    toPhone: string,
    messageText: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!config.phoneNumberId || !config.accessToken) {
        return { success: false, error: 'Meta WhatsApp credentials missing.' };
    }

    let cleanPhone = toPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) {
        cleanPhone = '91' + cleanPhone; // default India prefix if 10 digits
    }

    try {
        const metaUrl = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;
        const res = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { preview_url: true, body: messageText }
            })
        });

        if (res.ok) {
            const data: any = await res.json();
            const messageId = data?.messages?.[0]?.id;
            return { success: true, messageId };
        } else {
            const errData: any = await res.json().catch(() => ({}));
            return {
                success: false,
                error: errData?.error?.message || `Meta API HTTP ${res.status}`
            };
        }
    } catch (err: any) {
        return { success: false, error: err.message || 'Meta network request failed' };
    }
}

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

        // Fetch WhatsApp Cloud API Configuration
        const cfgRes = await db.query('SELECT * FROM whatsapp_api_configs WHERE tenant_id = $1', [tenantId]);
        const waConfig = cfgRes.rows[0];

        const couponCode = cart.coupon_code || 'RECOVER15';
        const messageBody = `Hi ${cart.student_name} 👋 We noticed you started enrolling in "${cart.course_title}" but didn't finish! Here is an exclusive 15% discount coupon: ${couponCode} valid for the next 2 hours. Click below to complete your seat:\nhttps://academy.edu/store/${cart.course_id}?coupon=${couponCode}`;

        let dispatchResult: { success: boolean; messageId?: string; error?: string } = { success: true };
        let msgStatus: 'sent' | 'simulated' | 'failed' = 'simulated';

        if (waConfig && waConfig.is_enabled && waConfig.phone_number_id && waConfig.access_token) {
            dispatchResult = await dispatchMetaWhatsAppMessage(
                { phoneNumberId: waConfig.phone_number_id, accessToken: waConfig.access_token },
                cart.student_phone,
                messageBody
            );
            msgStatus = dispatchResult.success ? 'sent' : 'failed';
        }

        // Record message in audit table
        await db.query(
            `INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, direction, template_name, message_body, meta_message_id, status, error_message)
             VALUES ($1, $2, $3, 'outbound', 'cart_recovery', $4, $5, $6, $7)`,
            [
                tenantId,
                cart.student_phone,
                cart.student_name,
                messageBody,
                dispatchResult.messageId || null,
                msgStatus,
                dispatchResult.error || null
            ]
        );

        // Update recovery status
        await db.query(
            `UPDATE abandoned_carts 
             SET recovery_status = 'nudge_sent', last_activity = NOW() 
             WHERE id = $1`,
            [id]
        );

        // Record simulated delivery log for legacy campaign stats
        await db.query(
            `INSERT INTO marketing_logs (tenant_id, campaign_id, recipient_email, channel, status)
             SELECT $1, id, $2, 'whatsapp', 'sent'
             FROM marketing_campaigns
             WHERE tenant_id = $1
             LIMIT 1`,
            [tenantId, cart.student_email || `${cart.student_phone}@whatsapp`]
        );

        const deliveryModeNotice = msgStatus === 'sent' 
            ? 'Dispatched live via Meta WhatsApp Cloud API.' 
            : msgStatus === 'failed' 
            ? `Meta API Error: ${dispatchResult.error}` 
            : 'Dispatched via Simulator Mode.';

        res.json({
            message: `WhatsApp Recovery Nudge dispatched to ${cart.student_name} (${cart.student_phone}). ${deliveryModeNotice}`,
            cartId: id,
            status: 'nudge_sent',
            deliveryStatus: msgStatus,
            metaMessageId: dispatchResult.messageId
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

/**
 * 14. Get WhatsApp Cloud API Configuration (Admin only)
 */
router.get('/whatsapp/config', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const result = await db.query('SELECT * FROM whatsapp_api_configs WHERE tenant_id = $1', [tenantId]);
        const config = result.rows[0] || {
            provider: 'simulator',
            phone_number_id: '',
            waba_id: '',
            access_token: '',
            webhook_verify_token: 'edubusiness_wa_secret_2026',
            is_enabled: false
        };

        res.json({
            config: {
                provider: config.provider || 'simulator',
                phoneNumberId: config.phone_number_id || '',
                wabaId: config.waba_id || '',
                accessToken: config.access_token ? `${config.access_token.slice(0, 8)}...${config.access_token.slice(-4)}` : '',
                hasAccessToken: !!config.access_token,
                webhookVerifyToken: config.webhook_verify_token || 'edubusiness_wa_secret_2026',
                isEnabled: config.is_enabled ?? false
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 15. Update WhatsApp Cloud API Configuration (Admin only)
 */
router.post('/whatsapp/config', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { provider, phoneNumberId, wabaId, accessToken, webhookVerifyToken, isEnabled } = req.body || {};

        let updateQuery = `
            INSERT INTO whatsapp_api_configs (tenant_id, provider, phone_number_id, waba_id, webhook_verify_token, is_enabled, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (tenant_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                phone_number_id = EXCLUDED.phone_number_id,
                waba_id = EXCLUDED.waba_id,
                webhook_verify_token = EXCLUDED.webhook_verify_token,
                is_enabled = EXCLUDED.is_enabled,
                updated_at = NOW()
        `;
        let params: any[] = [
            tenantId, 
            provider || 'meta_cloud_api', 
            phoneNumberId || null, 
            wabaId || null, 
            webhookVerifyToken || 'edubusiness_wa_secret_2026', 
            Boolean(isEnabled)
        ];

        if (accessToken && !accessToken.includes('...')) {
            updateQuery = `
                INSERT INTO whatsapp_api_configs (tenant_id, provider, phone_number_id, waba_id, access_token, webhook_verify_token, is_enabled, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    provider = EXCLUDED.provider,
                    phone_number_id = EXCLUDED.phone_number_id,
                    waba_id = EXCLUDED.waba_id,
                    access_token = EXCLUDED.access_token,
                    webhook_verify_token = EXCLUDED.webhook_verify_token,
                    is_enabled = EXCLUDED.is_enabled,
                    updated_at = NOW()
            `;
            params = [
                tenantId, 
                provider || 'meta_cloud_api', 
                phoneNumberId || null, 
                wabaId || null, 
                accessToken,
                webhookVerifyToken || 'edubusiness_wa_secret_2026', 
                Boolean(isEnabled)
            ];
        }

        await db.query(updateQuery, params);

        res.json({ message: 'WhatsApp Cloud API settings saved successfully!' });
    } catch (error) {
        next(error);
    }
});

/**
 * 16. Send Direct Test WhatsApp Message (Admin only)
 */
router.post('/whatsapp/test-message', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { testPhone } = req.body || {};

        if (!testPhone) {
            res.status(400).json({ error: 'Recipient phone number is required.' });
            return;
        }

        const cfgRes = await db.query('SELECT * FROM whatsapp_api_configs WHERE tenant_id = $1', [tenantId]);
        const waConfig = cfgRes.rows[0];

        const messageText = `⚡ Test Alert from EduBusiness OS: Your WhatsApp Cloud API gateway is successfully connected and transmitting messages in real time!`;

        if (waConfig && waConfig.is_enabled && waConfig.phone_number_id && waConfig.access_token) {
            const dispatchResult = await dispatchMetaWhatsAppMessage(
                { phoneNumberId: waConfig.phone_number_id, accessToken: waConfig.access_token },
                testPhone,
                messageText
            );

            await db.query(
                `INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, direction, template_name, message_body, meta_message_id, status, error_message)
                 VALUES ($1, $2, 'Admin Test', 'outbound', 'system_test', $3, $4, $5, $6)`,
                [
                    tenantId, 
                    testPhone, 
                    messageText, 
                    dispatchResult.messageId || null, 
                    dispatchResult.success ? 'sent' : 'failed',
                    dispatchResult.error || null
                ]
            );

            if (dispatchResult.success) {
                res.json({
                    status: 'success',
                    message: `Live test message transmitted to ${testPhone} via Meta WhatsApp Cloud API!`,
                    metaMessageId: dispatchResult.messageId
                });
            } else {
                res.status(400).json({
                    status: 'error',
                    error: `Meta API Error: ${dispatchResult.error || 'Failed to dispatch'}`
                });
            }
            return;
        }

        // Simulator Mode fallback
        await db.query(
            `INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, direction, template_name, message_body, status)
             VALUES ($1, $2, 'Admin Test', 'outbound', 'system_test', $3, 'simulated')`,
            [tenantId, testPhone, messageText]
        );

        res.json({
            status: 'success',
            message: `Simulated test message recorded for ${testPhone}. (Toggle 'Enable Meta Cloud API' with valid credentials for real smartphone transmission).`
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Test dispatch failed' });
    }
});

/**
 * 17. Get Live WhatsApp Message Transmission Logs (Admin/Teacher)
 */
router.get('/whatsapp/messages', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const result = await db.query(
            `SELECT id, recipient_phone, recipient_name, direction, template_name, message_body, meta_message_id, status, error_message, created_at
             FROM whatsapp_messages
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 50`,
            [tenantId]
        );

        res.json({ messages: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 18. Meta WhatsApp Webhook Challenge Verification (GET)
 */
router.get('/whatsapp/webhook', async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe') {
        const verifyCheck = await db.query(
            'SELECT id FROM whatsapp_api_configs WHERE webhook_verify_token = $1',
            [token]
        );

        if (verifyCheck.rows.length > 0 || token === 'edubusiness_wa_secret_2026') {
            console.log('✅ Meta WhatsApp webhook verified successfully!');
            res.status(200).send(challenge);
            return;
        }
    }

    res.status(403).send('Forbidden');
});

/**
 * 19. Meta WhatsApp Webhook Receiver for Delivery Statuses & Inbound Replies (POST)
 */
router.post('/whatsapp/webhook', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                for (const change of entry.changes || []) {
                    const value = change.value;

                    // Handle Message Status updates (delivered, read, failed)
                    if (value?.statuses && Array.isArray(value.statuses)) {
                        for (const statusObj of value.statuses) {
                            const metaId = statusObj.id;
                            const statusStr = statusObj.status; // 'sent' | 'delivered' | 'read' | 'failed'
                            if (metaId && statusStr) {
                                await db.query(
                                    'UPDATE whatsapp_messages SET status = $1 WHERE meta_message_id = $2',
                                    [statusStr, metaId]
                                );
                            }
                        }
                    }

                    // Handle Inbound Replies from students
                    if (value?.messages && Array.isArray(value.messages)) {
                        for (const msg of value.messages) {
                            const senderPhone = msg.from;
                            const textBody = msg.text?.body || '[Media/Unsupported Content]';
                            const metaId = msg.id;

                            // Find tenant matching phone_number_id
                            const phoneId = value.metadata?.phone_number_id;
                            let tenantId: string | null = null;
                            if (phoneId) {
                                const tRes = await db.query('SELECT tenant_id FROM whatsapp_api_configs WHERE phone_number_id = $1 LIMIT 1', [phoneId]);
                                tenantId = tRes.rows[0]?.tenant_id || null;
                            }

                            if (tenantId) {
                                await db.query(
                                    `INSERT INTO whatsapp_messages (tenant_id, recipient_phone, recipient_name, direction, template_name, message_body, meta_message_id, status)
                                     VALUES ($1, $2, 'Student Reply', 'inbound', 'reply', $3, $4, 'received')`,
                                    [tenantId, senderPhone, textBody, metaId]
                                );
                            }
                        }
                    }
                }
            }
        }

        res.status(200).send('EVENT_RECEIVED');
    } catch (webhookErr) {
        console.error('Error handling Meta WhatsApp webhook:', webhookErr);
        res.status(200).send('EVENT_RECEIVED');
    }
});

export default router;

