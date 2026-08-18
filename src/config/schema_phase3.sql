-- Database schema updates for Phase 3: Coupons, Orders, Invoices, Course Enrollments, and Subscriptions

-- 1. Course Enrollments Table (for tracking direct ownership of courses)
CREATE TABLE IF NOT EXISTS course_enrollments (
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, student_id)
);

-- 2. Coupons Table
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    discount_type VARCHAR(50) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(10, 2) NOT NULL,
    max_uses INT DEFAULT 100,
    uses_count INT DEFAULT 0,
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id);

-- 3. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('course', 'membership')),
    item_id UUID NOT NULL, -- course_id or subscription_id
    amount NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) DEFAULT 0.00,
    final_amount NUMERIC(12, 2) NOT NULL,
    coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    payment_gateway VARCHAR(50) DEFAULT 'sandbox' CHECK (payment_gateway IN ('stripe', 'razorpay', 'sandbox')),
    gateway_order_id VARCHAR(255),
    gateway_payment_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

-- 4. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    pdf_url TEXT,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);

-- 5. Creator SaaS Subscriptions Table (SaaS platform plans)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_name VARCHAR(100) NOT NULL CHECK (plan_name IN ('starter', 'growth', 'professional')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);


-- ========================================================
-- SEED DATA FOR PHASE 3 MOCKS
-- ========================================================

-- Seed active discount coupons for ABC Academy
INSERT INTO coupons (id, tenant_id, code, discount_type, discount_value, max_uses, uses_count, expiry_date)
VALUES 
(
    'c1111111-1111-1111-1111-111111111111',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'SAVE10',
    'percentage',
    10.00,
    100,
    0,
    CURRENT_TIMESTAMP + INTERVAL '30 days'
),
(
    'c2222222-2222-2222-2222-222222222222',
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'FLAT50',
    'fixed',
    50.00,
    500,
    0,
    CURRENT_TIMESTAMP + INTERVAL '30 days'
) ON CONFLICT DO NOTHING;

-- Seed a Course Enrollment for student@abc.com to check ownership filters
-- (Course: 'Class 12 Physics (Full Year)' - ID: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1')
-- (User student@abc.com - ID: '33333333-3333-3333-3333-333333333333')
INSERT INTO course_enrollments (course_id, student_id)
VALUES (
    'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT DO NOTHING;
