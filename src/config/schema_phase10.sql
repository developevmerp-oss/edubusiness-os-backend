-- ========================================================
-- Phase 4 Schema: Digital Products Storefront, Course Bundles,
-- and White-Label Native Android / PWA Mobile App Builder
-- ========================================================

-- 1. Course Bundles & Combo Super Packs
CREATE TABLE IF NOT EXISTS course_bundles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    bundle_price NUMERIC(10,2) NOT NULL,
    original_price NUMERIC(10,2) NOT NULL,
    discount_percentage INT DEFAULT 25,
    courses_included JSONB NOT NULL DEFAULT '[]',
    thumbnail_url TEXT,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_course_bundles_tenant ON course_bundles(tenant_id);

-- 2. Creator Digital Products (PDF Notes, Formula Cheat Sheets, Question Banks)
CREATE TABLE IF NOT EXISTS digital_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) DEFAULT 'Formula Notes',
    price NUMERIC(10,2) NOT NULL,
    file_url TEXT NOT NULL,
    preview_url TEXT,
    downloads_count INT DEFAULT 0,
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_digital_products_tenant ON digital_products(tenant_id);

-- 3. Digital Product Purchases & Unlock Ledger
CREATE TABLE IF NOT EXISTS digital_product_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES digital_products(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- 4. White-Label Mobile App & PWA Configurator
CREATE TABLE IF NOT EXISTS mobile_app_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    app_name VARCHAR(100) NOT NULL,
    package_name VARCHAR(150) NOT NULL,
    version_name VARCHAR(20) DEFAULT '1.0.0',
    version_code INT DEFAULT 1,
    primary_color VARCHAR(10) DEFAULT '#6366f1',
    splash_bg_color VARCHAR(10) DEFAULT '#0a0b10',
    app_icon_url TEXT,
    splash_logo_url TEXT,
    feature_graphic_url TEXT,
    enable_offline_mode BOOLEAN DEFAULT TRUE,
    enable_push_notifications BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
