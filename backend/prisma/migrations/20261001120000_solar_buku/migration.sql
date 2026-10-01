-- Buku catatan solar (isi buku tulis) untuk dicocokkan dengan setoran real.
CREATE TABLE "SolarBuku" (
    "id" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "nama" TEXT NOT NULL,
    "liter" DOUBLE PRECISION NOT NULL,
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolarBuku_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SolarBuku_tanggal_idx" ON "SolarBuku"("tanggal");
