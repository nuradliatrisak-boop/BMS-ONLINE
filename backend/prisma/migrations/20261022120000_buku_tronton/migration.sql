-- Menu Buku Tronton: catatan uang jalan / material / tujuan per trip sopir tronton.
-- Hanya MENAMBAH tabel baru; tabel lain tidak diubah.
CREATE TABLE "TrontonTrip" (
    "id" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "sopirId" TEXT,
    "sopirNama" TEXT NOT NULL,
    "noPolisi" TEXT,
    "uangJalan" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material" TEXT,
    "uangBeliMaterial" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tujuan" TEXT,
    "catatan" TEXT,
    "masukLaporan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrontonTrip_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrontonTrip_tanggal_idx" ON "TrontonTrip"("tanggal");
CREATE INDEX "TrontonTrip_sopirId_idx" ON "TrontonTrip"("sopirId");

ALTER TABLE "TrontonTrip" ADD CONSTRAINT "TrontonTrip_sopirId_fkey" FOREIGN KEY ("sopirId") REFERENCES "Sopir"("id") ON DELETE SET NULL ON UPDATE CASCADE;
