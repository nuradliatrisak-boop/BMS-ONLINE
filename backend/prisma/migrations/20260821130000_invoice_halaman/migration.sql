-- Tambah kolom "halaman" (nomor halaman cetak invoice, default 1)
ALTER TABLE "Invoice" ADD COLUMN "halaman" INTEGER NOT NULL DEFAULT 1;
