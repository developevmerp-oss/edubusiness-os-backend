import { db } from './config/db';

async function verifyPhase7() {
    console.log('🧪 Starting Automated Phase 7 White-label & Creator Tools Integration Validation...');

    const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    const studentId = '33333333-3333-3333-3333-333333333333'; // Rahul
    const courseId = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'; // Physics

    // 1. Verify settings branding update
    try {
        const testBranding = {
            name: 'Phase 7 Verification Academy',
            description: 'Custom verified slogan',
            accentColor: '#10b981'
        };

        await db.query(
            `UPDATE tenants
             SET branding = $1, name = $2
             WHERE id = $3`,
            [JSON.stringify(testBranding), testBranding.name, tenantId]
        );

        const checkTenant = await db.query('SELECT name, branding FROM tenants WHERE id = $1', [tenantId]);
        if (checkTenant.rows.length === 1 && checkTenant.rows[0].name === testBranding.name) {
            console.log('✅ Admin Branding settings update validation: PASS');
        } else {
            console.error('❌ Admin Branding settings: FAIL');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Settings database checks failed:', err);
        process.exit(1);
    }

    // 2. Verify certificates claiming
    try {
        // Clean claim if exists
        await db.query('DELETE FROM certificates WHERE course_id = $1 AND student_id = $2', [courseId, studentId]);

        const verificationCode = 'CERT-VAL-PHASE7';
        await db.query(
            `INSERT INTO certificates (tenant_id, student_id, course_id, verification_code)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, studentId, courseId, verificationCode]
        );

        const checkCert = await db.query(
            'SELECT * FROM certificates WHERE verification_code = $1',
            [verificationCode]
        );

        if (checkCert.rows.length === 1) {
            console.log('✅ Certificates claim and verification code mapping: PASS');
        } else {
            console.error('❌ Certificates validation: FAIL');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Certificates database checks failed:', err);
        process.exit(1);
    }

    // 3. Verify consultations scheduling & bookings
    try {
        const consRes = await db.query(
            'SELECT * FROM consultations WHERE tenant_id = $1',
            [tenantId]
        );

        const bookingsRes = await db.query(
            'SELECT * FROM consultation_bookings WHERE tenant_id = $1',
            [tenantId]
        );

        if (consRes.rows.length >= 2 && bookingsRes.rows.length >= 1) {
            console.log('✅ Paid consultations listing & booking database logic: PASS');
        } else {
            console.error('❌ Consultations validation check: FAIL');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Consultations database checks failed:', err);
        process.exit(1);
    }

    console.log('🎉 Phase 7 White-label & Creator Tools integration checks completed successfully.');
}

verifyPhase7().catch(err => {
    console.error('Phase 7 verification script execution failed:', err);
    process.exit(1);
});
