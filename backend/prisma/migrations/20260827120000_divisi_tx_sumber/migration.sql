-- Tambah kolom "sumber" pada DivisiTx untuk menandai asal data
-- (mis. hasil import dari Excel) vs input manual (NULL).
ALTER TABLE "DivisiTx" ADD COLUMN "sumber" TEXT;
