import { db } from './config/db';

async function verifyPhase5() {
    console.log('🧪 Starting Automated Phase 5 Marketing Automation Integration Validation...');

    const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

    // 1. Verify CRM Leads database entries
    try {
        const leadsRes = await db.query(
            'SELECT * FROM leads WHERE tenant_id = $1 AND name = $2',
            [tenantId, 'Rohan Mehta']
        );

        if (leadsRes.rows.length === 1 && leadsRes.rows[0].email === 'rohan@gmail.com') {
            console.log('✅ CRM Leads retrieval database logic: PASS');
        } else {
            console.error('❌ CRM Leads query: FAIL (Expected seed lead Rohan not found)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ CRM Leads database queries failed:', err);
        process.exit(1);
    }

    // 2. Verify Campaign templates structures
    try {
        const campRes = await db.query(
            'SELECT * FROM marketing_campaigns WHERE tenant_id = $1',
            [tenantId]
        );

        if (campRes.rows.length >= 2) {
            console.log(`✅ Campaign rules templates lists: PASS (${campRes.rows.length} campaigns found)`);
        } else {
            console.error('❌ Campaign templates: FAIL (Expected seed campaigns not found)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Campaigns database queries failed:', err);
        process.exit(1);
    }

    // 3. Verify public lead inquiry form post simulation
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const testName = 'Validation Test Lead';
        const testEmail = 'valid-test@gmail.com';

        // Insert lead
        await client.query(
            `INSERT INTO leads (tenant_id, name, email, phone, status)
             VALUES ($1, $2, $3, '+919999988888', 'new')`,
            [tenantId, testName, testEmail]
        );

        const checkLead = await client.query(
            'SELECT * FROM leads WHERE email = $1 AND tenant_id = $2',
            [testEmail, tenantId]
        );

        if (checkLead.rows.length === 1 && checkLead.rows[0].name === testName) {
            console.log('✅ Public Lead Capture registration pipeline: PASS');
        } else {
            console.error('❌ Public Lead registration checks: FAIL');
            await client.query('ROLLBACK');
            process.exit(1);
        }

        await client.query('ROLLBACK'); // Roll back transaction to keep database clean
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Public Lead creation simulation failed:', err);
        process.exit(1);
    } finally {
        client.release();
    }

    console.log('🎉 Phase 5 Marketing integration checks completed successfully.');
}

verifyPhase5().catch(err => {
    console.error('Phase 5 verification script execution failed:', err);
    process.exit(1);
});
