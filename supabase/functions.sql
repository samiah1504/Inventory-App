-- Counter function for sequential order/invoice/receipt/waybill numbering
CREATE OR REPLACE FUNCTION get_next_counter(
  counter_type TEXT,
  business_id_param UUID,
  year_param INT DEFAULT EXTRACT(YEAR FROM NOW())::INT
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  next_val INT;
BEGIN
  INSERT INTO counters (id, business_id, year, current_value)
  VALUES (counter_type, business_id_param, year_param, 1)
  ON CONFLICT (id, business_id, year) DO UPDATE
    SET current_value = counters.current_value + 1
  RETURNING current_value INTO next_val;
  RETURN next_val;
END;
$$;

-- Update customer stats after order changes
CREATE OR REPLACE FUNCTION update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_orders = (SELECT COUNT(*) FROM orders WHERE customer_id = NEW.customer_id),
      successful_orders = (SELECT COUNT(*) FROM orders WHERE customer_id = NEW.customer_id AND status IN ('paid', 'delivered', 'partially_paid')),
      failed_orders = (SELECT COUNT(*) FROM orders WHERE customer_id = NEW.customer_id AND status = 'failed_delivery'),
      total_spent = (SELECT COALESCE(SUM(amount_paid), 0) FROM orders WHERE customer_id = NEW.customer_id AND status IN ('paid', 'partially_paid')),
      last_order_at = (SELECT MAX(created_at) FROM orders WHERE customer_id = NEW.customer_id),
      updated_at = NOW()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_update_customer_stats
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_customer_stats();

-- Row Level Security (basic setup)
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- For simplicity in this MVP, allow authenticated reads for all staff
-- In production, add per-role policies
CREATE POLICY "Allow all authenticated" ON orders FOR ALL USING (true);
CREATE POLICY "Allow all authenticated" ON staff_users FOR ALL USING (true);
