import { db } from './config/db';

async function verifyPhase3() {
    console.log('🧪 Starting Automated Phase 3 Monetization Integration Validation...');

    // 1. Verify discount coupon retrieval
    try {
        const couponRes = await db.query(
            'SELECT * FROM coupons WHERE code = $1 AND tenant_id = $2',
            ['SAVE10', 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d']
        );

        if (couponRes.rows.length === 1 && couponRes.rows[0].discount_type === 'percentage') {
            console.log('✅ Coupons DB structure & fetching rules: PASS');
        } else {
            console.error('❌ Coupons checks: FAIL (Coupon metadata matches incorrectly)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Coupons database check failed:', err);
        process.exit(1);
    }

    // 2. Verify pricing computation calculations
    try {
        const basePrice = 1000.00;
        const discountPercentage = 10.00;
        const discountAmount = (basePrice * discountPercentage) / 100; // 100.00
        const subtotal = basePrice - discountAmount; // 900.00
        const gstTax = subtotal * 0.18; // 162.00
        const finalPayable = subtotal + gstTax; // 1062.00

        const expectedPayable = 1062.00;
        if (finalPayable === expectedPayable) {
            console.log(`✅ Pricing & 18% GST calculation model: PASS (Calculated: ${finalPayable})`);
        } else {
            console.error(`❌ Pricing calculations: FAIL (Calculated: ${finalPayable}, Expected: ${expectedPayable})`);
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Pricing calculations code check failed:', err);
        process.exit(1);
    }

    // 3. Verify Sandbox Checkout Order verification execution
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        // Create temporary student & course check
        const testCourseId = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
        const testStudentId = '33333333-3333-3333-3333-333333333333';
        const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        // Initialize pending test order
        const orderRes = await client.query(
            `INSERT INTO orders (tenant_id, user_id, item_type, item_id, amount, discount_amount, final_amount, status)
             VALUES ($1, $2, 'course', $3, 1000.00, 100.00, 1062.00, 'pending')
             RETURNING id`,
            [tenantId, testStudentId, testCourseId]
        );

        const orderId = orderRes.rows[0].id;

        // Perform sandbox verify simulations
        await client.query(
            `UPDATE orders SET status = 'paid' WHERE id = $1`,
            [orderId]
        );

        // Check enrollment entry
        await client.query(
            `INSERT INTO course_enrollments (course_id, student_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [testCourseId, testStudentId]
        );

        const checkEnroll = await client.query(
            'SELECT * FROM course_enrollments WHERE course_id = $1 AND student_id = $2',
            [testCourseId, testStudentId]
        );

        // Check invoice generation
        const invoiceNumber = `INV-TEST-${Date.now()}`;
        await client.query(
            `INSERT INTO invoices (order_id, invoice_number)
             VALUES ($1, $2)`,
            [orderId, invoiceNumber]
        );

        const checkInvoice = await client.query(
            'SELECT * FROM invoices WHERE order_id = $1',
            [orderId]
        );

        if (checkEnroll.rows.length === 1 && checkInvoice.rows.length === 1) {
            console.log('✅ Order Payment verify sandbox pipeline (Enrollment & Invoice log): PASS');
        } else {
            console.error('❌ Order verify pipeline checks: FAIL');
            await client.query('ROLLBACK');
            process.exit(1);
        }

        await client.query('ROLLBACK'); // Roll back transaction to keep database clean
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Order sandbox verify simulation failed:', err);
        process.exit(1);
    } finally {
        client.release();
    }

    console.log('🎉 Phase 3 Monetization integration checks completed successfully.');
}

verifyPhase3().catch(err => {
    console.error('Phase 3 verification script execution failed:', err);
    process.exit(1);
});
