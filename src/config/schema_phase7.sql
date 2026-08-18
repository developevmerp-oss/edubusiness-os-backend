-- Database schema updates for Phase 7: Certificates and Consultations Booking Systems

-- 1. Certificates Table
CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    verification_code VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_certificates_tenant ON certificates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_certificates_student ON certificates(student_id);

-- 2. Consultations Table
CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    slots TIMESTAMP WITH TIME ZONE[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consultations_tenant ON consultations(tenant_id);

-- 3. Consultation Bookings Table
CREATE TABLE IF NOT EXISTS consultation_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    consultation_id UUID REFERENCES consultations(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    booked_slot TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consultation_bookings_tenant ON consultation_bookings(tenant_id);


-- ========================================================
-- SEED DATA FOR PHASE 7 MOCKS
-- ========================================================

-- Seed consultations for teacher (teacher@abc.com - 11111111-1111-1111-1111-111111111111)
INSERT INTO consultations (id, tenant_id, teacher_id, title, description, price, slots)
VALUES 
(
    '20000000-0000-0000-0000-000000000001',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '11111111-1111-1111-1111-111111111111',
    '1-on-1 Physics Mentorship Session',
    'Get personalized help on complex electrostatics calculations, exam preparations, and IIT-JEE syllabus guidance directly from your head trainer.',
    1200.00,
    ARRAY[
        '2026-08-20T10:00:00Z'::timestamp with time zone,
        '2026-08-20T11:00:00Z'::timestamp with time zone,
        '2026-08-21T14:00:00Z'::timestamp with time zone
    ]
),
(
    '20000000-0000-0000-0000-000000000002',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '11111111-1111-1111-1111-111111111111',
    'JEE Advanced Physics Problem Solving Workshop',
    'A group workshop focusing exclusively on solving previous year JEE Advanced multi-correct options questions.',
    600.00,
    ARRAY[
        '2026-08-25T15:00:00Z'::timestamp with time zone
    ]
) ON CONFLICT DO NOTHING;

-- Seed consultation booking for Rahul
INSERT INTO consultation_bookings (id, tenant_id, consultation_id, student_id, booked_slot, status)
VALUES 
(
    '30000000-0000-0000-0000-000000000001',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '20000000-0000-0000-0000-000000000001',
    '33333333-3333-3333-3333-333333333333',
    '2026-08-20T10:00:00Z'::timestamp with time zone,
    'booked'
) ON CONFLICT DO NOTHING;
