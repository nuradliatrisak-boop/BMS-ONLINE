-- Upah kuli per pengiriman PO + nomor rekapan invoice per customer.
ALTER TABLE "PoPengiriman" ADD COLUMN "upahKuli" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "noRekap" TEXT;
CREATE INDEX "Invoice_noRekap_idx" ON "Invoice"("noRekap");
