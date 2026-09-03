-- Tambah kolom "kode" ke Material supaya tiap material bisa punya kode
-- (mis. dipilih dari dropdown saat catat data, sama seperti kode di StockMaster
-- yang dipakai di Surat Jalan). Nullable + unik supaya data lama yang belum
-- punya kode tetap aman, dan tidak ada duplikat kode ke depannya.
ALTER TABLE "Material" ADD COLUMN "kode" TEXT;

CREATE UNIQUE INDEX "Material_kode_key" ON "Material"("kode");
