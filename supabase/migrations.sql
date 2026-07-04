-- ===================================================
-- MIGRATIONS (run these if upgrading an existing database)
-- These are additive changes on top of schema.sql
-- ===================================================

-- Add internal_note to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- Add planned_delivery_date to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS planned_delivery_date DATE;

-- Add preferred_delivery_time to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preferred_delivery_time TEXT;

-- Add failed_reason to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS failed_reason TEXT;

-- Add has_waybill to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_waybill BOOLEAN DEFAULT false;

-- Add alert_configs table if not exists
CREATE TABLE IF NOT EXISTS alert_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id),
  alert_type TEXT NOT NULL,
  threshold_hours INT,
  threshold_count INT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add username/password fields to staff_users if migrating from phone+PIN
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS password TEXT;

-- Update username from phone for existing staff (one-time migration)
-- UPDATE staff_users SET username = phone WHERE username IS NULL;
-- UPDATE staff_users SET password = pin WHERE password IS NULL AND pin IS NOT NULL;

-- Ensure is_active flag exists on staff_users
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add staff_code if missing on staff_users
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS staff_code TEXT;

-- Add short_code to businesses if missing
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Index for order searches
CREATE INDEX IF NOT EXISTS idx_orders_planned_delivery ON orders(planned_delivery_date);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
