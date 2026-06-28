-- Make order_history append-only at the database level.
-- These rules reject UPDATE and DELETE at the Postgres engine level,
-- so no application code (or future admin error) can alter audit records.

CREATE OR REPLACE RULE no_update_order_history AS
  ON UPDATE TO "order_history" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE no_delete_order_history AS
  ON DELETE TO "order_history" DO INSTEAD NOTHING;