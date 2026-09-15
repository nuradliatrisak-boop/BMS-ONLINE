-- Fitur: baris Dokumen (STNK/KIR/Invoice/SIA/dst) sekarang bisa ditandai
-- "cukup isian teks" (tidak perlu upload file). Kolom `butuhFile` dipakai
-- panel dokumen (DokumenAsetPanel.vue) untuk menentukan tampil-tidaknya
-- input upload per baris. Default true supaya baris lama (semuanya asumsi
-- perlu file) tidak berubah perilaku.
ALTER TABLE "Dokumen" ADD COLUMN "butuhFile" BOOLEAN NOT NULL DEFAULT true;
