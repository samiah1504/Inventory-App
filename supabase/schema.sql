-- ===================================================
-- KANZIY OPERATIONS - SUPABASE DATABASE SCHEMA
-- ===================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================================================
-- BUSINESSES
-- ===================================================
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,  -- e.g. KZY, TOY
  invoice_prefix TEXT NOT NULL,
  logo_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  currency TEXT DEFAULT 'NGN',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- ROLES
-- ===================================================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,  -- ceo, operations_manager, customer_support, fulfillment, waybill, inventory
  display_name TEXT NOT NULL,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- STAFF USERS
-- ===================================================
CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,  -- store hashed in production (e.g. bcrypt)
  phone TEXT,
  staff_code TEXT NOT NULL UNIQUE,  -- e.g. STF001
  role TEXT NOT NULL DEFAULT 'customer_support',
  extra_permissions JSONB DEFAULT '[]',
  business_ids UUID[] DEFAULT '{}',  -- businesses this staff can access
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- WAREHOUSES
-- ===================================================
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  city TEXT,
  address TEXT,
  contact_person TEXT,
  contact_phone TEXT,
  whatsapp_group TEXT,
  business_id UUID REFERENCES businesses(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- PRODUCT CATEGORIES
-- ===================================================
CREATE TABLE product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_id UUID REFERENCES businesses(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- PRODUCTS
-- ===================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_id UUID REFERENCES businesses(id),
  category_id UUID REFERENCES product_categories(id),
  selling_price DECIMAL(15,2),
  cost_price DECIMAL(15,2),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,  -- Admin approves new products
  created_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- CUSTOMERS
-- ===================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  alternate_phone TEXT,
  email TEXT,
  notes TEXT,
  total_orders INT DEFAULT 0,
  total_spent DECIMAL(15,2) DEFAULT 0,
  successful_orders INT DEFAULT 0,
  failed_orders INT DEFAULT 0,
  last_order_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  address TEXT,
  city TEXT,
  state TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- ORDERS
-- ===================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT NOT NULL UNIQUE,
  invoice_number TEXT UNIQUE,
  receipt_number TEXT UNIQUE,

  -- Business & Customer
  business_id UUID REFERENCES businesses(id),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT NOT NULL,

  -- Product
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  color TEXT,
  size TEXT,

  -- Order details
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT,  -- whatsapp, instagram, phone_call, etc.
  delivery_note TEXT,
  customer_requested_delivery_date DATE,
  preferred_delivery_time TEXT,
  planned_delivery_date DATE,

  -- Payment
  amount_paid DECIMAL(15,2) DEFAULT 0,
  balance_amount DECIMAL(15,2),
  balance_due_date DATE,
  balance_notes TEXT,
  paid_at TIMESTAMPTZ,

  -- Staff
  created_by UUID REFERENCES staff_users(id),
  staff_code TEXT,

  -- Fulfillment
  fulfillment_officer_id UUID REFERENCES staff_users(id),
  cancellation_reason TEXT,
  failed_reason TEXT,
  reschedule_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,

  -- Flags
  is_copied_for_whatsapp BOOLEAN DEFAULT false,
  has_waybill BOOLEAN DEFAULT false
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_state ON orders(state);
CREATE INDEX idx_orders_business ON orders(business_id);
CREATE INDEX idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_planned_delivery ON orders(planned_delivery_date);

-- ===================================================
-- ORDER TIMELINE
-- ===================================================
CREATE TABLE order_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT,
  staff_id UUID REFERENCES staff_users(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- ORDER NOTES
-- ===================================================
CREATE TABLE order_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT true,
  staff_id UUID REFERENCES staff_users(id),
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- WAYBILL BATCHES
-- ===================================================
CREATE TABLE waybill_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_number TEXT NOT NULL UNIQUE,  -- WB-YYYY-00001
  courier_company TEXT,
  waybill_type TEXT NOT NULL DEFAULT 'external',  -- internal / external
  tracking_number TEXT,
  date_shipped DATE,
  destination_state TEXT,
  destination_warehouse_id UUID REFERENCES warehouses(id),
  total_cost DECIMAL(15,2) DEFAULT 0,
  cost_allocation TEXT DEFAULT 'equal',  -- equal / manual
  notes TEXT,
  receipt_url TEXT,
  status TEXT DEFAULT 'in_transit',  -- in_transit / received
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES staff_users(id),
  created_by UUID REFERENCES staff_users(id),
  business_id UUID REFERENCES businesses(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE waybill_batch_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID REFERENCES waybill_batches(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id),
  allocated_cost DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- WAREHOUSE TRANSFERS (stock movements, not customer orders)
-- ===================================================
CREATE TABLE warehouse_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transfer_number TEXT NOT NULL UNIQUE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INT NOT NULL,
  from_warehouse_id UUID REFERENCES warehouses(id),
  to_warehouse_id UUID REFERENCES warehouses(id),
  courier_company TEXT,
  waybill_number TEXT,
  waybill_cost DECIMAL(15,2) DEFAULT 0,
  date_transferred DATE,
  status TEXT DEFAULT 'in_transit',  -- in_transit / received
  notes TEXT,
  created_by UUID REFERENCES staff_users(id),
  received_by UUID REFERENCES staff_users(id),
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- INVENTORY
-- ===================================================
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  business_id UUID REFERENCES businesses(id),

  quantity_physical INT DEFAULT 0,
  quantity_reserved INT DEFAULT 0,   -- orders created but not paid
  quantity_available INT DEFAULT 0,  -- physical - reserved
  quantity_sold INT DEFAULT 0,
  quantity_returned INT DEFAULT 0,
  quantity_damaged INT DEFAULT 0,

  last_stock_count_at TIMESTAMPTZ,
  low_stock_threshold INT DEFAULT 5,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(product_id, warehouse_id)
);

CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  business_id UUID REFERENCES businesses(id),

  movement_type TEXT NOT NULL,  -- purchase, sale, return, damage, transfer_in, transfer_out, adjustment
  quantity INT NOT NULL,  -- positive = in, negative = out
  reference_id UUID,  -- order_id, transfer_id, etc.
  reference_type TEXT,  -- order, transfer, purchase, adjustment

  unit_cost DECIMAL(15,2),
  total_cost DECIMAL(15,2),
  supplier TEXT,
  notes TEXT,

  staff_id UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- EXPENSES
-- ===================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id),
  expense_type TEXT NOT NULL,  -- delivery, installation, offloading, waybill, supplier_payment, rent, salary, ads, electricity, fuel, office, marketing, misc
  category TEXT NOT NULL DEFAULT 'operational',  -- operational / admin (admin = CEO only)
  description TEXT,
  amount DECIMAL(15,2) NOT NULL,

  order_id UUID REFERENCES orders(id),

  is_admin_only BOOLEAN DEFAULT false,

  staff_id UUID REFERENCES staff_users(id),
  date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  receipt_url TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- RETURNS
-- ===================================================
CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id),
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT DEFAULT 'requested',  -- requested, returned_to_warehouse, inspection_pending, returned_to_stock, damaged, sent_for_repair, replaced, written_off
  outcome TEXT,
  warehouse_id UUID REFERENCES warehouses(id),
  notes TEXT,
  created_by UUID REFERENCES staff_users(id),
  resolved_by UUID REFERENCES staff_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- ALERTS CONFIG
-- ===================================================
CREATE TABLE alert_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id),
  alert_type TEXT NOT NULL,
  threshold_hours INT,
  threshold_count INT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===================================================
