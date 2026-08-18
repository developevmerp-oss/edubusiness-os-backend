-- Schema for EduBusiness OS Phase 1 - Multi-tenant Core
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    branding JSONB DEFAULT '{"primaryColor": "#6366f1", "secondaryColor": "#ec4899", "themeMode": "dark"}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'teacher', 'student', 'parent')),
    phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- Email must be unique per tenant
    UNIQUE(tenant_id, email)
);

-- Index for tenant users lookup
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 3. Parent-Student Mapping (for tracking student performance)
CREATE TABLE IF NOT EXISTS parents_students (
    parent_id UUID REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, student_id)
);

-- 4. Courses Table
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) DEFAULT 0.00,
    is_published BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_courses_tenant ON courses(tenant_id);

-- 5. Batches Table
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    schedule JSONB, -- list of slots, e.g. [{"day": "Monday", "startTime": "09:00", "endTime": "10:00"}]
    start_date DATE,
    end_date DATE,
    capacity INT,
    fees NUMERIC(12, 2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_batches_course ON batches(course_id);

-- 6. Batch Student Enrollment Table
CREATE TABLE IF NOT EXISTS batch_students (
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id, student_id)
);

-- 7. Attendance Table
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    remarks TEXT,
    marked_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_id, student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_date ON attendance(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);

-- 8. Fees Table (Billing Schedules)
CREATE TABLE IF NOT EXISTS fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
    amount_due NUMERIC(12, 2) NOT NULL,
    amount_paid NUMERIC(12, 2) DEFAULT 0.00,
    due_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'partially_paid', 'overdue')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fees_tenant ON fees(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);

-- 9. Fee Payments Table (Transaction Logs)
CREATE TABLE IF NOT EXISTS fee_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    fee_id UUID REFERENCES fees(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('cash', 'card', 'upi', 'bank_transfer')),
    transaction_reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON fee_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_fee ON fee_payments(fee_id);


-- ==========================================
-- SEED DATA FOR DEMO & TESTING
-- ==========================================

-- Seed Demo Tenant: ABC Academy (abc)
INSERT INTO tenants (id, name, subdomain, branding)
VALUES (
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'ABC Academy',
    'abc',
    '{"primaryColor": "#6366f1", "secondaryColor": "#ec4899", "themeMode": "dark"}'::jsonb
) ON CONFLICT (subdomain) DO NOTHING;

-- Seed Users for ABC Academy
-- Password is 'password123' (bcrypt hash)
-- Hash generated for password123: $2b$10$tJ09M78B3wz6Qy7G/rO47.rQ58N45zFh67QfC7KshG98J9F45hL42
-- (or similar standard hash)
INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, status)
VALUES 
(
    '11111111-1111-1111-1111-111111111111',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'admin@abc.com',
    '$2b$10$iF.mO.XAQC4c3QkekrXE0ey0IWND.eXTO5bDVQDQ0pzuyY9VaLV7i',
    'Vatsal',
    'Chaudhari',
    'admin',
    'active'
),
(
    '22222222-2222-2222-2222-222222222222',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'teacher@abc.com',
    '$2b$10$iF.mO.XAQC4c3QkekrXE0ey0IWND.eXTO5bDVQDQ0pzuyY9VaLV7i',
    'Vikram',
    'Sharma',
    'teacher',
    'active'
),
(
    '33333333-3333-3333-3333-333333333333',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'student@abc.com',
    '$2b$10$iF.mO.XAQC4c3QkekrXE0ey0IWND.eXTO5bDVQDQ0pzuyY9VaLV7i',
    'Rahul',
    'Kumar',
    'student',
    'active'
),
(
    '44444444-4444-4444-4444-444444444444',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'parent@abc.com',
    '$2b$10$iF.mO.XAQC4c3QkekrXE0ey0IWND.eXTO5bDVQDQ0pzuyY9VaLV7i',
    'Sanjay',
    'Kumar',
    'parent',
    'active'
) ON CONFLICT DO NOTHING;

-- Map Parent to Student
INSERT INTO parents_students (parent_id, student_id)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT DO NOTHING;

-- Seed Demo Course: Physics Class 12
INSERT INTO courses (id, tenant_id, title, description, price, is_published, created_by)
VALUES (
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Class 12 Physics (Full Year)',
    'Comprehensive syllabus covering Electrostatics, Magnetism, Optics, and Modern Physics.',
    5000.00,
    TRUE,
    '11111111-1111-1111-1111-111111111111'
) ON CONFLICT DO NOTHING;

-- Seed Demo Batch: Batch A (Physics)
INSERT INTO batches (id, tenant_id, course_id, teacher_id, name, schedule, start_date, end_date, capacity, fees)
VALUES (
    'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    '22222222-2222-2222-2222-222222222222',
    'Batch A (Electrostatics)',
    '[{"day": "Monday", "startTime": "09:00", "endTime": "10:00"}, {"day": "Wednesday", "startTime": "09:00", "endTime": "10:00"}]'::jsonb,
    '2026-08-01',
    '2027-05-31',
    50,
    5000.00
) ON CONFLICT DO NOTHING;

-- Enroll Rahul in Batch A
INSERT INTO batch_students (batch_id, student_id)
VALUES (
    'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT DO NOTHING;

-- Seed some mock attendance records for Rahul
INSERT INTO attendance (tenant_id, batch_id, student_id, date, status, remarks, marked_by)
VALUES 
('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', '33333333-3333-3333-3333-333333333333', '2026-08-10', 'present', 'Attended on time', '22222222-2222-2222-2222-222222222222'),
('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', '33333333-3333-3333-3333-333333333333', '2026-08-12', 'present', 'Active in class discussion', '22222222-2222-2222-2222-222222222222'),
('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d', 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', '33333333-3333-3333-3333-333333333333', '2026-08-14', 'absent', 'Informed leaves', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

-- Seed mock fees schedule for Rahul
INSERT INTO fees (id, tenant_id, student_id, batch_id, amount_due, amount_paid, due_date, status)
VALUES (
    'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    '33333333-3333-3333-3333-333333333333',
    'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1',
    5000.00,
    2000.00,
    '2026-08-31',
    'partially_paid'
) ON CONFLICT DO NOTHING;

-- Seed partial payment
INSERT INTO fee_payments (tenant_id, fee_id, amount, payment_method, transaction_reference, notes)
VALUES (
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'f1f1f1f1-f1f1-f1f1-f1f1-f1f1f1f1f1f1',
    2000.00,
    'upi',
    'UPI-PAY-729831',
    'First installment paid'
) ON CONFLICT DO NOTHING;
