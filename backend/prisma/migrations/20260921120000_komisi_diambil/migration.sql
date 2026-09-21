-- Status pengambilan komisi sopir per Surat Jalan.
-- Komisi dianggap "didapat" saat tugas selesai (statusTTD = LENGKAP).
-- Kolom baru punya default, data lama tetap aman (semua = belum diambil).
ALTER TABLE "SuratJalan" ADD COLUMN "komisiDiambil" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SuratJalan" ADD COLUMN "komisiDiambilAt" TIMESTAMP(3);
CREATE INDEX "SuratJalan_sopirId_idx" ON "SuratJalan"("sopirId");
