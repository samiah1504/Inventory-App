-- ===================================================
-- MIGRATIONS (run these if upgrading an existing database)
-- These are additive changes on top of schema.sql
-- ===================================================

-- ===================================================
-- Waybill Batch Enhancements (packing, expenses, timeline)
-- ===================================================

ALTER TABLE waybill_batches
  ADD COLUMN IF NOT EXISTS waybill_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loading_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transport_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_notes TEXT,
  ADD COLUMN IF NOT EXISTS expenses_saved BOOLEAN DEFAULT false;

ALTER TABLE waybill_batch_orders
  ADD COLUMN IF NOT EXISTS allocated_logistics_cost DECIMAL(15,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS waybill_batch_packing_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES waybill_batches(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  is_packed BOOLEAN DEFAULT false,
  packed_at TIMESTAMPTZ,
  packed_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waybill_batch_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES waybill_batches(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  notes TEXT,
  staff_id UUID REFERENCES staff_users(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add internal_note to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- Add planned_delivery_date to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS planned_delivery_date DATE;

-- Add preferred_delivery_time to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preferred_delivery_time TEXT;

-- Add failed_reason to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS failed_reason TEXT;

-- Add return_reason to orders if missing
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_reason TEXT;

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

-- Order items table for multi-product orders
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  color TEXT,
  size TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for order searches
CREATE INDEX IF NOT EXISTS idx_orders_planned_delivery ON orders(planned_delivery_date);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- ===================================================
-- Waybill Batch — per-state expenses & source warehouse
-- ===================================================

-- Source warehouse/location the batch is leaving from
ALTER TABLE waybill_batches ADD COLUMN IF NOT EXISTS source_warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE waybill_batches ADD COLUMN IF NOT EXISTS source_state TEXT;
ALTER TABLE waybill_batches ADD COLUMN IF NOT EXISTS source_city TEXT;

-- Per-state expenses (replaces the flat cost columns for new batches)
CREATE TABLE IF NOT EXISTS waybill_batch_state_expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES waybill_batches(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  destination_city TEXT,
  waybill_cost DECIMAL(15,2) DEFAULT 0,
  packaging_cost DECIMAL(15,2) DEFAULT 0,
  loading_cost DECIMAL(15,2) DEFAULT 0,
  transport_cost DECIMAL(15,2) DEFAULT 0,
  dispatch_cost DECIMAL(15,2) DEFAULT 0,
  other_cost DECIMAL(15,2) DEFAULT 0,
  expense_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, state)
);

CREATE INDEX IF NOT EXISTS idx_wbse_batch ON waybill_batch_state_expenses(batch_id);

-- Store all order line items as JSON directly on the order row
-- This is the primary storage; order_items table is kept for joins/querying
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_data JSONB;