-- COUNTERS (for sequential numbering)
-- ===================================================
CREATE TABLE counters (
  id TEXT PRIMARY KEY,  -- e.g. 'order', 'invoice', 'receipt', 'waybill', 'transfer'
  business_id UUID REFERENCES businesses(id),
  year INT NOT NULL,
  current_value INT DEFAULT 0,
  UNIQUE(id, business_id, year)
);

-- ===================================================
-- SEED DATA
-- ===================================================

-- Roles
INSERT INTO roles (name, display_name, permissions) VALUES
  ('ceo', 'CEO / Super Admin', '["*"]'),
  ('operations_manager', 'Operations Manager', '["orders.*","fulfillment.*","inventory.view","waybill.*","customers.*","documents.*","reports.operational"]'),
  ('customer_support', 'Customer Support', '["orders.create","orders.view_own","customers.view","customers.create"]'),
  ('fulfillment', 'Fulfillment Officer', '["orders.view","orders.update_status","orders.add_notes"]'),
  ('waybill', 'Waybill Officer', '["orders.view","waybill.*","inventory.transfers"]'),
  ('inventory', 'Inventory / Warehouse Staff', '["inventory.*","warehouses.view"]');

-- Default businesses
INSERT INTO businesses (name, short_code, invoice_prefix) VALUES
  ('Kanziy', 'KZY', 'KZY'),
  ('Toy Store', 'TOY', 'TOY');

-- Product categories
INSERT INTO product_categories (name) VALUES
  ('Chairs'), ('Tables'), ('Toys'), ('Bicycles'), ('Tricycles'), ('Other');

-- Default demo admin staff
INSERT INTO staff_users (name, username, password, staff_code, role) VALUES
  ('Admin User', 'admin', 'admin123', 'ADM001', 'ceo');

-- ===================================================
-- FUNCTIONS & TRIGGERS
-- ===================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER staff_users_updated_at BEFORE UPDATE ON staff_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
