-- Tambah kolom "aktif" ke Customer (buat fitur Nonaktifkan, pengganti hapus permanen)
ALTER TABLE "Customer" ADD COLUMN "aktif" BOOLEAN NOT NULL DEFAULT true;

-- Tabel master kode stock (AA, BB, BS, dst) supaya bisa dipilih dari dropdown
CREATE TABLE "StockMaster" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMaster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockMaster_kode_key" ON "StockMaster"("kode");