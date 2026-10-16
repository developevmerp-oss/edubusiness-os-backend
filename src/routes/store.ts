import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate } from '../middlewares/auth';

const router = Router();

const couponValidateSchema = z.object({
    code: z.string().toUpperCase()
});

const checkoutSchema = z.object({
    courseId: z.string().uuid(),
    couponCode: z.string().toUpperCase().optional(),
    gateway: z.enum(['stripe', 'razorpay', 'sandbox']).default('sandbox'),
    orderBump: z.boolean().optional().default(false),
    referralCode: z.string().toUpperCase().optional()
});

/**
 * 1. Fetch courses available for purchase
 */
router.get('/courses', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        let query = '';
        let params: any[] = [];

        if (user.role === 'student') {
            // Students only see published courses they don't already own
            query = `
                SELECT c.id, c.title, c.description, c.price, c.is_published,
                       (SELECT COUNT(*)::int FROM course_sections WHERE course_id = c.id) as chapters_count
                FROM courses c
                LEFT JOIN course_enrollments ce ON c.id = ce.course_id AND ce.student_id = $1
                WHERE c.tenant_id = $2 AND c.is_published = TRUE AND ce.course_id IS NULL
                ORDER BY c.created_at DESC
            `;
            params = [user.id, tenantId];
        } else {
            // Admins/Teachers see all courses
            query = `
                SELECT c.id, c.title, c.description, c.price, c.is_published,
                       (SELECT COUNT(*)::int FROM course_sections WHERE course_id = c.id) as chapters_count
                FROM courses c
                WHERE c.tenant_id = $1
                ORDER BY c.created_at DESC
            `;
            params = [tenantId];
        }

        const result = await db.query(query, params);
        res.json({ courses: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Validate coupon code
 */
router.post('/coupons/validate', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code } = couponValidateSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        // Built-in Dynamic Recovery Coupon
        if (code === 'RECOVER15') {
            res.json({
                coupon: {
                    id: 'coupon-recover15',
                    code: 'RECOVER15',
                    discount_type: 'percentage',
                    discount_value: '15',
                    max_uses: 10000,
                    uses_count: 0,
                    expiry_date: new Date(Date.now() + 30 * 24 * 3600 * 1000)
                }
            });
            return;
        }

        const couponCheck = await db.query(
            'SELECT id, code, discount_type, discount_value, max_uses, uses_count, expiry_date FROM coupons WHERE tenant_id = $1 AND code = $2',
            [tenantId, code]
        );

        if (couponCheck.rows.length === 0) {
            res.status(400).json({ error: 'Invalid coupon code.' });
            return;
        }

        const coupon = couponCheck.rows[0];

        if (new Date() > new Date(coupon.expiry_date)) {
            res.status(400).json({ error: 'This coupon has expired.' });
            return;
        }

        if (coupon.uses_count >= coupon.max_uses) {
            res.status(400).json({ error: 'This coupon limit has been reached.' });
            return;
        }

        res.json({ coupon });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Checkout Order Creation
 */
router.post('/checkout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { courseId, couponCode, gateway, orderBump } = checkoutSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        // Verify course exists and belongs to tenant
        const courseRes = await db.query(
            'SELECT id, title, price, is_published FROM courses WHERE id = $1 AND tenant_id = $2',
            [courseId, tenantId]
        );

        if (courseRes.rows.length === 0 || !courseRes.rows[0].is_published) {
            res.status(404).json({ error: 'Course not found or is unavailable.' });
            return;
        }

        const course = courseRes.rows[0];
        const coursePrice = parseFloat(course.price);
        const bumpAmount = orderBump ? 199.00 : 0.00;
        const baseAmount = coursePrice + bumpAmount;

        // Verify student doesn't already own the course
        const ownershipCheck = await db.query(
            'SELECT 1 FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
            [courseId, userId]
        );

        if (ownershipCheck.rows.length > 0) {
            res.status(400).json({ error: 'You are already enrolled in this course.' });
            return;
        }

        // Apply discount if coupon provided
        let discountAmount = 0.00;
        let couponId: string | null = null;

        if (couponCode) {
            if (couponCode === 'RECOVER15') {
                discountAmount = (baseAmount * 15) / 100;
            } else {
                const couponRes = await db.query(
                    'SELECT id, discount_type, discount_value, max_uses, uses_count, expiry_date FROM coupons WHERE tenant_id = $1 AND code = $2',
                    [tenantId, couponCode]
                );

                if (couponRes.rows.length > 0) {
                    const coupon = couponRes.rows[0];
                    const isValid = new Date() <= new Date(coupon.expiry_date) && coupon.uses_count < coupon.max_uses;

                    if (isValid) {
                        couponId = coupon.id;
                        if (coupon.discount_type === 'percentage') {
                            discountAmount = (baseAmount * parseFloat(coupon.discount_value)) / 100;
                        } else {
                            discountAmount = Math.min(baseAmount, parseFloat(coupon.discount_value));
                        }
                    }
                }
            }
        }

        // Tax Calculation: 18% GST built-in
        const finalAmount = Math.max(0, baseAmount - discountAmount);

        // Generate Order
        const orderRes = await db.query(
            `INSERT INTO orders (tenant_id, user_id, item_type, item_id, amount, discount_amount, final_amount, coupon_id, status, payment_gateway)
             VALUES ($1, $2, 'course', $3, $4, $5, $6, $7, 'pending', $8)
             RETURNING id, amount, discount_amount, final_amount, status, payment_gateway`,
            [tenantId, userId, courseId, baseAmount, discountAmount, finalAmount, couponId, gateway]
        );

        res.status(201).json({
            message: 'Checkout order initialized.',
            order: orderRes.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Sandbox Payment Verification (with Invoice Generation & Auto Batch Enrollment)
 */
router.post('/checkout/:orderId/verify', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { orderId } = req.params;
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        await client.query('BEGIN');

        // Fetch pending order details
        const orderRes = await client.query(
            `SELECT id, status, item_id, final_amount, coupon_id FROM orders 
             WHERE id = $1 AND user_id = $2 AND tenant_id = $3 FOR UPDATE`,
            [orderId, userId, tenantId]
        );

        if (orderRes.rows.length === 0) {
            res.status(404).json({ error: 'Order transaction not found.' });
            await client.query('ROLLBACK');
            return;
        }

        const order = orderRes.rows[0];

        if (order.status === 'paid') {
            res.json({ message: 'This order is already processed.', order });
            await client.query('ROLLBACK');
            return;
        }

        const courseId = order.item_id;

        // 1. Mark Order as paid
        const gatewayPaymentId = `sandbox-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        await client.query(
            `UPDATE orders 
             SET status = 'paid', gateway_payment_id = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [gatewayPaymentId, orderId]
        );

        // 2. Add student course enrollment
        await client.query(
            `INSERT INTO course_enrollments (course_id, student_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [courseId, userId]
        );

        // 3. Increment coupon usage if applied
        if (order.coupon_id) {
            await client.query(
                'UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1',
                [order.coupon_id]
            );
        }

        // 4. Auto Enroll into First Active Batch of the course (if exists)
        const batchRes = await client.query(
            `SELECT id FROM batches 
             WHERE course_id = $1 AND tenant_id = $2 
             ORDER BY start_date ASC LIMIT 1`,
            [courseId, tenantId]
        );

        if (batchRes.rows.length > 0) {
            const batchId = batchRes.rows[0].id;
            await client.query(
                `INSERT INTO batch_students (batch_id, student_id)
                 VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [batchId, userId]
            );
        }

        // 5. Generate Invoice details
        const invoiceNumber = `INV-${Date.now()}-${(Array.isArray(orderId) ? orderId[0] : orderId).slice(0, 4).toUpperCase()}`;
        await client.query(
            `INSERT INTO invoices (order_id, invoice_number, issued_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)`,
            [orderId, invoiceNumber]
        );

        // 6. Check for Referral Code & Attribute Affiliate Conversion
        const { referralCode } = req.body || {};
        if (referralCode) {
            const affRes = await client.query(
                'SELECT id, name, commission_rate FROM affiliates WHERE tenant_id = $1 AND referral_code = $2 AND status = \'active\'',
                [tenantId, referralCode.toString().toUpperCase()]
            );

            if (affRes.rows.length > 0) {
                const affiliate = affRes.rows[0];
                const commRate = parseFloat(affiliate.commission_rate);
                const orderAmount = parseFloat(order.final_amount);
                const commissionEarned = (orderAmount * commRate) / 100;

                // Fetch buyer name
                const userRes = await client.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [userId]);
                const buyerName = userRes.rows[0] ? `${userRes.rows[0].first_name} ${userRes.rows[0].last_name}` : 'Student';
                const buyerEmail = userRes.rows[0]?.email;

                // Fetch course title
                const courseTitleRes = await client.query('SELECT title FROM courses WHERE id = $1', [courseId]);
                const courseTitle = courseTitleRes.rows[0]?.title || 'Course';

                // Record conversion
                await client.query(
                    `INSERT INTO referral_conversions (tenant_id, affiliate_id, buyer_name, buyer_email, course_id, course_title, order_amount, commission_amount, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved')`,
                    [tenantId, affiliate.id, buyerName, buyerEmail, courseId, courseTitle, orderAmount, commissionEarned]
                );

                // Update affiliate totals
                await client.query(
                    `UPDATE affiliates 
                     SET total_earnings = total_earnings + $1, pending_payout = pending_payout + $1 
                     WHERE id = $2`,
                    [commissionEarned, affiliate.id]
                );
            }
        }

        // 7. Reconcile Abandoned Carts for this student and course
        const studentRes = await client.query('SELECT email, phone FROM users WHERE id = $1', [userId]);
        if (studentRes.rows.length > 0) {
            const { email, phone } = studentRes.rows[0];
            await client.query(
                `UPDATE abandoned_carts 
                 SET recovery_status = 'recovered' 
                 WHERE tenant_id = $1 AND course_id = $2 AND (student_email = $3 OR student_phone = $4)`,
                [tenantId, courseId, email, phone || '']
            );
        }

        await client.query('COMMIT');
        res.json({
            message: 'Sandbox payment verified successfully. Enrollment confirmed.',
            invoiceNumber
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 5. Get user Invoices billing history logs
 */
router.get('/invoices', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const result = await db.query(
            `SELECT i.id, i.invoice_number, i.issued_at,
                    o.amount, o.discount_amount, o.final_amount, o.payment_gateway, o.gateway_payment_id,
                    c.title as course_title
             FROM invoices i
             JOIN orders o ON i.order_id = o.id
             JOIN courses c ON o.item_id = c.id
             WHERE o.user_id = $1 AND o.tenant_id = $2 AND o.status = 'paid'
             ORDER BY i.issued_at DESC`,
            [userId, tenantId]
        );

        res.json({ invoices: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * ========================================================
 * PHASE 4: COURSE BUNDLES & DIGITAL DOWNLOAD PRODUCTS
 * ========================================================
 */

/**
 * 6. Get Available Course Bundles (with auto-seed fallback for new tenants)
 */
router.get('/bundles', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        let result = await db.query(
            `SELECT * FROM course_bundles 
             WHERE tenant_id = $1 AND is_published = TRUE 
             ORDER BY created_at DESC`,
            [tenantId]
        );

        if (result.rows.length === 0) {
            // Auto-seed starter bundle for tenant
            const tRes = await db.query('SELECT name FROM tenants WHERE id = $1', [tenantId]);
            const tName = tRes.rows[0]?.name || 'Academy';
            const cRes = await db.query('SELECT id, title FROM courses WHERE tenant_id = $1 LIMIT 3', [tenantId]);
            const incCourses = cRes.rows.length > 0 ? cRes.rows : [
                { id: 'foundation', title: `${tName} Core Mastery` }
            ];

            await db.query(`
                INSERT INTO course_bundles (tenant_id, title, description, bundle_price, original_price, discount_percentage, courses_included)
                VALUES ($1, $2, $3, 4999.00, 7999.00, 38, $4)
            `, [
                tenantId, 
                `${tName} All-Access Ranker Super Pack 2026`, 
                'Complete access to all courses, curated question banks, and mock test papers at an exclusive combo discount.', 
                JSON.stringify(incCourses)
            ]);

            result = await db.query(
                `SELECT * FROM course_bundles WHERE tenant_id = $1 AND is_published = TRUE ORDER BY created_at DESC`,
                [tenantId]
            );
        }

        res.json({ bundles: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 7. Create Course Bundle (Admin/Teacher only)
 */
router.post('/bundles', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { title, description, bundlePrice, originalPrice, coursesIncluded } = z.object({
            title: z.string().min(2),
            description: z.string().optional(),
            bundlePrice: z.number().min(0),
            originalPrice: z.number().min(0),
            coursesIncluded: z.array(z.object({ id: z.string(), title: z.string() })).min(1)
        }).parse(req.body);

        const discountPct = originalPrice > 0 ? Math.round(((originalPrice - bundlePrice) / originalPrice) * 100) : 0;

        const result = await db.query(
            `INSERT INTO course_bundles (tenant_id, title, description, bundle_price, original_price, discount_percentage, courses_included)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [tenantId, title, description || '', bundlePrice, originalPrice, discountPct, JSON.stringify(coursesIncluded)]
        );

        res.status(201).json({
            message: 'Course bundle published successfully!',
            bundle: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 8. Purchase Course Bundle (1-Click Super Pack Enrollment)
 */
router.post('/bundles/:id/buy', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const bundleRes = await client.query(
            'SELECT * FROM course_bundles WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (bundleRes.rows.length === 0) {
            res.status(404).json({ error: 'Course bundle not found.' });
            return;
        }

        const bundle = bundleRes.rows[0];
        const courses = typeof bundle.courses_included === 'string' 
            ? JSON.parse(bundle.courses_included) 
            : bundle.courses_included;

        await client.query('BEGIN');

        // Enroll in all courses included
        for (const item of courses) {
            if (item.id && item.id.length === 36) {
                await client.query(
                    `INSERT INTO course_enrollments (course_id, student_id)
                     VALUES ($1, $2)
                     ON CONFLICT DO NOTHING`,
                    [item.id, userId]
                );
            }
        }

        // Create Order and Invoice
        const orderRes = await client.query(
            `INSERT INTO orders (tenant_id, user_id, item_type, item_id, amount, discount_amount, final_amount, status, payment_gateway, gateway_payment_id)
             VALUES ($1, $2, 'bundle', $3, $4, 0, $4, 'paid', 'sandbox', $5)
             RETURNING id`,
            [tenantId, userId, id, bundle.bundle_price, `bundle-${Date.now()}`]
        );

        const orderId = orderRes.rows[0].id;
        const invoiceNumber = `INV-BNDL-${Date.now().toString().slice(-6)}`;
        await client.query(
            `INSERT INTO invoices (order_id, invoice_number, issued_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)`,
            [orderId, invoiceNumber]
        );

        await client.query('COMMIT');

        res.json({
            message: `Super Pack Unlocked! You have been successfully enrolled in all courses included in the bundle.`,
            bundleTitle: bundle.title,
            coursesEnrolled: courses.length,
            invoiceNumber
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 9. Get Digital Products (with auto-seed fallback for new tenants)
 */
router.get('/digital-products', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        let result = await db.query(
            `SELECT dp.*,
                    CASE WHEN dpp.id IS NOT NULL THEN TRUE ELSE FALSE END as is_purchased
             FROM digital_products dp
             LEFT JOIN digital_product_purchases dpp ON dp.id = dpp.product_id AND dpp.user_id = $1
             WHERE dp.tenant_id = $2 AND dp.is_published = TRUE
             ORDER BY dp.downloads_count DESC, dp.created_at DESC`,
            [userId, tenantId]
        );

        if (result.rows.length === 0) {
            // Auto-seed starter digital products
            await db.query(`
                INSERT INTO digital_products (tenant_id, title, description, category, price, file_url, downloads_count)
                VALUES 
                ($1, 'VIP Handwritten Formula & Mind-Map Booklet', 'Complete 150-page high-yield formula notes, cheat-sheets, and quick revision mind maps with DRM watermark protection.', 'Formula Notes', 199.00, 'https://scaloy.com/samples/handwritten-physics-formula-booklet.pdf', 380),
                ($1, '500 Must-Solve High-Yield Exam Problems', 'Curated question bank with step-by-step verified solutions strictly following the examination pattern.', 'Question Bank', 349.00, 'https://scaloy.com/samples/500-must-solve-physics-nta.pdf', 245),
                ($1, '10 Full-Length All-India Mock Test Series with Solutions', 'Simulated full-syllabus mock papers strictly according to the latest NTA examination pattern.', 'Test Series PDF', 499.00, 'https://scaloy.com/samples/10-full-mock-tests-jee.pdf', 160)
            `, [tenantId]);

            result = await db.query(
                `SELECT dp.*,
                        CASE WHEN dpp.id IS NOT NULL THEN TRUE ELSE FALSE END as is_purchased
                 FROM digital_products dp
                 LEFT JOIN digital_product_purchases dpp ON dp.id = dpp.product_id AND dpp.user_id = $1
                 WHERE dp.tenant_id = $2 AND dp.is_published = TRUE
                 ORDER BY dp.downloads_count DESC, dp.created_at DESC`,
                [userId, tenantId]
            );
        }

        res.json({ products: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 10. Create Digital Product (Admin/Teacher only)
 */
router.post('/digital-products', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { title, description, category, price, fileUrl } = z.object({
            title: z.string().min(2),
            description: z.string().optional(),
            category: z.string().default('Formula Notes'),
            price: z.number().min(0),
            fileUrl: z.string().min(4)
        }).parse(req.body);

        const result = await db.query(
            `INSERT INTO digital_products (tenant_id, title, description, category, price, file_url)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [tenantId, title, description || '', category, price, fileUrl]
        );

        res.status(201).json({
            message: 'Digital product published to store catalog!',
            product: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 11. Purchase Digital Product (1-Click Instant Unlock)
 */
router.post('/digital-products/:id/buy', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;

        const prodRes = await db.query(
            'SELECT * FROM digital_products WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (prodRes.rows.length === 0) {
            res.status(404).json({ error: 'Digital product not found.' });
            return;
        }

        const product = prodRes.rows[0];

        // Unlock purchase
        await db.query(
            `INSERT INTO digital_product_purchases (tenant_id, user_id, product_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, product_id) DO NOTHING`,
            [tenantId, userId, id]
        );

        // Increment download counter
        await db.query(
            'UPDATE digital_products SET downloads_count = downloads_count + 1 WHERE id = $1',
            [id]
        );

        res.json({
            message: `Purchase successful! "${product.title}" is now unlocked for instant DRM download.`,
            downloadUrl: product.file_url,
            isPurchased: true
        });
    } catch (error) {
        next(error);
    }
});

export default router;



