import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { authenticate, requireRole } from '../middlewares/auth';

const router = Router();

const paymentSchema = z.object({
    feeId: z.string().uuid(),
    amount: z.number().positive(),
    paymentMethod: z.enum(['cash', 'card', 'upi', 'bank_transfer']),
    transactionReference: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
});

/**
 * 1. Get all fee records
 */
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;
        const status = req.query.status as string;

        let query = `
            SELECT f.id, f.student_id, f.batch_id, f.amount_due, f.amount_paid, f.due_date, f.status, f.created_at,
                   u.first_name as student_first_name, u.last_name as student_last_name, u.email as student_email,
                   b.name as batch_name
            FROM fees f
            JOIN users u ON f.student_id = u.id
            LEFT JOIN batches b ON f.batch_id = b.id
            WHERE f.tenant_id = $1
        `;
        const params: any[] = [tenantId];

        // Filter role scopes
        if (user.role === 'student') {
            query += ' AND f.student_id = $2';
            params.push(user.id);
        } else if (user.role === 'parent') {
            query += ` AND f.student_id IN (
                SELECT student_id FROM parents_students WHERE parent_id = $2
            )`;
            params.push(user.id);
        }

        if (status) {
            const statusIdx = params.length + 1;
            query += ` AND f.status = $${statusIdx}`;
            params.push(status);
        }

        query += ' ORDER BY f.due_date ASC';

        const result = await db.query(query, params);
        res.json({ fees: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 2. Record a fee payment (Admin only)
 */
router.post('/payments', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    const client = await db.getClient();
    try {
        const body = paymentSchema.parse(req.body);
        const tenantId = req.tenant!.id;

        await client.query('BEGIN');

        // Fetch fee record
        const feeCheck = await client.query(
            'SELECT id, amount_due, amount_paid, status FROM fees WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
            [tenantId, body.feeId]
        );

        if (feeCheck.rows.length === 0) {
            res.status(404).json({ error: 'Fee invoice record not found.' });
            await client.query('ROLLBACK');
            return;
        }

        const fee = feeCheck.rows[0];
        const newPaid = parseFloat(fee.amount_paid) + body.amount;
        const due = parseFloat(fee.amount_due);

        if (newPaid > due) {
            res.status(400).json({ error: 'Payment amount exceeds the total pending balance.' });
            await client.query('ROLLBACK');
            return;
        }

        let newStatus = 'partially_paid';
        if (newPaid === due) {
            newStatus = 'paid';
        }

        // Record Transaction
        await client.query(
            `INSERT INTO fee_payments (tenant_id, fee_id, amount, payment_method, transaction_reference, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenantId, body.feeId, body.amount, body.paymentMethod, body.transactionReference || null, body.notes || null]
        );

        // Update Invoice status
        await client.query(
            'UPDATE fees SET amount_paid = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [newPaid, newStatus, body.feeId]
        );

        await client.query('COMMIT');
        res.json({ message: 'Payment recorded and invoice updated successfully.' });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

/**
 * 3. Get transactions ledger (Admin only)
 */
router.get('/payments', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;

        const result = await db.query(
            `SELECT p.id, p.fee_id, p.amount, p.payment_date, p.payment_method, p.transaction_reference, p.notes,
                    u.first_name as student_first_name, u.last_name as student_last_name,
                    b.name as batch_name
             FROM fee_payments p
             JOIN fees f ON p.fee_id = f.id
             JOIN users u ON f.student_id = u.id
             LEFT JOIN batches b ON f.batch_id = b.id
             WHERE p.tenant_id = $1
             ORDER BY p.payment_date DESC`,
            [tenantId]
        );

        res.json({ payments: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 4. Get Fee Installment Schedules
 */
router.get('/installments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const user = req.user!;

        let query = `
            SELECT fi.*, u.first_name as student_first_name, u.last_name as student_last_name, u.email as student_email,
                   c.title as course_title
            FROM fee_installments fi
            JOIN users u ON fi.student_id = u.id
            LEFT JOIN courses c ON fi.course_id = c.id
            WHERE fi.tenant_id = $1
        `;
        const params: any[] = [tenantId];

        if (user.role === 'student') {
            query += ' AND fi.student_id = $2';
            params.push(user.id);
        } else if (user.role === 'parent') {
            query += ` AND fi.student_id IN (
                SELECT student_id FROM parents_students WHERE parent_id = $2
            )`;
            params.push(user.id);
        }

        query += ' ORDER BY fi.due_date ASC, fi.installment_number ASC';

        const result = await db.query(query, params);
        res.json({ installments: result.rows });
    } catch (error) {
        next(error);
    }
});

/**
 * 5. Pay an Installment (Student or Admin)
 */
router.post('/installments/:id/pay', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { id } = req.params;

        const updateRes = await db.query(`
            UPDATE fee_installments
            SET status = 'paid',
                paid_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND tenant_id = $2
            RETURNING *
        `, [id, tenantId]);

        if (updateRes.rows.length === 0) {
            res.status(404).json({ error: 'Installment record not found.' });
            return;
        }

        res.json({
            message: 'Installment fee payment recorded successfully.',
            installment: updateRes.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

/**
 * 6. Create Multi-Installment Plan for a Student (Admin only)
 */
router.post('/installments/create', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const tenantId = req.tenant!.id;
        const { studentId, courseId, installments } = req.body;

        if (!Array.isArray(installments) || installments.length === 0) {
            res.status(400).json({ error: 'Installments list must be provided.' });
            return;
        }

        const inserted: any[] = [];
        for (let i = 0; i < installments.length; i++) {
            const inst = installments[i];
            const insRes = await db.query(`
                INSERT INTO fee_installments (tenant_id, student_id, course_id, installment_number, amount, due_date, status)
                VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                RETURNING *
            `, [tenantId, studentId, courseId || null, i + 1, inst.amount, inst.dueDate]);
            inserted.push(insRes.rows[0]);
        }

        res.status(201).json({
            message: `${inserted.length} fee installments schedule created successfully.`,
            installments: inserted
        });
    } catch (error) {
        next(error);
    }
});

export default router;
