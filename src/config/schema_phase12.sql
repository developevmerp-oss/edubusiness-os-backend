-- ==============================================================================
-- PHASE 12: PAYMENT GATEWAY CONFIGURATIONS & WEBHOOKS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS payment_gateway_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    active_gateway VARCHAR(50) DEFAULT 'sandbox' CHECK (active_gateway IN ('sandbox', 'razorpay', 'stripe')),
    razorpay_key_id VARCHAR(255),
    razorpay_key_secret VARCHAR(255),
    razorpay_webhook_secret VARCHAR(255),
    stripe_publishable_key VARCHAR(255),
    stripe_secret_key VARCHAR(255),
    stripe_webhook_secret VARCHAR(255),
    is_test_mode BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_configs_tenant ON payment_gateway_configs(tenant_id);
