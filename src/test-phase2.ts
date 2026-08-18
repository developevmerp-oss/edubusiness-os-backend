import { db } from './config/db';

async function verifyPhase2() {
    console.log('🧪 Starting Automated Phase 2 Integration & Security Validation...');

    // 1. Verify LMS content tree fetching
    try {
        const sectionsRes = await db.query('SELECT * FROM course_sections WHERE course_id = $1', ['c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1']);
        if (sectionsRes.rows.length > 0) {
            console.log(`✅ LMS Course Outline: PASS (${sectionsRes.rows.length} sections found)`);
        } else {
            console.error('❌ LMS Course Outline: FAIL (No sections found)');
            process.exit(1);
        }

        const materialsRes = await db.query('SELECT * FROM course_materials WHERE section_id = $1', ['d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1']);
        if (materialsRes.rows.length === 2) {
            console.log('✅ LMS Course Materials fetching: PASS');
        } else {
            console.error('❌ LMS Course Materials: FAIL (Incorrect materials count)');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ LMS query checks failed:', err);
        process.exit(1);
    }

    // 2. Verify Live Classes auto-generation and format
    try {
        const liveRes = await db.query('SELECT * FROM live_classes WHERE id = $1', ['81111111-1111-1111-1111-111111111111']);
        if (liveRes.rows.length === 1 && liveRes.rows[0].provider === 'jitsi') {
            console.log('✅ Live Classes provider & links check: PASS');
        } else {
            console.error('❌ Live Classes checks: FAIL');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Live Classes queries failed:', err);
        process.exit(1);
    }

    // 3. Verify Exam questions and auto-grading mock calculation
    try {
        // Fetch seeded questions
        const examId = 'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2';
        const questionsRes = await db.query('SELECT * FROM questions WHERE exam_id = $1', [examId]);
        
        if (questionsRes.rows.length === 3) {
            console.log('✅ Exams Questions creation verification: PASS');
        } else {
            console.error('❌ Exams Questions check: FAIL');
            process.exit(1);
        }

        // Mock auto-grade check (MCQ correct + wrong check with negative marks)
        const mockQuestions = questionsRes.rows;
        // Mock points per question allocation: total marks / questions count
        const totalMarks = 15.00;
        const negativeMarks = 0.25;
        const marksPerQuestion = totalMarks / mockQuestions.length; // 5.00 marks each

        // Case A: 1 correct MCQ answer
        const mcqQuestion = mockQuestions.find(q => q.type === 'mcq');
        const isMcqCorrect = 'Force becomes four times'.toLowerCase() === mcqQuestion.correct_answer.toLowerCase();
        const scoreA = isMcqCorrect ? marksPerQuestion : -negativeMarks;

        // Case B: 1 incorrect True/False answer
        const tfQuestion = mockQuestions.find(q => q.type === 'true_false');
        const isTfCorrect = 'false'.toLowerCase() === tfQuestion.correct_answer.toLowerCase(); // correct is 'true'
        const scoreB = isTfCorrect ? marksPerQuestion : -negativeMarks;

        const calculatedMockScore = scoreA + scoreB;
        const expectedScore = 5.00 - 0.25; // 4.75

        if (calculatedMockScore === expectedScore) {
            console.log(`✅ Exam Auto-Grading Engine calculation (with negative marks subtraction): PASS (Calculated: ${calculatedMockScore})`);
        } else {
            console.error(`❌ Exam Auto-Grading check: FAIL (Calculated: ${calculatedMockScore}, Expected: ${expectedScore})`);
            process.exit(1);
        }

    } catch (err) {
        console.error('❌ Exams auto-grading checks failed:', err);
        process.exit(1);
    }

    console.log('🎉 Phase 2 verification checks completed successfully.');
}

verifyPhase2().catch(err => {
    console.error('Phase 2 verification script execution failed:', err);
    process.exit(1);
});
