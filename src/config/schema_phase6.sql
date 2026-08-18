-- Database schema updates for Phase 6: AI Tutor and AI Student Risk Analysis Systems

-- 1. AI Tutor Chats
CREATE TABLE IF NOT EXISTS ai_tutor_chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tutor_chats_tenant ON ai_tutor_chats(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tutor_chats_user ON ai_tutor_chats(user_id);

-- 2. AI Risk Analyses Logs
CREATE TABLE IF NOT EXISTS ai_risk_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    attendance_percentage NUMERIC(5, 2) NOT NULL,
    average_score NUMERIC(5, 2) NOT NULL,
    risk_level VARCHAR(50) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
    recommendation TEXT NOT NULL,
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risk_tenant ON ai_risk_analyses(tenant_id);


-- ========================================================
-- SEED DATA FOR PHASE 6 MOCKS
-- ========================================================

-- Seed tutor chat history (student@abc.com - 33333333-3333-3333-3333-333333333333)
-- (Course: 'Class 12 Physics (Full Year)' - ID: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')
INSERT INTO ai_tutor_chats (id, tenant_id, user_id, course_id, message, response)
VALUES 
(
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '33333333-3333-3333-3333-333333333333',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'What is Coulomb''s Law?',
    'Coulomb''s Law states that the electrostatic force of attraction or repulsion between two point charges is directly proportional to the product of the magnitudes of charges and inversely proportional to the square of the distance between them. Formula: F = k * (q1 * q2) / r^2.'
) ON CONFLICT DO NOTHING;

-- Seed Student Risk Logs
INSERT INTO ai_risk_analyses (id, tenant_id, student_id, attendance_percentage, average_score, risk_level, recommendation)
VALUES 
(
    '10000000-0000-0000-0000-000000000001',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '55555555-5555-5555-5555-555555555555', -- Amit Sharma
    45.00,
    52.00,
    'high',
    'Warning: Student attendance is extremely low (45%). Recommend immediate teacher check-in and parental notification to assess learning difficulties.'
),
(
    '10000000-0000-0000-0000-000000000002',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '33333333-3333-3333-3333-333333333333', -- Rahul
    91.00,
    78.00,
    'low',
    'Good: Student is performing well with high attendance rates. Suggest maintaining current learning schedule.'
) ON CONFLICT DO NOTHING;
