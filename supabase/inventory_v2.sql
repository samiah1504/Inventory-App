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
