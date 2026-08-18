-- Database schema updates for Phase 2: LMS content, Exams, and Live Classes

-- 1. Course Sections
CREATE TABLE IF NOT EXISTS course_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sections_course ON course_sections(course_id);

-- 2. Course Materials (Syllabus elements: Video, PDF, links)
CREATE TABLE IF NOT EXISTS course_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES course_sections(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('video', 'pdf', 'notes', 'link')),
    url TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_materials_section ON course_materials(section_id);

-- 3. Exams Table
CREATE TABLE IF NOT EXISTS exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INT NOT NULL,
    total_marks NUMERIC(10, 2) NOT NULL,
    negative_marks NUMERIC(10, 2) DEFAULT 0.00,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exams_tenant ON exams(tenant_id);

-- 4. Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('mcq', 'true_false', 'fill_blank', 'descriptive')),
    question_text TEXT NOT NULL,
    options JSONB, -- For MCQ options, e.g. ["A", "B", "C", "D"]
    correct_answer TEXT NOT NULL, -- "A" for MCQs, "true"/"false" for true/false, text for fill/description
    difficulty VARCHAR(50) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);

-- 5. Exam Attempts Tracking
CREATE TABLE IF NOT EXISTS exam_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP WITH TIME ZONE,
    score NUMERIC(10, 2),
    status VARCHAR(50) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed', 'graded'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id);

-- 6. Exam Student Answers
CREATE TABLE IF NOT EXISTS exam_answers (
    attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    selected_answer TEXT,
    is_correct BOOLEAN,
    marks_obtained NUMERIC(10, 2),
    PRIMARY KEY (attempt_id, question_id)
);

-- 7. Live Classes scheduling
CREATE TABLE IF NOT EXISTS live_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    topic VARCHAR(255),
    meeting_link TEXT NOT NULL,
    provider VARCHAR(50) DEFAULT 'jitsi' CHECK (provider IN ('zoom', 'google_meet', 'jitsi', 'custom')),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INT DEFAULT 60,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_live_tenant ON live_classes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_live_batch ON live_classes(batch_id);


-- ========================================================
-- SEED DATA FOR PHASE 2 MOCKS
-- ========================================================

-- Seed Course sections inside 'Class 12 Physics (Full Year)'
INSERT INTO course_sections (id, course_id, title, sort_order)
VALUES (
    'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'Module 1: Electrostatic Force & Fields',
    1
) ON CONFLICT DO NOTHING;

-- Seed Course Materials inside the section
INSERT INTO course_materials (id, section_id, title, type, url, sort_order)
VALUES 
(
    'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1',
    'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    'Lecture 1: Introduction to Coulomb''s Law',
    'video',
    'https://www.w3schools.com/html/mov_bbb.mp4', -- Dummy HTML5 test video URL
    1
),
(
    'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2',
    'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1',
    'Syllabus Notes: Electrostatic Fields PDF',
    'pdf',
    'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', -- Dummy PDF URL
    2
) ON CONFLICT DO NOTHING;

-- Seed an Exam in ABC Academy
INSERT INTO exams (id, tenant_id, title, description, duration_minutes, total_marks, negative_marks, is_published)
VALUES (
    'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Physics Unit Test 1: Electrostatics',
    'Evaluates concepts of Coulomb''s law, electric flux, Gauss law, and capacitor circuits.',
    30,
    15.00,
    0.25,
    TRUE
) ON CONFLICT DO NOTHING;

-- Seed Exam Questions
INSERT INTO questions (id, tenant_id, exam_id, type, question_text, options, correct_answer, difficulty, explanation)
VALUES 
(
    '91111111-1111-1111-1111-111111111111',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
    'mcq',
    'What happens to the electrostatic force between two point charges if the distance between them is halved?',
    '["Force becomes four times", "Force is doubled", "Force is halved", "Force is quartered"]'::jsonb,
    'Force becomes four times',
    'easy',
    'By Coulomb''s Law, force is inversely proportional to the square of distance. Halving distance (1/2) squares to 4 times the force.'
),
(
    '92222222-2222-2222-2222-222222222222',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
    'true_false',
    'The electric field inside a perfectly conducting hollow sphere is always zero.',
    '["true", "false"]'::jsonb,
    'true',
    'medium',
    'According to Gauss''s Law, because there is no net enclosed charge inside the hollow space of a conductor, the electric field is zero.'
),
(
    '93333333-3333-3333-3333-333333333333',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2',
    'descriptive',
    'State Coulomb''s Law and explain its limitations.',
    NULL,
    'Coulomb''s law states that force is directly proportional to product of charges and inversely proportional to square of distance. Only applies to point charges at rest.',
    'hard',
    'Ensure you mention limitations: point charges only, at rest only, and inapplicable at sub-atomic distances (< 10^-15 m).'
) ON CONFLICT DO NOTHING;

-- Seed Live class
INSERT INTO live_classes (id, tenant_id, batch_id, title, topic, meeting_link, provider, scheduled_at, duration_minutes)
VALUES (
    '81111111-1111-1111-1111-111111111111',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
    'Thermodynamics Live Lecture',
    'First law of thermodynamics and cyclic processes',
    'https://meet.jit.si/edubusiness-physics-class',
    'jitsi',
    CURRENT_TIMESTAMP + INTERVAL '1 day',
    60
) ON CONFLICT DO NOTHING;
