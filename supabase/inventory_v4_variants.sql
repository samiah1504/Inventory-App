-- ===================================================
-- Inventory v4 — stock by variation (colour / size)
-- ===================================================
-- Each product's stock in a warehouse can be split into variations
-- (colour + size). The variation counts plus "no colour/size recorded"
-- always add up to the warehouse's good stock:
--
--   quantity_available = SUM(inventory_variants.quantity) + unassigned
--
-- Existing stock starts as unassigned and can be split later.
-- inventory_apply() now takes a colour/size: a sale of "Black / L"
-- deducts that variation (then unassigned stock if the variation is
-- short), all in the same locked transaction as before.

CREATE OR REPLACE FUNCTION inventory_variant_key(p_color TEXT, p_size TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_color, '')), '\s+', ' ', 'g'))
      || '|' ||
         lower(regexp_replace(trim(coalesce(p_size, '')), '\s+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS inventory_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  business_id UUID REFERENCES businesses(id),
  variant_key TEXT NOT NULL,
  color TEXT,
  size TEXT,
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, warehouse_id, variant_key)
);
CREATE INDEX IF NOT EXISTS idx_inv_variants_product ON inventory_variants(product_id);

-- Variation on the records that move stock around
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS color TEXT, ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS color TEXT, ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE returns             ADD COLUMN IF NOT EXISTS color TEXT, ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE damaged_goods       ADD COLUMN IF NOT EXISTS color TEXT, ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE stock_count_lines   ADD COLUMN IF NOT EXISTS color TEXT, ADD COLUMN IF NOT EXISTS size TEXT;

-- Replace the stock function (new colour/size parameters). The old
-- signature is dropped first so the app never sees two versions.
DROP FUNCTION IF EXISTS inventory_apply(UUID, UUID, UUID, INT, INT, INT, INT, INT, TEXT, INT, UUID, TEXT, TEXT, UUID, NUMERIC, TEXT, TIMESTAMPTZ, BOOLEAN);

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
  p_clamp BOOLEAN DEFAULT false,
  p_color TEXT DEFAULT NULL,
  p_size TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  r inventory%ROWTYPE;
  v_qty INT := COALESCE(p_qty, 0);
  v_insp INT := COALESCE(p_inspection, 0);
  v_color TEXT := NULLIF(trim(coalesce(p_color, '')), '');
  v_size TEXT := NULLIF(trim(coalesce(p_size, '')), '');
  v_key TEXT := NULL;
  v_label TEXT := NULL;
  v_var_qty INT := 0;
  v_assigned INT := 0;
  v_unassigned INT := 0;
  v_delta INT;
  v_cap INT;
  v_from_var INT := 0;
  v_from_un INT := 0;
  v_name TEXT;
  v_wh TEXT;
BEGIN
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'A product and a warehouse are needed for a stock change';
  END IF;
  IF v_color IS NOT NULL OR v_size IS NOT NULL THEN
    v_key := inventory_variant_key(v_color, v_size);
    v_label := concat_ws(' / ', v_color, v_size);
  END IF;

  SELECT * INTO r FROM inventory
   WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF v_qty - v_insp < 0 OR v_insp <> 0 THEN
      IF p_clamp THEN
        RETURN jsonb_build_object('applied', 0, 'requested', v_qty, 'physical', 0, 'available', 0,
                                  'variant', v_label, 'from_variant', 0, 'from_unassigned', 0);
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

  -- The inventory row lock above serialises every variant change for
  -- this product + warehouse (all of them go through this function)
  SELECT COALESCE(SUM(quantity), 0) INTO v_assigned FROM inventory_variants
   WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  v_unassigned := GREATEST(COALESCE(r.quantity_available, 0) - v_assigned, 0);
  IF v_key IS NOT NULL THEN
    SELECT quantity INTO v_var_qty FROM inventory_variants
     WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND variant_key = v_key;
    v_var_qty := COALESCE(v_var_qty, 0);
  END IF;

  -- Change to sellable stock. Never below zero: the named variation,
  -- then stock with no colour/size recorded, must cover what leaves.
  v_delta := v_qty - v_insp;
  IF v_delta < 0 THEN
    v_cap := LEAST(v_unassigned + v_var_qty, GREATEST(COALESCE(r.quantity_available, 0), 0));
    IF -v_delta > v_cap THEN
      IF p_clamp AND v_insp = 0 THEN
        v_qty := -v_cap;
        v_delta := v_qty;
      ELSE
        SELECT name INTO v_name FROM products WHERE id = p_product_id;
        SELECT name INTO v_wh FROM warehouses WHERE id = p_warehouse_id;
        IF v_key IS NULL AND v_assigned > 0 THEN
          RAISE EXCEPTION 'Only % of % in % has no colour/size recorded — choose the colour/size',
            v_cap, COALESCE(v_name, 'this product'), COALESCE(v_wh, 'this warehouse');
        END IF;
        RAISE EXCEPTION 'Not enough stock: only % of % available in %',
          v_cap,
          COALESCE(v_name, 'this product') || CASE WHEN v_label IS NOT NULL THEN ' (' || v_label || ')' ELSE '' END,
          COALESCE(v_wh, 'this warehouse');
      END IF;
    END IF;
    v_from_var := LEAST(v_var_qty, -v_delta);
    v_from_un := -v_delta - v_from_var;
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

  IF v_key IS NOT NULL THEN
    IF v_delta > 0 THEN
      INSERT INTO inventory_variants (product_id, warehouse_id, business_id, variant_key, color, size, quantity)
        VALUES (p_product_id, p_warehouse_id, r.business_id, v_key, v_color, v_size, v_delta)
      ON CONFLICT (product_id, warehouse_id, variant_key)
        DO UPDATE SET quantity = inventory_variants.quantity + EXCLUDED.quantity, updated_at = NOW();
    ELSIF v_from_var > 0 THEN
      UPDATE inventory_variants SET quantity = quantity - v_from_var, updated_at = NOW()
       WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND variant_key = v_key;
    END IF;
  END IF;

  IF p_movement_type IS NOT NULL THEN
    INSERT INTO inventory_movements (
      product_id, warehouse_id, business_id, movement_type, quantity,
      reference_id, reference_type, unit_cost, total_cost, supplier, notes,
      staff_id, created_at, color, size)
    VALUES (
      p_product_id, p_warehouse_id, COALESCE(r.business_id, p_business_id), p_movement_type,
      COALESCE(p_movement_qty, v_qty),
      p_reference_id, p_reference_type, p_unit_cost,
      CASE WHEN p_unit_cost IS NULL THEN NULL ELSE p_unit_cost * ABS(v_qty) END,
      p_supplier, p_notes, p_staff_id, COALESCE(p_movement_at, NOW()), v_color, v_size);
  END IF;

  RETURN jsonb_build_object(
    'applied', v_qty, 'requested', COALESCE(p_qty, 0),
    'physical', r.quantity_physical, 'available', r.quantity_available,
    'variant', v_label, 'from_variant', v_from_var, 'from_unassigned', v_from_un);
