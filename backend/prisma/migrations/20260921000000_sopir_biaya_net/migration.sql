-- Permintaan direktur: menu/tabel Sopir tersendiri dengan komisi, dan
-- invoice armada/alat berat bisa menampilkan nilai "Net" internal setelah
-- dipotong belanja pasir, uang mobil, uang jalan, uang komisi (armada) /
-- uang makan (alat berat). Lihat catatan di schema.prisma tiap model untuk
-- detail cara pakainya. Semua kolom baru NULLABLE / ada default, jadi data
-- lama tetap jalan tanpa perlu diisi ulang.

-- 1) Tipe sopir (Tronton = komisi flat, Cold Diesel = komisi manual)
CREATE TYPE "TipeSopir" AS ENUM ('TRONTON', 'COLD_DIESEL');

-- 2) Master Sopir
CREATE TABLE "Sopir" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "tipe" "TipeSopir" NOT NULL,
    "noHp" TEXT,
    "komisiDefault" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sopir_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sopir_tipe_idx" ON "Sopir"("tipe");

-- 3) Master rate "uang makan" alat berat (unit + kategori -> nominal)
CREATE TABLE "UangMakanAlat" (
    "id" TEXT NOT NULL,
    "unitAlat" TEXT NOT NULL,
    "kategoriAlat" TEXT NOT NULL,
    "nominal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UangMakanAlat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UangMakanAlat_unitAlat_kategoriAlat_key" ON "UangMakanAlat"("unitAlat", "kategoriAlat");

-- 4) Armada: kaitan opsional ke master Sopir
ALTER TABLE "Armada" ADD COLUMN "sopirId" TEXT;
CREATE INDEX "Armada_sopirId_idx" ON "Armada"("sopirId");
ALTER TABLE "Armada" ADD CONSTRAINT "Armada_sopirId_fkey" FOREIGN KEY ("sopirId") REFERENCES "Sopir"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) SuratJalan: kaitan ke Sopir + 4 kolom biaya per pengiriman
ALTER TABLE "SuratJalan" ADD COLUMN "sopirId" TEXT;
ALTER TABLE "SuratJalan" ADD COLUMN "belanjaPasir" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "uangMobil" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "uangJalan" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "uangKomisi" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD CONSTRAINT "SuratJalan_sopirId_fkey" FOREIGN KEY ("sopirId") REFERENCES "Sopir"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) InvoiceItem: kolom biaya opsional buat hitung Net internal (tidak
-- pernah tampil di invoice cetak/export ke customer -- cuma dipakai di
-- halaman edit invoice internal aplikasi)
ALTER TABLE "InvoiceItem" ADD COLUMN "belanjaPasir" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "uangMobil" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "uangJalan" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "uangKomisi" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "uangMakan" DOUBLE PRECISION;
