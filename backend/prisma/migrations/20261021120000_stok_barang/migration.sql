-- Menu Stok (pengganti menu Material): kartu stok per barang + mutasi masuk/keluar + upah kuli.
-- Tabel Material (daftar harga lama) TIDAK diubah.
CREATE TABLE "StokBarang" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "kategori" TEXT NOT NULL DEFAULT 'Material',
    "satuan" TEXT,
    "divisi" TEXT NOT NULL DEFAULT 'Kontraktor',
    "namaCustomer" TEXT,
    "proyek" TEXT,
    "qtyAwal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StokBarang_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StokMutasi" (
    "id" TEXT NOT NULL,
    "stokId" TEXT NOT NULL,
    "tipe" TEXT NOT NULL DEFAULT 'KELUAR',
    "tanggal" TIMESTAMP(3) NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "noSurat" TEXT,
    "catatan" TEXT,
    "upahKuli" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StokMutasi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StokBarang_divisi_idx" ON "StokBarang"("divisi");
CREATE INDEX "StokMutasi_stokId_idx" ON "StokMutasi"("stokId");

ALTER TABLE "StokMutasi" ADD CONSTRAINT "StokMutasi_stokId_fkey" FOREIGN KEY ("stokId") REFERENCES "StokBarang"("id") ON DELETE CASCADE ON UPDATE CASCADE;