END;
$$;

-- Move units between variations without changing the total — used to
-- split "no colour/size recorded" stock, or to correct a colour.
-- A NULL colour+size on either side means "no colour/size recorded".
CREATE OR REPLACE FUNCTION inventory_move_variant(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_qty INT,
  p_from_color TEXT DEFAULT NULL,
  p_from_size TEXT DEFAULT NULL,
  p_to_color TEXT DEFAULT NULL,
  p_to_size TEXT DEFAULT NULL,
  p_staff_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  r inventory%ROWTYPE;
  v_from_c TEXT := NULLIF(trim(coalesce(p_from_color, '')), '');
  v_from_s TEXT := NULLIF(trim(coalesce(p_from_size, '')), '');
  v_to_c TEXT := NULLIF(trim(coalesce(p_to_color, '')), '');
  v_to_s TEXT := NULLIF(trim(coalesce(p_to_size, '')), '');
  v_from_key TEXT;
  v_to_key TEXT;
  v_have INT;
  v_assigned INT;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN RAISE EXCEPTION 'Enter a quantity greater than zero'; END IF;
  IF v_from_c IS NOT NULL OR v_from_s IS NOT NULL THEN v_from_key := inventory_variant_key(v_from_c, v_from_s); END IF;
  IF v_to_c IS NOT NULL OR v_to_s IS NOT NULL THEN v_to_key := inventory_variant_key(v_to_c, v_to_s); END IF;
  IF v_from_key IS NOT DISTINCT FROM v_to_key THEN RAISE EXCEPTION 'Choose a different variation to move to'; END IF;

  SELECT * INTO r FROM inventory WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No stock of this product in this warehouse'; END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO v_assigned FROM inventory_variants
   WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;

  IF v_from_key IS NULL THEN
    v_have := GREATEST(COALESCE(r.quantity_available, 0) - v_assigned, 0);
  ELSE
    SELECT quantity INTO v_have FROM inventory_variants
     WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND variant_key = v_from_key;
    v_have := COALESCE(v_have, 0);
  END IF;
  IF v_have < p_qty THEN
    RAISE EXCEPTION 'Only % unit(s) in that variation to move', v_have;
  END IF;

  IF v_from_key IS NOT NULL THEN
    UPDATE inventory_variants SET quantity = quantity - p_qty, updated_at = NOW()
     WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND variant_key = v_from_key;
  END IF;
  IF v_to_key IS NOT NULL THEN
    INSERT INTO inventory_variants (product_id, warehouse_id, business_id, variant_key, color, size, quantity)
      VALUES (p_product_id, p_warehouse_id, r.business_id, v_to_key, v_to_c, v_to_s, p_qty)
    ON CONFLICT (product_id, warehouse_id, variant_key)
      DO UPDATE SET quantity = inventory_variants.quantity + EXCLUDED.quantity, updated_at = NOW();
  END IF;

  INSERT INTO inventory_movements (product_id, warehouse_id, business_id, movement_type, quantity, notes, staff_id, color, size)
    VALUES (p_product_id, p_warehouse_id, r.business_id, 'variant_reassign', 0,
            p_qty || ' moved from ' || COALESCE(NULLIF(concat_ws(' / ', v_from_c, v_from_s), ''), 'no colour/size')
              || ' to ' || COALESCE(NULLIF(concat_ws(' / ', v_to_c, v_to_s), ''), 'no colour/size')
              || COALESCE(' — ' || p_notes, ''),
            p_staff_id, v_to_c, v_to_s);

  RETURN jsonb_build_object('moved', p_qty);
END;
$$;
