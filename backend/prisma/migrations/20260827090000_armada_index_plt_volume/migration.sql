-- Tambah Index P-L-T (ukuran bak) & Volume (m3) ke master Armada, sesuai
-- sheet "INDEK MOBIL" di Excel. Semua nullable karena data lama belum
-- punya ukuran ini -- bisa dilengkapi belakangan lewat halaman Armada.
ALTER TABLE "Armada" ADD COLUMN "panjang" DOUBLE PRECISION;
ALTER TABLE "Armada" ADD COLUMN "lebar" DOUBLE PRECISION;
ALTER TABLE "Armada" ADD COLUMN "tinggi" DOUBLE PRECISION;
ALTER TABLE "Armada" ADD COLUMN "volume" DOUBLE PRECISION;
