-- Perbaikan model cek Solar Masuk.
-- Data Solar Masuk yang sudah diinput = stok REAL yang masuk (`liter`).
-- Yang baru ditambahkan adalah CATATAN BUKU sopir (`literCatatan`), yang
-- dibandingkan dengan angka real. Kolom sementara dari migrasi sebelumnya
-- (literReal/tanggalCek/catatanCek) dibuang.
ALTER TABLE "SolarTx" ADD COLUMN "literCatatan" DOUBLE PRECISION;

-- Baris yang sempat memakai literReal (mis. hasil pindahan Jadwal Setor lama):
-- angka di `liter` adalah catatan/wajib, `literReal` adalah yang disetor
-- sebenarnya -> tukar supaya `liter` kembali berarti real.
UPDATE "SolarTx"
SET "literCatatan" = "liter",
    "liter" = "literReal"
WHERE "literReal" IS NOT NULL;

ALTER TABLE "SolarTx" DROP COLUMN "literReal";
ALTER TABLE "SolarTx" DROP COLUMN "tanggalCek";
ALTER TABLE "SolarTx" DROP COLUMN "catatanCek";
