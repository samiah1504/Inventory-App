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

-- ===================================================
-- CEO-only staff deletion (access removed, history kept)
-- The row is retained so every historical record still
-- resolves to the person's name — shown as (Former Staff)
-- ===================================================
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS delete_notes TEXT;

-- ===================================================
-- RLS fix: the base schema enabled Row Level Security on
-- orders and staff_users. The app connects with the anon
-- key, and without an explicit DELETE-capable policy for
-- it, deletes silently remove 0 rows ("0 orders deleted").
-- Recreate the policies so the app key has full access —
-- permissions are enforced by the app's role gates.
-- ===================================================
DROP POLICY IF EXISTS "Allow all authenticated" ON orders;
DROP POLICY IF EXISTS "Allow all authenticated" ON staff_users;
DROP POLICY IF EXISTS "app full access orders" ON orders;
DROP POLICY IF EXISTS "app full access staff" ON staff_users;
CREATE POLICY "app full access orders" ON orders
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "app full access staff" ON staff_users
  FOR ALL USING (true) WITH CHECK (true);

-- ===================================================
-- GUARANTEED RLS FIX — run this even if nothing else.
-- The base schema turned on Row Level Security for
-- orders and staff_users; the live policies let the app
-- read/insert but silently block DELETEs (and some
-- UPDATEs) — Postgres reports success with 0 rows.
-- The app enforces permissions itself (role gates +
-- password re-auth), so RLS on these tables only breaks
-- things. Turn it off.
-- ===================================================
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users DISABLE ROW LEVEL SECURITY;

-- ===================================================
-- Expenses page redesign: payment method on expenses
-- ===================================================
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- ===================================================
-- Staff Profile & Employment Contract module
-- Personal info (staff-owned) is separated from official
-- employment terms (CEO-owned); contracts merge the two.
-- ===================================================

-- Personal profile completed by the staff member
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID UNIQUE REFERENCES staff_users(id) ON DELETE CASCADE,
  dob DATE,
  gender TEXT,
  personal_email TEXT,
  residential_address TEXT,
  state_of_residence TEXT,
  photo_url TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relationship TEXT,
  nok_name TEXT,
  nok_phone TEXT,
  nok_relationship TEXT,
  bank_name TEXT,
  bank_account_name TEXT,
  bank_account_number TEXT,
  id_type TEXT,
  id_number TEXT,
  id_document_url TEXT,
  marital_status TEXT,
  education TEXT,
  work_experience TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft / submitted / returned / verified
  return_note TEXT,
  submitted_at TIMESTAMPTZ,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Official employment terms (CEO/Admin only)
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS salary DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS work_location TEXT,
  ADD COLUMN IF NOT EXISTS working_days TEXT,
  ADD COLUMN IF NOT EXISTS working_hours TEXT,
  ADD COLUMN IF NOT EXISTS probation_period TEXT,
  ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS leave_entitlement TEXT,
  ADD COLUMN IF NOT EXISTS contract_date DATE,
  ADD COLUMN IF NOT EXISTS special_conditions TEXT,
  ADD COLUMN IF NOT EXISTS id_card_issued_at DATE,
  ADD COLUMN IF NOT EXISTS id_card_expiry DATE;

-- Employment contracts (versioned; body editable before issuing)
CREATE TABLE IF NOT EXISTS staff_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft / issued / accepted / superseded
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_contracts_staff ON staff_contracts(staff_id);

-- Change requests for locked personal fields
CREATE TABLE IF NOT EXISTS staff_change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  current_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT,
  document_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_change_requests_staff ON staff_change_requests(staff_id);

-- Full audit history of the onboarding pipeline
CREATE TABLE IF NOT EXISTS staff_profile_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID,
  action TEXT NOT NULL,
  details TEXT,
  actor_id UUID,
  actor_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_profile_audit_staff ON staff_profile_audit(staff_id);

-- ===================================================
-- Holding Queue movement workflow: colour/size from the
-- original order item, plus a per-record history trail
-- ===================================================
ALTER TABLE holding_queue
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT;

