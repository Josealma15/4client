-- Merge historical duplicate tickets per (org_id, phone) into a single canonical
-- ticket before the new UNIQUE(org_id, phone) constraint is added below - otherwise
-- any phone with more than one ticket row (created back when a ticket was scoped
-- per-day) would make that ALTER TABLE fail.
DO $$
DECLARE
  grp RECORD;
  canonical_id UUID;
  merged_fecha DATE;
  merged_last_msg TIMESTAMPTZ;
  merged_unread INT;
BEGIN
  FOR grp IN
    SELECT org_id, phone
    FROM tickets
    GROUP BY org_id, phone
    HAVING count(*) > 1
  LOOP
    SELECT id INTO canonical_id
    FROM tickets
    WHERE org_id = grp.org_id AND phone = grp.phone
    ORDER BY created_at ASC
    LIMIT 1;

    -- Captured before the siblings are deleted below - this is the whole point of
    -- the merge: roll the canonical ticket forward to the most recent activity
    -- across every merged row, and sum unread counts, instead of leaving it stuck
    -- on whichever day it happened to be created.
    SELECT max(fecha), max(last_message_at), sum(unread_count)
    INTO merged_fecha, merged_last_msg, merged_unread
    FROM tickets
    WHERE org_id = grp.org_id AND phone = grp.phone;

    UPDATE ticket_messages
    SET ticket_id = canonical_id
    WHERE ticket_id IN (
      SELECT id FROM tickets WHERE org_id = grp.org_id AND phone = grp.phone AND id <> canonical_id
    );

    UPDATE orders
    SET ticket_id = canonical_id
    WHERE ticket_id IN (
      SELECT id FROM tickets WHERE org_id = grp.org_id AND phone = grp.phone AND id <> canonical_id
    );

    -- Siblings must be gone before the canonical row's own fecha changes - otherwise
    -- this could collide with the still-active OLD (org_id, phone, fecha) constraint
    -- if a sibling row already holds that exact date.
    DELETE FROM tickets
    WHERE org_id = grp.org_id AND phone = grp.phone AND id <> canonical_id;

    UPDATE tickets
    SET fecha = merged_fecha, last_message_at = merged_last_msg,
        unread_count = merged_unread, deferred_to = NULL
    WHERE id = canonical_id;
  END LOOP;
END $$;

-- Ticket identity is now per (org_id, phone), not per (org_id, phone, fecha) - a
-- customer writing again after any amount of time continues the same ticket instead
-- of forking a new row the rest of the app (orders, staff replies) can't find.
-- Prisma created the original as a plain unique index (not a named table constraint),
-- so it comes off the same way it went on.
DROP INDEX "tickets_org_id_phone_fecha_key";
CREATE UNIQUE INDEX "tickets_org_id_phone_key" ON "tickets"("org_id", "phone");
