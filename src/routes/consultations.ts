import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const consultationSchema = z.object({
    title: z.string().min(2),
    description: z.string().min(1),
    price: z.number().positive(),
    slots: z.array(z.string()) // array of ISO time strings
});

const bookingSchema = z.object({
    slot: z.string()
});

/**
 * 1. List consultations slots
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT c.id, c.title, c.description, c.price, c.slots,
                    u.first_name as teacher_first_name, u.last_name as teacher_last_name
             FROM consultations c
             JOIN users u ON c.teacher_id = u.id
             WHERE c.tenant_id = $1
             ORDER BY c.created_at DESC`,
            [tenantId]
        );

        res.json({ consultations: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Create Consultation session (Teacher/Admin only)
 */
router.post('/', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = consultationSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const teacherId = req.user!.id;

        const result = await db.query(
            `INSERT INTO consultations (tenant_id, teacher_id, title, description, price, slots)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, description, price, slots`,
            [tenantId, teacherId, body.title, body.description, body.price, body.slots]
        );

        res.status(201).json({
            message: 'Consultation session slots listed.',
            consultation: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 3. Book slot (student pays, adds transaction)
 */
router.post('/:id/book', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const { id } = req.params;
        const { slot } = bookingSchema.parse(req.body);
        const tenantId = req.tenant!.id;
        const studentId = req.user!.id;

        await client.query('BEGIN');

        // Verify consultation exists
        const consRes = await client.query(
            'SELECT title, price, slots FROM consultations WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );

        if (consRes.rows.length === 0) {
            res.status(404).json({ error: 'Consultation slot details not found.' });
            client.release();
            return;
        }

        const consultation = consRes.rows[0];

        // Check if slot is already booked
        const bookingCheck = await client.query(
            'SELECT id FROM consultation_bookings WHERE consultation_id = $1 AND booked_slot = $2 AND status = \'booked\'',
            [id, slot]
        );

        if (bookingCheck.rows.length > 0) {
            res.status(400).json({ error: 'This time slot has already been booked by another student.' });
            await client.query('ROLLBACK');
            return;
        }

        // 1. Insert Consultation Booking
        const bookingRes = await client.query(
            `INSERT INTO consultation_bookings (tenant_id, consultation_id, student_id, booked_slot, status)
             VALUES ($1, $2, $3, $4, 'booked')
             RETURNING id, booked_slot, status`,
            [tenantId, id, studentId, slot]
        );

        // 2. Log Order transaction for billing history
        const orderAmount = parseFloat(consultation.price);
        const taxGst = parseFloat((orderAmount * 0.18).toFixed(2));
        const finalTotal = orderAmount + taxGst;

        const orderRes = await client.query(
            `INSERT INTO orders (tenant_id, user_id, item_type, item_id, amount, discount_amount, final_amount, status, payment_gateway, gateway_payment_id)
             VALUES ($1, $2, 'course', $3, $4, 0.00, $5, 'paid', 'sandbox', $6)
             RETURNING id`,
            [tenantId, studentId, id, orderAmount, finalTotal, `TXN-CONS-${Math.floor(Math.random() * 900000)}`]
        );

        // 3. Generate Billing Invoice Receipt
        const invoiceNum = `INV-CONS-${Math.floor(100000 + Math.random() * 900000)}`;
        await client.query(
            `INSERT INTO invoices (order_id, invoice_number)
             VALUES ($1, $2)`,
            [
                orderRes.rows[0].id,
                invoiceNum
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({
            message: 'Consultation slot booked successfully!',
            booking: bookingRes.rows[0]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 4. Fetch booked appointments slots
 */
router.get('/bookings', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const userId = req.user!.id;
        const role = req.user!.role;

        let query = '';
        let params: any[] = [];

        if (role === 'student') {
            query = `
                SELECT cb.id, cb.booked_slot, cb.status,
                       c.title, u.first_name as teacher_first_name, u.last_name as teacher_last_name
                FROM consultation_bookings cb
                JOIN consultations c ON cb.consultation_id = c.id
                JOIN users u ON c.teacher_id = u.id
                WHERE cb.tenant_id = $1 AND cb.student_id = $2
                ORDER BY cb.booked_slot ASC`;
            params = [tenantId, userId];
        } else {
            // Teacher / Admin: see all bookings in tenant
            query = `
                SELECT cb.id, cb.booked_slot, cb.status,
                       c.title, u.first_name as student_first_name, u.last_name as student_last_name
                FROM consultation_bookings cb
                JOIN consultations c ON cb.consultation_id = c.id
                JOIN users u ON cb.student_id = u.id
                WHERE cb.tenant_id = $1
                ORDER BY cb.booked_slot ASC`;
            params = [tenantId];
        }

        const result = await db.query(query, params);
        res.json({ bookings: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Update booking status (Teacher/Admin only)
 */
const statusSchema = z.object({
    status: z.enum(['booked', 'completed', 'cancelled'])
});

router.patch('/bookings/:id/status', authenticate, requireRole(['admin', 'teacher']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { status } = statusSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `UPDATE consultation_bookings
             SET status = $1
             WHERE id = $2 AND tenant_id = $3
             RETURNING id, booked_slot, status`,
            [status, id, tenantId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Booking appointment not found.' });
            return;
        }

        res.json({
            message: `Booking status changed to ${status}.`,
            booking: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Cancel Booking (Student cancellation)
 */
router.delete('/bookings/:id', authenticate, requireRole(['student']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenant!.id;
        const studentId = req.user!.id;

        const result = await db.query(
            `UPDATE consultation_bookings
             SET status = 'cancelled'
             WHERE id = $1 AND student_id = $2 AND tenant_id = $3
             RETURNING id, booked_slot, status`,
            [id, studentId, tenantId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Booking appointment not found.' });
            return;
        }

        res.json({
            message: 'Booking cancelled successfully.',
            booking: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

export default router;
