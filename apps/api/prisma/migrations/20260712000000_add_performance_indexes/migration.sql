-- Performance indexes for hot query paths (tickets/messages/orders load, refresh-token lookup)

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

CREATE INDEX IF NOT EXISTS "tickets_org_id_fecha_idx" ON "tickets"("org_id", "fecha");
CREATE INDEX IF NOT EXISTS "tickets_org_id_deferred_to_idx" ON "tickets"("org_id", "deferred_to");
CREATE INDEX IF NOT EXISTS "tickets_org_id_last_message_at_idx" ON "tickets"("org_id", "last_message_at");

CREATE INDEX IF NOT EXISTS "ticket_messages_ticket_id_sent_at_idx" ON "ticket_messages"("ticket_id", "sent_at");

CREATE INDEX IF NOT EXISTS "orders_org_id_fecha_idx" ON "orders"("org_id", "fecha");
CREATE INDEX IF NOT EXISTS "orders_ticket_id_idx" ON "orders"("ticket_id");
CREATE INDEX IF NOT EXISTS "orders_org_id_status_idx" ON "orders"("org_id", "status");

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");

CREATE INDEX IF NOT EXISTS "order_history_order_id_idx" ON "order_history"("order_id");
CREATE INDEX IF NOT EXISTS "order_history_org_id_created_at_idx" ON "order_history"("org_id", "created_at");
