-- Customer master: add stable customer code without breaking existing rows.
ALTER TABLE "Customer" ADD COLUMN "kode" TEXT;
UPDATE "Customer" SET "kode" = 'LEGACY-' || "id" WHERE "kode" IS NULL;
ALTER TABLE "Customer" ALTER COLUMN "kode" SET NOT NULL;
CREATE UNIQUE INDEX "Customer_kode_key" ON "Customer"("kode");

-- Customer-specific destination / stock / price master.
CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "destinationCode" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "hargaM3" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sewaTruk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hppTruk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "destination" TEXT,
    "discount" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPrice_customerId_destinationCode_stockCode_key"
ON "CustomerPrice"("customerId", "destinationCode", "stockCode");

CREATE INDEX "CustomerPrice_customerId_idx" ON "CustomerPrice"("customerId");

ALTER TABLE "CustomerPrice"
ADD CONSTRAINT "CustomerPrice_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rekap penjualan / tagihan per customer, mengikuti format lembar rekap fisik BMS.
CREATE TABLE "RekapPenjualan" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "noSuratJalan" TEXT NOT NULL,
    "noPolisi" TEXT NOT NULL,
    "jenisBarang" TEXT NOT NULL,
    "panjang" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lebar" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tinggi" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jumlah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "harga" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RekapPenjualan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RekapPenjualan_customerId_tanggal_idx"
ON "RekapPenjualan"("customerId", "tanggal");

CREATE INDEX "RekapPenjualan_noSuratJalan_idx"
ON "RekapPenjualan"("noSuratJalan");

ALTER TABLE "RekapPenjualan"
ADD CONSTRAINT "RekapPenjualan_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