CREATE TABLE IF NOT EXISTS holding_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  holding_id UUID REFERENCES holding_queue(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT,
  staff_id UUID,
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_holding_history ON holding_history(holding_id);

-- ===================================================
-- Fix duplicate order numbers.
-- The old counter was per business+year while ORD-YYYY-NNNNN is
-- globally unique, so two businesses eventually produced the same
-- number. One global, atomic sequence now feeds the number,
-- starting above the highest existing order. Deleting orders can
-- never cause reuse, and concurrent staff each get distinct values.
-- ===================================================
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

SELECT setval('order_number_seq', GREATEST(
  COALESCE((
    SELECT MAX((split_part(order_number, '-', 3))::BIGINT)
    FROM orders
    WHERE order_number ~ '^ORD-[0-9]{4}-[0-9]+$'
  ), 0),
  (SELECT last_value FROM order_number_seq)
));

CREATE OR REPLACE FUNCTION get_next_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'ORD-' || EXTRACT(YEAR FROM NOW())::INT || '-' ||
         LPAD(nextval('order_number_seq')::TEXT, 5, '0');
END;
$$;

-- ===================================================
-- Product Verification — confirmed historical cost per order line
-- ===================================================
-- When an unverified product is verified with an official cost price,
-- that cost is stamped onto linked order lines that have none. Lines
-- that already carry a confirmed cost are never overwritten, so past
-- orders keep the cost that was true when they were sold.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost_price DECIMAL(15,2);

-- ===================================================
-- Warning & Disciplinary Action module
-- ===================================================
-- Expands the simple staff_warnings feature (kept untouched, shown as
-- legacy records) into full disciplinary actions with sanctions,
-- month-scoped salary deductions (the base salary record is NEVER
-- edited), employee acknowledgement/response, approval workflow and an
-- insert-only audit trail.

CREATE TABLE IF NOT EXISTS disciplinary_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL DEFAULT 'warning_only',  -- warning_only / warning_with_sanction / sanction_only
  warning_category TEXT,           -- key from the category list, or 'custom'
  custom_category TEXT,
  incident_title TEXT,
  incident_description TEXT,
  incident_date DATE,
  business_impact TEXT,
  previous_discussions TEXT,
  expected_improvement TEXT,
  sanction_type TEXT,              -- percent_deduction / fixed_deduction / suspension_unpaid / suspension_paid / loss_bonus / loss_commission / loss_allowance / written_caution / pip / duty_restriction / demotion / other
  sanction_details TEXT,
  management_note TEXT,
  status TEXT NOT NULL DEFAULT 'issued',  -- draft / pending_approval / issued / rejected / withdrawn / resolved / escalated
  review_date DATE,
  effective_date DATE,
  issued_by UUID REFERENCES staff_users(id),
  issued_by_name TEXT,
  approved_by UUID REFERENCES staff_users(id),
  approved_by_name TEXT,
  issued_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  withdrawn_by_name TEXT,
  withdrawn_at TIMESTAMPTZ,
  withdrawal_reason TEXT,
  employee_opened_at TIMESTAMPTZ,
  employee_acknowledged_at TIMESTAMPTZ,
  employee_response TEXT,
  employee_response_at TIMESTAMPTZ,
  employee_attachment_url TEXT,
  review_requested BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disc_actions_employee ON disciplinary_actions(employee_id);
CREATE INDEX IF NOT EXISTS idx_disc_actions_status ON disciplinary_actions(status);

-- One deduction record per sanctioned action. base_salary_snapshot is
-- captured at issue time so later salary changes never rewrite history.
CREATE TABLE IF NOT EXISTS disciplinary_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disciplinary_action_id UUID REFERENCES disciplinary_actions(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES staff_users(id) ON DELETE CASCADE,
  salary_month TEXT NOT NULL,         -- 'YYYY-MM' of the (first) affected payroll month
  deduction_type TEXT NOT NULL,       -- percent / fixed
  percentage DECIMAL(6,3),
  fixed_amount DECIMAL(15,2),
  base_salary_snapshot DECIMAL(15,2),
  calculated_deduction_amount DECIMAL(15,2),
  expected_net_salary DECIMAL(15,2),
  duration_type TEXT NOT NULL DEFAULT 'one_month',  -- one_month / multi_month / until_stopped
  number_of_months INT DEFAULT 1,
  start_month TEXT,
  end_month TEXT,                     -- null while an until_stopped deduction is running
  payroll_status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled / completed / reversed / stopped
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(disciplinary_action_id)
);
CREATE INDEX IF NOT EXISTS idx_disc_deductions_employee ON disciplinary_deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_disc_deductions_month ON disciplinary_deductions(salary_month);

CREATE TABLE IF NOT EXISTS disciplinary_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disciplinary_action_id UUID REFERENCES disciplinary_actions(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES staff_users(id),
  uploaded_by_name TEXT,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,                     -- screenshot / image / pdf / document / voice_note / other
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disc_attach_action ON disciplinary_attachments(disciplinary_action_id);

-- Insert-only from the app; never edited
CREATE TABLE IF NOT EXISTS disciplinary_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  disciplinary_action_id UUID REFERENCES disciplinary_actions(id) ON DELETE CASCADE,
  performed_by UUID REFERENCES staff_users(id),
  performed_by_name TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disc_audit_action ON disciplinary_audit_logs(disciplinary_action_id);

-- Single-row configuration (id fixed to 1)
CREATE TABLE IF NOT EXISTS disciplinary_settings (
  id INT PRIMARY KEY DEFAULT 1,
  max_deduction_percent DECIMAL(6,3) DEFAULT 20,
  deductions_require_approval BOOLEAN DEFAULT true,
  employees_can_appeal BOOLEAN DEFAULT true,
  appeal_days INT DEFAULT 7,
  default_review_days INT DEFAULT 30,
  payslip_show_reason BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO disciplinary_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ===================================================
-- Inventory v2 — no reservations, goods in transit,
-- damaged goods, weekly stock take, atomic stock changes
-- ===================================================
-- New orders no longer reserve stock. Stock leaves a warehouse only
-- when goods physically leave it: waybilled out (→ Goods in Transit),
-- sold from the shelf (on payment), damaged, transferred or adjusted.
-- Every stock change goes through inventory_apply(), which locks the
-- stock row, refuses to go below zero and writes the movement log in
-- ONE transaction — two staff can no longer overwrite each other.

-- Where an order's goods came from (asked when it is marked Delivered)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_source TEXT,            -- warehouse / supplier_direct
  ADD COLUMN IF NOT EXISTS stock_warehouse_id UUID REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS stock_deducted_at TIMESTAMPTZ;

-- Goods that left a warehouse (or a park) and are on the move
CREATE TABLE IF NOT EXISTS stock_in_transit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  deducted_qty INT NOT NULL DEFAULT 0,      -- units actually taken out of from_warehouse
  color TEXT,
  size TEXT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_number TEXT,
  business_id UUID REFERENCES businesses(id),
  from_warehouse_id UUID REFERENCES warehouses(id),
  from_label TEXT,                          -- e.g. "Ikeja Park" when it left a park
  waybill_batch_id UUID REFERENCES waybill_batches(id) ON DELETE SET NULL,
  holding_id UUID REFERENCES holding_queue(id) ON DELETE SET NULL,
  destination_state TEXT,
  destination_type TEXT DEFAULT 'customer', -- customer / warehouse
  destination_warehouse_id UUID REFERENCES warehouses(id),
  courier TEXT,
  waybill_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_transit', -- in_transit / delivered / at_warehouse / at_park / damaged / returned
  closed_note TEXT,
  closed_at TIMESTAMPTZ,
  closed_by_name TEXT,
  created_by UUID REFERENCES staff_users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transit_order ON stock_in_transit(order_id);
CREATE INDEX IF NOT EXISTS idx_transit_status ON stock_in_transit(status);

-- Every damaged item, wherever it was found
CREATE TABLE IF NOT EXISTS damaged_goods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  business_id UUID REFERENCES businesses(id),
  source TEXT NOT NULL,                     -- warehouse / in_transit / park / return / delivery
  warehouse_id UUID REFERENCES warehouses(id),
  state TEXT,
  location_note TEXT,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_number TEXT,
  reference_id UUID,                        -- transit / holding / return id
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'damaged',   -- damaged / repair / repaired / written_off / supplier_return
  recorded_by UUID REFERENCES staff_users(id),
  recorded_by_name TEXT,
  resolved_note TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_damaged_status ON damaged_goods(status);

-- Weekly stock take: the inventory manager counts blind, the app
-- compares with its own numbers, the CEO approves each correction
CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL DEFAULT 'warehouse',  -- warehouse / park
  warehouse_id UUID REFERENCES warehouses(id),
  business_id UUID REFERENCES businesses(id),
  week_start DATE NOT NULL,                 -- Monday of the counted week
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted / approved
  notes TEXT,
  counted_by UUID REFERENCES staff_users(id),
  counted_by_name TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_week ON stock_counts(week_start);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  count_id UUID REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  holding_id UUID REFERENCES holding_queue(id) ON DELETE SET NULL,
  location_label TEXT,
  system_qty INT NOT NULL DEFAULT 0,
  counted_qty INT NOT NULL DEFAULT 0,
  variance INT NOT NULL DEFAULT 0,          -- counted - system
  status TEXT NOT NULL DEFAULT 'pending',   -- matched / pending / approved / rejected
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_count_lines_count ON stock_count_lines(count_id);

-- One atomic stock change + its movement log entry.
--   p_qty         change to physical (and sellable) stock: + in, - out
--   p_inspection  units moved into (+) / out of (-) the inspection bucket
--   p_clamp       true = take only what is there instead of failing
-- Returns {applied, requested, physical, available}
CREATE OR REPLACE FUNCTION inventory_apply(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_business_id UUID DEFAULT NULL,
  p_qty INT DEFAULT 0,
  p_sold INT DEFAULT 0,
  p_damaged INT DEFAULT 0,
  p_returned INT DEFAULT 0,
  p_inspection INT DEFAULT 0,
  p_movement_type TEXT DEFAULT NULL,
  p_movement_qty INT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_supplier TEXT DEFAULT NULL,
  p_movement_at TIMESTAMPTZ DEFAULT NULL,
  p_clamp BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  r inventory%ROWTYPE;
  v_qty INT := COALESCE(p_qty, 0);
  v_insp INT := COALESCE(p_inspection, 0);
  v_name TEXT;
  v_wh TEXT;
BEGIN
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'A product and a warehouse are needed for a stock change';
  END IF;

  SELECT * INTO r FROM inventory
   WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF v_qty < 0 OR v_insp <> 0 THEN
      IF p_clamp THEN
        RETURN jsonb_build_object('applied', 0, 'requested', v_qty, 'physical', 0, 'available', 0);
      END IF;
      SELECT name INTO v_name FROM products WHERE id = p_product_id;
      SELECT name INTO v_wh FROM warehouses WHERE id = p_warehouse_id;
      RAISE EXCEPTION 'No stock of % in %', COALESCE(v_name, 'this product'), COALESCE(v_wh, 'this warehouse');
    END IF;
    INSERT INTO inventory (product_id, warehouse_id, business_id)
      VALUES (p_product_id, p_warehouse_id, p_business_id)
      ON CONFLICT (product_id, warehouse_id) DO NOTHING;
    SELECT * INTO r FROM inventory
     WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
     FOR UPDATE;
  END IF;

  -- Never below zero: sellable stock must cover what leaves
  IF COALESCE(r.quantity_available, 0) + v_qty - v_insp < 0 THEN
    IF p_clamp AND v_insp = 0 THEN
      v_qty := -GREATEST(COALESCE(r.quantity_available, 0), 0);
    ELSE
      SELECT name INTO v_name FROM products WHERE id = p_product_id;
      SELECT name INTO v_wh FROM warehouses WHERE id = p_warehouse_id;
      RAISE EXCEPTION 'Not enough stock: only % of % available in %',
        GREATEST(COALESCE(r.quantity_available, 0), 0), COALESCE(v_name, 'this product'), COALESCE(v_wh, 'this warehouse');
    END IF;
  END IF;
  IF COALESCE(r.quantity_inspection, 0) + v_insp < 0 THEN
    RAISE EXCEPTION 'Not enough units in inspection for this change';
  END IF;

  UPDATE inventory SET
    quantity_physical   = COALESCE(quantity_physical, 0) + v_qty,
    quantity_available  = COALESCE(quantity_available, 0) + v_qty - v_insp,
    quantity_inspection = COALESCE(quantity_inspection, 0) + v_insp,
    quantity_sold       = COALESCE(quantity_sold, 0) + COALESCE(p_sold, 0),
    quantity_damaged    = COALESCE(quantity_damaged, 0) + COALESCE(p_damaged, 0),
    quantity_returned   = COALESCE(quantity_returned, 0) + COALESCE(p_returned, 0),
    business_id         = COALESCE(business_id, p_business_id),
    updated_at          = NOW()
  WHERE id = r.id
  RETURNING * INTO r;

  IF p_movement_type IS NOT NULL THEN
    INSERT INTO inventory_movements (
      product_id, warehouse_id, business_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, total_cost, supplier, notes,
      staff_id, created_at)
    VALUES (
      p_product_id, p_warehouse_id, COALESCE(r.business_id, p_business_id), p_movement_type,
      COALESCE(p_movement_qty, v_qty),
      p_reference_id, p_reference_type, p_unit_cost,
      CASE WHEN p_unit_cost IS NULL THEN NULL ELSE p_unit_cost * ABS(v_qty) END,
      p_supplier, p_notes, p_staff_id, COALESCE(p_movement_at, NOW()));
  END IF;

  RETURN jsonb_build_object(
    'applied', v_qty, 'requested', COALESCE(p_qty, 0),
    'physical', r.quantity_physical, 'available', r.quantity_available);
END;
$$;

-- ---------------------------------------------------
-- One-time conversion of existing open orders (runs once)
-- ---------------------------------------------------
--  * Orders already waybilled / at a park: their reserved goods have
--    physically left the warehouse → deducted and listed in Goods in Transit
--  * Partially paid orders: goods are with the customer → sold now
--  * Delivered (unpaid) orders: deducted on payment from the warehouse
--    that held the reservation
--  * Everything else: reservation simply released back to available
CREATE TABLE IF NOT EXISTS app_migrations (
  key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
DECLARE rec RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM app_migrations WHERE key = 'inventory_v2_no_reservations') THEN
    RETURN;
  END IF;

  FOR rec IN
    WITH net AS (
      SELECT m.reference_id AS order_id, m.product_id, m.warehouse_id,
             SUM(CASE
                   WHEN m.movement_type = 'reserve' THEN ABS(m.quantity)
                   WHEN m.movement_type IN ('sale','release','return','damage','missing','return_inspection','reserve_out')
                     THEN -ABS(m.quantity)
                   ELSE 0 END) AS qty
        FROM inventory_movements m
       WHERE m.reference_type = 'order'
         AND m.product_id IS NOT NULL AND m.warehouse_id IS NOT NULL
       GROUP BY 1, 2, 3
    )
    SELECT n.order_id, n.product_id, n.warehouse_id, n.qty::INT AS qty,
           o.status, o.order_number, o.state, o.business_id,
           COALESCE(p.name, o.product_name, 'Unknown') AS product_name,
           w.state AS wh_state
      FROM net n
      JOIN orders o ON o.id = n.order_id
      LEFT JOIN products p ON p.id = n.product_id
      LEFT JOIN warehouses w ON w.id = n.warehouse_id
     WHERE n.qty > 0
  LOOP
    IF rec.status IN ('waybilled', 'arrived_at_park', 'picked_up_from_park', 'sent_to_park') THEN
      UPDATE inventory SET
        quantity_physical = GREATEST(0, COALESCE(quantity_physical, 0) - rec.qty),
        quantity_reserved = GREATEST(0, COALESCE(quantity_reserved, 0) - rec.qty)
       WHERE product_id = rec.product_id AND warehouse_id = rec.warehouse_id;
      INSERT INTO inventory_movements (product_id, warehouse_id, business_id, movement_type, quantity,
                                       reference_id, reference_type, notes)
        VALUES (rec.product_id, rec.warehouse_id, rec.business_id, 'waybill_out', -rec.qty,
                rec.order_id, 'order', 'Converted to Goods in Transit — ' || rec.order_number);
      INSERT INTO stock_in_transit (product_id, product_name, quantity, deducted_qty, order_id, order_number,
                                    business_id, from_warehouse_id, destination_state, destination_type, created_by_name)
        VALUES (rec.product_id, rec.product_name, rec.qty, rec.qty, rec.order_id, rec.order_number,
                rec.business_id, rec.warehouse_id, rec.state, 'customer', 'System (inventory v2 conversion)');

    ELSIF rec.status = 'partially_paid' THEN
      UPDATE inventory SET
        quantity_physical = GREATEST(0, COALESCE(quantity_physical, 0) - rec.qty),
        quantity_reserved = GREATEST(0, COALESCE(quantity_reserved, 0) - rec.qty),
        quantity_sold     = COALESCE(quantity_sold, 0) + rec.qty
       WHERE product_id = rec.product_id AND warehouse_id = rec.warehouse_id;
      INSERT INTO inventory_movements (product_id, warehouse_id, business_id, movement_type, quantity,
                                       reference_id, reference_type, notes)
        VALUES (rec.product_id, rec.warehouse_id, rec.business_id, 'sale', -rec.qty,
                rec.order_id, 'order', 'Sold (part-paid, inventory v2 conversion) — ' || rec.order_number);
      UPDATE orders SET stock_source = 'warehouse', stock_warehouse_id = rec.warehouse_id,
                        stock_deducted_at = NOW()
       WHERE id = rec.order_id;

    ELSIF rec.status = 'delivered'
       OR (rec.status IN ('received_at_warehouse', 'processing', 'customer_rescheduled') AND rec.wh_state = rec.state) THEN
      UPDATE orders SET stock_source = 'warehouse', stock_warehouse_id = rec.warehouse_id
       WHERE id = rec.order_id AND stock_source IS NULL;
    END IF;
  END LOOP;

  -- Release every remaining reservation: sellable = on the shelf,
  -- minus anything waiting for inspection or repair
  UPDATE inventory SET
    quantity_reserved  = 0,
    quantity_available = GREATEST(0, COALESCE(quantity_physical, 0)
                                     - COALESCE(quantity_inspection, 0)
                                     - COALESCE(quantity_repair, 0));

  INSERT INTO app_migrations (key) VALUES ('inventory_v2_no_reservations');
END;
$$;
