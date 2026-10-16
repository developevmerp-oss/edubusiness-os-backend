import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 9 Database Migration...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase9.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 9 Tables (otp_verifications, affiliates, referral_conversions, abandoned_carts) created successfully!');

        // Seed sample data for demonstration if none exists
        const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
        const courseId = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'; // Physics

        // 1. Check if demo affiliates exist
        const affiliateCheck = await db.query('SELECT id FROM affiliates WHERE tenant_id = $1', [tenantId]);
        if (affiliateCheck.rows.length === 0) {
            const aff1 = await db.query(`
                INSERT INTO affiliates (tenant_id, name, email, phone, referral_code, commission_rate, total_earnings, pending_payout, status, upi_id)
                VALUES 
                ($1, 'Karan Sharma (EdTech Creator)', 'karan.creator@youtube.com', '+919876543210', 'KARAN15', 15.00, 14250.00, 3750.00, 'active', 'karan@okhdfcbank'),
                ($1, 'Priya Nair (IIT Mentors)', 'priya.mentors@tutors.in', '+919812345678', 'PRIYAIIT', 20.00, 22000.00, 6000.00, 'active', 'priya@okicici')
                RETURNING id, name, referral_code
            `, [tenantId]);

            const aff1Id = aff1.rows[0]?.id;
            if (aff1Id) {
                // Seed referral conversion
                await db.query(`
                    INSERT INTO referral_conversions (tenant_id, affiliate_id, buyer_name, buyer_email, course_id, course_title, order_amount, commission_amount, status)
                    VALUES 
                    ($1, $2, 'Aman Verma', 'aman.verma@gmail.com', $3, 'Complete JEE Physics Mastery 2026', 4999.00, 749.85, 'approved'),
                    ($1, $2, 'Sneha Patel', 'sneha.patel@gmail.com', $3, 'Complete JEE Physics Mastery 2026', 4999.00, 749.85, 'approved')
                `, [tenantId, aff1Id, courseId]);
            }
            console.log('✅ Seeded demo affiliates & conversion logs!');
        }

        // 2. Check if demo abandoned carts exist
        const cartCheck = await db.query('SELECT id FROM abandoned_carts WHERE tenant_id = $1', [tenantId]);
        if (cartCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO abandoned_carts (tenant_id, student_name, student_phone, student_email, course_id, course_title, cart_value, recovery_status, coupon_code)
                VALUES 
                ($1, 'Rohit Deshmukh', '+919820011223', 'rohit.deshmukh@gmail.com', $2, 'Complete JEE Physics Mastery 2026', 4999.00, 'abandoned', 'RECOVER15'),
                ($1, 'Ananya Sen', '+919830099887', 'ananya.sen@gmail.com', $2, 'NEET Chemistry Crash Course 2026', 3499.00, 'abandoned', 'RECOVER15'),
                ($1, 'Vikram Aditya', '+919840033445', 'vikram.aditya@outlook.com', $2, 'Advanced Mathematics Foundation', 2999.00, 'nudge_sent', 'RECOVER15')
            `, [tenantId, courseId]);
            console.log('✅ Seeded demo abandoned carts for WhatsApp automation!');
        }

        console.log('🎉 Phase 9 Migration & Seeding Complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration Error:', error);
        process.exit(1);
    }
}

runMigration();
