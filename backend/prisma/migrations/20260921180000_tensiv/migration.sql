-- Rekaman "Daftar Kerja Harian" alat berat (disebut "Tensiv" di lapangan) --
-- sumber jam kerja per hari per unit alat, ditarik jadi baris InvoiceItem
-- lewat kolom InvoiceItem.tensivId (sama pola dengan suratJalanId).

CREATE TABLE "Tensiv" (
    "id" TEXT NOT NULL,
    "no" TEXT,
    "divisi" TEXT NOT NULL DEFAULT 'Alat Berat',
    "customerId" TEXT,
    "unitAlatId" TEXT,
    "unitAlat" TEXT,
    "typeAlat" TEXT,
    "kategoriAlat" TEXT,
    "pengawas" TEXT,
    "lokasi" TEXT,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "waktuKerja" JSONB,
    "waktuTidakKerja" JSONB,
    "totalJamKerja" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalJamTidakKerja" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keteranganLokasi" TEXT,
    "namaPengawasTTD" TEXT,
    "namaOperatorTTD" TEXT,
    "statusTTD" "StatusTTD" NOT NULL DEFAULT 'BELUM_TTD',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tensiv_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tensiv_no_key" ON "Tensiv"("no");
CREATE INDEX "Tensiv_customerId_idx" ON "Tensiv"("customerId");
CREATE INDEX "Tensiv_unitAlatId_idx" ON "Tensiv"("unitAlatId");
CREATE INDEX "Tensiv_tanggal_idx" ON "Tensiv"("tanggal");

ALTER TABLE "Tensiv" ADD CONSTRAINT "Tensiv_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem" ADD COLUMN "tensivId" TEXT;
CREATE UNIQUE INDEX "InvoiceItem_tensivId_key" ON "InvoiceItem"("tensivId");
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_tensivId_fkey" FOREIGN KEY ("tensivId") REFERENCES "Tensiv"("id") ON DELETE SET NULL ON UPDATE CASCADE;
