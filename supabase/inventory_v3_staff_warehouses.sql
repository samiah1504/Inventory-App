-- Inventory access: which warehouses a staff member sees.
-- Empty = every warehouse. The CEO switches warehouses on/off per
-- Inventory officer / Operations Manager in Staff Management.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS assigned_warehouse_ids UUID[] DEFAULT '{}';
