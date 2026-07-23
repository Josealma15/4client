-- AlterTable
ALTER TABLE "invoice_links" ADD COLUMN     "failed_attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "link_blocked_until" TIMESTAMPTZ,
ADD COLUMN     "link_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "link_failed_total" INTEGER NOT NULL DEFAULT 0;
