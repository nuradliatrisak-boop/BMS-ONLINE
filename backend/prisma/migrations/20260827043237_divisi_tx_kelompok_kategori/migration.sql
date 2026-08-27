-- Tambah kolom untuk mendukung Laporan Divisi bergaya Excel (dikelompokkan
-- per section "kelompok" dan baris "kategori" di dalamnya).
ALTER TABLE "DivisiTx" ADD COLUMN "kelompok" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DivisiTx" ADD COLUMN "kategori" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DivisiTx" ADD COLUMN "subKategori" TEXT;
ALTER TABLE "DivisiTx" ADD COLUMN "qty" DOUBLE PRECISION;
ALTER TABLE "DivisiTx" ADD COLUMN "hargaSatuan" DOUBLE PRECISION;

-- "keterangan" sekarang jadi catatan opsional (bukan lagi label utama baris)
ALTER TABLE "DivisiTx" ALTER COLUMN "keterangan" DROP NOT NULL;

-- Backfill data lama: pakai isi "keterangan" sebagai "kategori" awal supaya
-- transaksi yang sudah ada tidak hilang dari laporan setelah migrasi ini.
UPDATE "DivisiTx"
SET "kategori" = "keterangan",
    "kelompok" = CASE WHEN "tipe" = 'PENJUALAN' THEN 'penjualan' ELSE 'lainnya' END
WHERE "kategori" = '';

CREATE INDEX "DivisiTx_divisi_kelompok_kategori_idx" ON "DivisiTx"("divisi", "kelompok", "kategori");
