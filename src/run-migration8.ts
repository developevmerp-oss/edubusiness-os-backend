import fs from 'fs';
import path from 'path';
import { db } from './config/db';

async function runMigration() {
    console.log('🚀 Running Phase 8 Database Migration...');
    try {
        const sqlPath = path.join(__dirname, 'config/schema_phase8.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        await db.query(sql);
        console.log('✅ Phase 8 Tables (doubts, assignments, assignment_submissions, fee_installments) created successfully!');

        // Seed sample data for demonstration if none exists
        const tenantId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
        const studentId = '33333333-3333-3333-3333-333333333333'; // Rahul Verma
        const teacherId = '11111111-1111-1111-1111-111111111111'; // Head Trainer
        const courseId = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'; // Physics

        // Check if sample doubts exist
        const doubtCheck = await db.query('SELECT id FROM doubts WHERE tenant_id = $1', [tenantId]);
        if (doubtCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO doubts (tenant_id, student_id, course_id, subject, title, description, status, assigned_to, resolution_notes, is_public_faq)
                VALUES 
                (
                    $1, $2, $3, 'Physics', 'Confusion in Gauss Law Cylinder Integration',
                    'In problem 4 of Chapter 2, when calculating electric flux through an infinite cylinder, why does the flux through the circular end caps become zero? Can you explain step-by-step?',
                    'resolved', $4,
                    'Because the electric field vector E is radially outward (perpendicular to curved surface). At the end flat caps, E is parallel to the surface, making the angle theta = 90 degrees. Since flux = E * A * cos(90), cos(90) = 0, so flux through the end caps is identically zero.',
                    true
                ),
                (
                    $1, $2, $3, 'Mathematics', 'Derivation of Dot Product vs Cross Product vector rules',
                    'How do we prove that A x B = - (B x A) using determinant matrix expansion?',
                    'open', $4, null, false
                )
            `, [tenantId, studentId, courseId, teacherId]);
            console.log('✅ Seeded demo doubt tickets!');
        }

        // Check if sample assignment exists
        const assignCheck = await db.query('SELECT id FROM assignments WHERE tenant_id = $1', [tenantId]);
        if (assignCheck.rows.length === 0) {
            // Find batch
            const batchRes = await db.query('SELECT id FROM batches WHERE tenant_id = $1 LIMIT 1', [tenantId]);
            const batchId = batchRes.rows[0]?.id;

            if (batchId) {
                const newAssign = await db.query(`
                    INSERT INTO assignments (tenant_id, course_id, batch_id, title, description, due_date, total_marks, created_by)
                    VALUES ($1, $2, $3, 'Electrodynamics & Charge Distribution Worksheet 1',
                            'Complete questions 1 to 15 from Chapter 1. Show all intermediate formula derivations and numerical units.',
                            NOW() + INTERVAL '7 days', 50.00, $4)
                    RETURNING id
                `, [tenantId, courseId, batchId, teacherId]);

                await db.query(`
                    INSERT INTO assignment_submissions (tenant_id, assignment_id, student_id, submission_content, marks_obtained, feedback, status, graded_by, graded_at)
                    VALUES ($1, $2, $3, 'Submitted my derivations for problems 1 through 15 in handwritten format.', 46.50, 'Excellent work on Gauss Law application. Minor unit conversion mistake in Question 7.', 'graded', $4, NOW())
                `, [tenantId, newAssign.rows[0].id, studentId, teacherId]);
                console.log('✅ Seeded demo assignment and submission!');
            }
        }

        // Check if sample fee installments exist
        const installmentCheck = await db.query('SELECT id FROM fee_installments WHERE tenant_id = $1', [tenantId]);
        if (installmentCheck.rows.length === 0) {
            await db.query(`
                INSERT INTO fee_installments (tenant_id, student_id, course_id, installment_number, amount, due_date, status, paid_at)
                VALUES 
                ($1, $2, $3, 1, 15000.00, CURRENT_DATE - INTERVAL '30 days', 'paid', NOW() - INTERVAL '30 days'),
                ($1, $2, $3, 2, 15000.00, CURRENT_DATE + INTERVAL '10 days', 'pending', null),
                ($1, $2, $3, 3, 15000.00, CURRENT_DATE + INTERVAL '40 days', 'pending', null)
            `, [tenantId, studentId, courseId]);
            console.log('✅ Seeded demo fee installments schedule!');
        }

        console.log('🎉 Phase 8 Database Migration & Seed completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
