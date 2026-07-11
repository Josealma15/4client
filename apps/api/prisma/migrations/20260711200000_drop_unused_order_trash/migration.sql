-- Drop unused order_trash table (never written to by any route; soft-delete is handled via order.status = 'papelera')
DROP TABLE IF EXISTS "order_trash";
