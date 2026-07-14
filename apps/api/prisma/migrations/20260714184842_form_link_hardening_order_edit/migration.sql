-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "added_by_client" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "client_modified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "form_link_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "device_token" VARCHAR(100) NOT NULL,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_link_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_link_sessions_ticket_id_key" ON "form_link_sessions"("ticket_id");

-- AddForeignKey
ALTER TABLE "form_link_sessions" ADD CONSTRAINT "form_link_sessions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
