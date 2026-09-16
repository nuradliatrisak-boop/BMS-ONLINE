-- Tambahan kolom pada baris Invoice (InvoiceItem) khusus untuk penagihan
-- SEWA ALAT BERAT, supaya total tagihan bisa dipecah per KATEGORI ALAT
-- (Bucket / Breker / Mobilisasi) dan per UNIT ALAT (PC 200, SK-100, dst)
-- tanpa harus menebak-nebak dari teks keterangan.
--   kategoriAlat : Bucket / Breker / Mobilisasi / dll  -> dipakai statistik Dashboard & Rekap Alat
--   unitAlat     : nama unit/alat beratnya (PC 200, SANY PC-075, Longarm, ...)
--   tglPakai     : tanggal pemakaian alat pada baris itu (beda dari tanggal invoice)
-- Ketiganya OPSIONAL: invoice material/armada yang lama tetap jalan tanpa diisi.
ALTER TABLE "InvoiceItem" ADD COLUMN "kategoriAlat" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "unitAlat" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "tglPakai" TIMESTAMP(3);

CREATE INDEX "InvoiceItem_kategoriAlat_idx" ON "InvoiceItem"("kategoriAlat");
CREATE INDEX "InvoiceItem_unitAlat_idx" ON "InvoiceItem"("unitAlat");
