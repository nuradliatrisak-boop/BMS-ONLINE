-- Lengkapi SuratJalan dengan field fisik (No Polisi, Sopir, Jenis Barang,
-- ukuran bak P/L/T, M3, jam) dan hubungkan ke Customer supaya "Tujuan"
-- bisa diambil dari master Customer (bukan diketik manual lagi).
ALTER TABLE "SuratJalan" ADD COLUMN "customerId" TEXT;
ALTER TABLE "SuratJalan" ADD COLUMN "jenisBarang" TEXT;
ALTER TABLE "SuratJalan" ADD COLUMN "noPolisi" TEXT;
ALTER TABLE "SuratJalan" ADD COLUMN "sopir" TEXT;
ALTER TABLE "SuratJalan" ADD COLUMN "panjang" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "lebar" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "tinggi" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "m3" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SuratJalan" ADD COLUMN "jam" TEXT;

CREATE INDEX "SuratJalan_customerId_idx" ON "SuratJalan"("customerId");

ALTER TABLE "SuratJalan" ADD CONSTRAINT "SuratJalan_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hubungkan InvoiceItem ke SuratJalan (satu Surat Jalan hanya bisa dipakai
-- di satu baris invoice, supaya tidak tertagih dobel).
ALTER TABLE "InvoiceItem" ADD COLUMN "suratJalanId" TEXT;

CREATE UNIQUE INDEX "InvoiceItem_suratJalanId_key" ON "InvoiceItem"("suratJalanId");

ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_suratJalanId_fkey"
  FOREIGN KEY ("suratJalanId") REFERENCES "SuratJalan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pengaturan umum aplikasi (key-value), dipakai untuk nama penandatangan
-- yang tampil di kolom "Hormat kami," pada cetakan.
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");
