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

-- ===================================================
-- Returned Goods Management
-- ===================================================

-- Inspection & repair stock buckets
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS quantity_inspection INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_repair INT DEFAULT 0;

-- Return assessment records — one per returned product line
CREATE TABLE IF NOT EXISTS returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_number TEXT NOT NULL UNIQUE,
  order_id UUID REFERENCES orders(id),
  order_number TEXT,
  customer_name TEXT,
  business_id UUID REFERENCES businesses(id),
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  warehouse_id UUID REFERENCES warehouses(id),
  return_date DATE DEFAULT CURRENT_DATE,

  -- Assessment (filled when processed)
  reason TEXT,                 -- changed_mind, rejected_on_delivery, wrong_product, wrong_colour, wrong_size, damaged_delivery, factory_defect, missing_parts, complaint, exchange, other
  reason_note TEXT,
  outcome TEXT,                -- restocked, inspection, repair, damaged, written_off, supplier_return, display_item, other
  outcome_note TEXT,
  customer_resolution TEXT,    -- no_refund, full_refund, partial_refund, exchanged, store_credit, replacement_sent
  refund_amount DECIMAL(15,2) DEFAULT 0,

  -- Exchange details (when customer_resolution = exchanged)
  replacement_product_id UUID REFERENCES products(id),
  replacement_product_name TEXT,
  replacement_quantity INT,
  replacement_order_number TEXT,
  difference_paid DECIMAL(15,2) DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'awaiting_inspection',  -- awaiting_inspection / completed
  created_by UUID REFERENCES staff_users(id),
  processed_by UUID REFERENCES staff_users(id),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);

