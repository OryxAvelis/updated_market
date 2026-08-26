-- Keep administrator order changes distinguishable from customer, system,
-- and fulfillment events in the immutable customer tracking timeline.
ALTER TABLE order_tracking_events
  DROP CHECK chk_order_tracking_events_source,
  ADD CONSTRAINT chk_order_tracking_events_source
    CHECK (source IN ('system', 'customer', 'fulfillment', 'admin'));
