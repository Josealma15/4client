-- CreateTable
CREATE TABLE "revoked_form_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "reason" VARCHAR(255),
    "revoked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID NOT NULL,

    CONSTRAINT "revoked_form_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revoked_form_tokens_ticket_id_key" ON "revoked_form_tokens"("ticket_id");

-- CreateIndex
CREATE INDEX "revoked_form_tokens_org_id_idx" ON "revoked_form_tokens"("org_id");

-- AddForeignKey
ALTER TABLE "revoked_form_tokens" ADD CONSTRAINT "revoked_form_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revoked_form_tokens" ADD CONSTRAINT "revoked_form_tokens_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revoked_form_tokens" ADD CONSTRAINT "revoked_form_tokens_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