-- Timeline of everything that happened to a return
CREATE TABLE IF NOT EXISTS return_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID REFERENCES returns(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT,
  staff_id UUID REFERENCES staff_users(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_timeline_return ON return_timeline(return_id);

-- ===================================================
-- Delivery Fee Pending workflow
-- ===================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_pending BOOLEAN DEFAULT false;

-- ===================================================
-- Staff Management (HR): profiles, leave, discipline,
-- documents, private notes
-- ===================================================

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,   -- full_time / part_time / contract / intern
  ADD COLUMN IF NOT EXISTS date_joined DATE,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',  -- active / on_leave / suspended / inactive
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

CREATE TABLE IF NOT EXISTS staff_leave (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL,   -- annual / sick / maternity / emergency / unpaid / other
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected / cancelled
  reviewed_by UUID REFERENCES staff_users(id),
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_leave_staff ON staff_leave(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_leave_status ON staff_leave(status);

CREATE TABLE IF NOT EXISTS staff_warnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  warning_type TEXT NOT NULL,   -- verbal / first_written / final_written / performance / attendance / misconduct / policy_violation / customer_complaint / other
  category TEXT,
  incident_details TEXT,
  corrective_action TEXT,
  review_date DATE,
  consequence TEXT,
  issued_by UUID REFERENCES staff_users(id),
  issued_by_name TEXT,
  date_issued DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_warnings_staff ON staff_warnings(staff_id);

CREATE TABLE IF NOT EXISTS staff_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,   -- employment_agreement / offer_letter / job_description / salary_increment / warning_letter / suspension_letter / leave_approval / promotion_letter / performance_review / other
  title TEXT NOT NULL,
  file_url TEXT,            -- external link (e.g. Drive) when uploaded elsewhere
  source TEXT DEFAULT 'manual',  -- manual / generated (rebuilt as PDF on demand)
  body TEXT,                -- letter body for generated documents
  reference_id UUID,        -- e.g. staff_warnings.id for warning letters
  notes TEXT,
  uploaded_by UUID REFERENCES staff_users(id),
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_documents_staff ON staff_documents(staff_id);

CREATE TABLE IF NOT EXISTS staff_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID REFERENCES staff_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_notes_staff ON staff_notes(staff_id);

-- ===================================================
-- State-based fulfillment + State Park workflow
-- ===================================================

-- States each fulfillment officer covers
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS assigned_states TEXT[] DEFAULT '{}';

-- State Park pickup / warehouse receipt details on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS rider_phone TEXT,
  ADD COLUMN IF NOT EXISTS park_pickup_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_qty INT,
  ADD COLUMN IF NOT EXISTS warehouse_received_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_condition TEXT;

-- ===================================================
-- Per-state transit tracking for waybill batches
-- ===================================================
CREATE TABLE IF NOT EXISTS waybill_batch_state_arrivals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES waybill_batches(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_phone TEXT NOT NULL,
  park_address TEXT,
  notes TEXT,
  confirmed_by UUID REFERENCES staff_users(id),
  confirmed_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, state)
);
CREATE INDEX IF NOT EXISTS idx_wbsa_batch ON waybill_batch_state_arrivals(batch_id);

-- ===================================================
-- Returned order workflow (condition, decision, re-shipment)
-- ===================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS return_condition TEXT,
  ADD COLUMN IF NOT EXISTS return_photos TEXT,
  ADD COLUMN IF NOT EXISTS return_decision TEXT,
  ADD COLUMN IF NOT EXISTS return_decision_notes TEXT,
  ADD COLUMN IF NOT EXISTS return_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS park_sent_name TEXT,
  ADD COLUMN IF NOT EXISTS park_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS park_sent_by TEXT,
  ADD COLUMN IF NOT EXISTS park_origin_state TEXT;

-- ===================================================
-- Product Holding Queue — products detached from failed
-- orders, awaiting their next logistics decision
-- ===================================================
CREATE TABLE IF NOT EXISTS holding_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  state TEXT NOT NULL,
  city TEXT,
  park_name TEXT,
  park_location TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_role TEXT,     -- driver / park_manager / stockkeeper / other
  custodian_id UUID REFERENCES staff_users(id),
  custodian_name TEXT,
  source_order_id UUID REFERENCES orders(id),
  source_order_number TEXT,
  status TEXT NOT NULL DEFAULT 'holding',  -- holding / collected / warehouse / transferred / damaged
  business_id UUID REFERENCES businesses(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_holding_state ON holding_queue(state);
CREATE INDEX IF NOT EXISTS idx_holding_status ON holding_queue(status);

-- Waybill batches can now leave from a holding-queue product
ALTER TABLE waybill_batches
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'warehouse',
  ADD COLUMN IF NOT EXISTS source_holding_id UUID REFERENCES holding_queue(id),
  ADD COLUMN IF NOT EXISTS source_details TEXT;

-- ===================================================
-- Business Expenses — paid-to, receipts, edit audit
-- and void-instead-of-delete
-- ===================================================
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_to TEXT,
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',  -- active / voided
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT,
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;

-- ===================================================
-- Product catalogue governance & warehouse management
-- (Operations Manager permissions)
-- ===================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS first_order_id UUID REFERENCES orders(id),
  ADD COLUMN IF NOT EXISTS first_order_number TEXT,
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Audit trail for every catalogue action (verify, edit, merge,
-- deactivate, reactivate, business reassignment)
CREATE TABLE IF NOT EXISTS product_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID,
  action TEXT NOT NULL,
  details TEXT,
  staff_id UUID REFERENCES staff_users(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_audit_product ON product_audit(product_id);

-- ===================================================
-- Business branding & bank details for invoices
-- ===================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT;

-- ===================================================
-- CEO-only permanent order deletion audit
-- ===================================================
CREATE TABLE IF NOT EXISTS deleted_order_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  business_name TEXT,
  total_amount DECIMAL(15,2),
  previous_status TEXT,
  reason TEXT,
  notes TEXT,
  customer_deleted BOOLEAN DEFAULT false,
  deleted_by_id UUID,
  deleted_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- Password security: hashed passwords, forced change,
-- CEO recovery email
-- ===================================================
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_salt TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_email TEXT;
