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

export default router;
