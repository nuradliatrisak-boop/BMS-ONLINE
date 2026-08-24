-- Tambah master "Penerima" per Customer (nama + alamat tujuan masing-masing)
-- supaya customer distributor (kirim ke banyak PT/CV) tidak lagi digabung
-- jadi satu alamat yang sangat panjang. Juga tambah kolom "penerima" di
-- SuratJalan supaya nama penerima ikut tersimpan terpisah dari nama
-- customer (A/P Dari), sesuai format kertas fisik.

CREATE TABLE "CustomerRecipient" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT NOT NULL,
    "telepon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerRecipient_customerId_idx" ON "CustomerRecipient"("customerId");

ALTER TABLE "CustomerRecipient" ADD CONSTRAINT "CustomerRecipient_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SuratJalan" ADD COLUMN "penerima" TEXT;
