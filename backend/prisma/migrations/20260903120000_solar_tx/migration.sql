-- Tabel baru untuk catatan Stok Solar (BBM) Masuk/Keluar Alat Berat.
CREATE TYPE "TipeSolar" AS ENUM ('MASUK', 'KELUAR');

CREATE TABLE "SolarTx" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "tipe" "TipeSolar" NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "nama" TEXT NOT NULL,
    "liter" DOUBLE PRECISION NOT NULL,
    "lokasi" TEXT,
    "keterangan" TEXT,
    "buktiFile" TEXT,
    "buktiNama" TEXT,
    "divisi" TEXT NOT NULL DEFAULT 'Alat Berat',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarTx_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolarTx_no_key" ON "SolarTx"("no");

CREATE INDEX "SolarTx_tipe_tanggal_idx" ON "SolarTx"("tipe", "tanggal");
