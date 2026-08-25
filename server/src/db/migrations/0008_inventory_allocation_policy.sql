-- Some upstream catalog products publish only an availability flag and no
-- finite quantity. Preserve an explicit audit trail without pretending those
-- allocations received the stronger finite-stock guarantee.

ALTER TABLE order_inventory_allocations
  ADD COLUMN inventory_policy VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'finite' AFTER quantity,
  ADD CONSTRAINT chk_order_inventory_allocations_policy CHECK (
    inventory_policy IN ('finite', 'availability_only')
  );
