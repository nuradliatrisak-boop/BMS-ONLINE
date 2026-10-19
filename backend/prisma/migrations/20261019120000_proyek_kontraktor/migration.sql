-- Proyek Kontraktor: rekap tagihan, pengeluaran (HPP), diskon & margin per proyek.
CREATE TABLE "ProyekKontraktor" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "divisi" TEXT NOT NULL DEFAULT 'Kontraktor',
    "customerId" TEXT,
    "namaCustomer" TEXT,
    "lokasi" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProyekKontraktor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProyekBiaya" (
    "id" TEXT NOT NULL,
    "proyekId" TEXT NOT NULL,
    "jenis" TEXT NOT NULL DEFAULT 'HPP',
    "tanggal" TIMESTAMP(3) NOT NULL,
    "uraian" TEXT NOT NULL,
    "qty" DOUBLE PRECISION,
    "satuan" TEXT,
    "hargaSatuan" DOUBLE PRECISION,
    "nominal" DOUBLE PRECISION NOT NULL,
    "catatan" TEXT,
    "urut" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProyekBiaya_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice" ADD COLUMN "proyekId" TEXT;

CREATE INDEX "ProyekKontraktor_customerId_idx" ON "ProyekKontraktor"("customerId");
CREATE INDEX "ProyekKontraktor_divisi_idx" ON "ProyekKontraktor"("divisi");
CREATE INDEX "ProyekBiaya_proyekId_idx" ON "ProyekBiaya"("proyekId");

ALTER TABLE "ProyekKontraktor" ADD CONSTRAINT "ProyekKontraktor_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProyekBiaya" ADD CONSTRAINT "ProyekBiaya_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "ProyekKontraktor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "ProyekKontraktor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
