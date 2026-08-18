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
    gateway: z.enum(['stripe', 'razorpay', 'sandbox']).default('sandbox')
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
        const { courseId, couponCode, gateway } = checkoutSchema.parse(req.body);
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
        const baseAmount = parseFloat(course.price);

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

export default router;

