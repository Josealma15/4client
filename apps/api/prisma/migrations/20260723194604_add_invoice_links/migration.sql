-- CreateTable
CREATE TABLE "invoice_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "filename" VARCHAR(300) NOT NULL,
    "phone_last4" VARCHAR(4) NOT NULL,
    "opened_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_links_filename_key" ON "invoice_links"("filename");

-- AddForeignKey
ALTER TABLE "invoice_links" ADD CONSTRAINT "invoice_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
