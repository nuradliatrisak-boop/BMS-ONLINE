-- Fitur baru: (1) Checklist "Jadwal Setor Solar" harian per sopir, dan
-- (2) Dokumen kelengkapan aset (Mobil/Kapal/Alat Berat) -- STNK, KIR,
-- Gross Akte, Sertifikat Keselamatan, Pas Besar, Buku Pulau, Invoice,
-- SIA, SIO, foto, dst, termasuk kolom opsional custom.

-- Enum baru
CREATE TYPE "StatusSetor" AS ENUM ('BELUM', 'SESUAI', 'SELISIH');
CREATE TYPE "AsetTipe" AS ENUM ('MOBIL', 'KAPAL', 'ALAT_BERAT');

-- Master data Kapal
CREATE TABLE "Kapal" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "noLambung" TEXT,
    "divisi" TEXT NOT NULL DEFAULT 'Kapal',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kapal_pkey" PRIMARY KEY ("id")
);

-- Master data unit Alat Berat / Excavator
CREATE TABLE "AlatBeratUnit" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jenis" TEXT,
    "divisi" TEXT NOT NULL DEFAULT 'Alat Berat',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlatBeratUnit_pkey" PRIMARY KEY ("id")
);

-- Dokumen kelengkapan aset (polimorfik lewat asetTipe+asetId, tanpa FK --
-- lihat catatan di schema.prisma)
CREATE TABLE "Dokumen" (
    "id" TEXT NOT NULL,
    "asetTipe" "AsetTipe" NOT NULL,
    "asetId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "file" TEXT,
    "fileNama" TEXT,
    "nilai" TEXT,
    "berlakuSampai" TIMESTAMP(3),
    "catatan" TEXT,
    "wajib" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dokumen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dokumen_asetTipe_asetId_idx" ON "Dokumen"("asetTipe", "asetId");

-- Checklist Jadwal Setor Solar
CREATE TABLE "SolarJadwalSetor" (
    "id" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "nama" TEXT NOT NULL,
    "literWajib" DOUBLE PRECISION NOT NULL,
    "noSuratJalan" TEXT,
    "status" "StatusSetor" NOT NULL DEFAULT 'BELUM',
    "literSetor" DOUBLE PRECISION,
    "terjadwal" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "solarTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarJadwalSetor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolarJadwalSetor_solarTxId_key" ON "SolarJadwalSetor"("solarTxId");
CREATE INDEX "SolarJadwalSetor_tanggal_nama_idx" ON "SolarJadwalSetor"("tanggal", "nama");

ALTER TABLE "SolarJadwalSetor" ADD CONSTRAINT "SolarJadwalSetor_solarTxId_fkey"
  FOREIGN KEY ("solarTxId") REFERENCES "SolarTx"("id") ON DELETE SET NULL ON UPDATE CASCADE;
