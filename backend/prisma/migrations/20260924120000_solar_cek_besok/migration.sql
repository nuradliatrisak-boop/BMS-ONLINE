-- Cek keesokan hari untuk Solar Masuk: `liter` = catatan buku sopir,
-- `literReal` = catatan real yang masuk (diisi hari berikutnya).
ALTER TABLE "SolarTx" ADD COLUMN "literReal" DOUBLE PRECISION;
ALTER TABLE "SolarTx" ADD COLUMN "tanggalCek" TIMESTAMP(3);
ALTER TABLE "SolarTx" ADD COLUMN "catatanCek" TEXT;

-- Bawa data "Jadwal Setor Solar" lama ke model baru (menu Jadwal Setor
-- digabung ke Laporan Divisi > Stok Solar). Di model lama: literWajib =
-- yang seharusnya, literSetor = yang benar-benar disetor. Sekarang:
-- liter = seharusnya (catatan), literReal = yang benar-benar masuk.
-- Stok tidak berubah karena stok memakai literReal kalau sudah ada.
UPDATE "SolarTx" AS t
SET "liter" = j."literWajib",
    "literReal" = j."literSetor",
    "tanggalCek" = t."createdAt",
    "catatanCek" = j."catatan"
FROM "SolarJadwalSetor" AS j
WHERE j."solarTxId" = t."id"
  AND j."status" <> 'BELUM'
  AND j."literSetor" IS NOT NULL;
