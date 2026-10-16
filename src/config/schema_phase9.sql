-- ========================================================
-- Phase 3 Schema: Growth & Marketing Expansion
-- 1. Phone OTP Verifications
-- 2. Affiliates & Referral Partner Engine
-- 3. Referral Conversions & Payout Requests
-- 4. Abandoned Cart Recovery & Automation Triggers
-- ========================================================

-- 1. Mobile OTP Authentication Table
CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_verifications(phone);

-- 2. Affiliates & Influencer Partner Network
CREATE TABLE IF NOT EXISTS affiliates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    referral_code VARCHAR(50) NOT NULL,
    commission_rate NUMERIC(5,2) DEFAULT 15.00,
    total_earnings NUMERIC(10,2) DEFAULT 0.00,
    pending_payout NUMERIC(10,2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    upi_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, referral_code)
);
CREATE INDEX IF NOT EXISTS idx_affiliates_code ON affiliates(referral_code);

-- 3. Referral Conversions
CREATE TABLE IF NOT EXISTS referral_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
    buyer_name VARCHAR(255) NOT NULL,
    buyer_email VARCHAR(255),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    course_title VARCHAR(255) NOT NULL,
    order_amount NUMERIC(10,2) NOT NULL,
    commission_amount NUMERIC(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Abandoned Carts for WhatsApp Recovery Nudges
CREATE TABLE IF NOT EXISTS abandoned_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_name VARCHAR(255) NOT NULL,
    student_phone VARCHAR(20) NOT NULL,
    student_email VARCHAR(255),
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    course_title VARCHAR(255) NOT NULL,
    cart_value NUMERIC(10,2) NOT NULL,
    recovery_status VARCHAR(20) DEFAULT 'abandoned' CHECK (recovery_status IN ('abandoned', 'nudge_sent', 'recovered')),
    coupon_code VARCHAR(50) DEFAULT 'RECOVER15',
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
