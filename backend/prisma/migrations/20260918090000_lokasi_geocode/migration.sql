-- Tambahan untuk fitur PETA & STATISTIK PER LOKASI (Sewa Alat Berat & Solar):
--   InvoiceItem.lokasi/lokasiLat/lokasiLng : lokasi sewa alat (baris invoice
--     dengan kategoriAlat terisi), diisi bebas oleh staf lalu digeocode
--     otomatis jadi koordinat.
--   SolarTx.lokasiLat/lokasiLng            : koordinat hasil geocoding dari
--     kolom `lokasi` yang SUDAH ADA sebelumnya (Solar Keluar).
--   GeoCache                                : cache hasil geocoding supaya
--     tidak memanggil layanan geocoding berulang untuk teks lokasi yang sama.
-- Semua kolom baru OPSIONAL -- data lama tetap jalan tanpa perlu diisi.
ALTER TABLE "InvoiceItem" ADD COLUMN "lokasi" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "lokasiLat" DOUBLE PRECISION;
ALTER TABLE "InvoiceItem" ADD COLUMN "lokasiLng" DOUBLE PRECISION;

ALTER TABLE "SolarTx" ADD COLUMN "lokasiLat" DOUBLE PRECISION;
ALTER TABLE "SolarTx" ADD COLUMN "lokasiLng" DOUBLE PRECISION;

CREATE INDEX "InvoiceItem_lokasi_idx" ON "InvoiceItem"("lokasi");

CREATE TABLE "GeoCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeoCache_query_key" ON "GeoCache"("query");
