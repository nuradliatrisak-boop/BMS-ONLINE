-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "StatusPembayaran" AS ENUM ('BELUM', 'SEBAGIAN', 'LUNAS');

-- CreateEnum
CREATE TYPE "StatusTTD" AS ENUM ('BELUM_TTD', 'LENGKAP');

-- CreateEnum
CREATE TYPE "TipeTransaksi" AS ENUM ('PENJUALAN', 'PENGELUARAN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "divisi" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,
    "telepon" TEXT,
    "npwp" TEXT,
    "divisi" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Armada" (
    "id" TEXT NOT NULL,
    "nopol" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "sopir" TEXT,
    "divisi" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Armada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "satuan" TEXT NOT NULL,
    "hargaSatuan" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "divisi" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "divisi" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "jatuhTempo" TIMESTAMP(3),
    "status" "StatusPembayaran" NOT NULL DEFAULT 'BELUM',
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "keterangan" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "satuan" TEXT,
    "hargaSatuan" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pembayaran" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "nominal" DOUBLE PRECISION NOT NULL,
    "metode" TEXT,
    "catatan" TEXT,

    CONSTRAINT "Pembayaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuratJalan" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "divisi" TEXT NOT NULL,
    "armadaId" TEXT,
    "tujuan" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "statusTTD" "StatusTTD" NOT NULL DEFAULT 'BELUM_TTD',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuratJalan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisiTx" (
    "id" TEXT NOT NULL,
    "divisi" TEXT NOT NULL,
    "tipe" "TipeTransaksi" NOT NULL,
    "keterangan" TEXT NOT NULL,
    "nominal" DOUBLE PRECISION NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DivisiTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintCalib" (
    "id" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "PrintCalib_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_no_key" ON "Invoice"("no");

-- CreateIndex
CREATE UNIQUE INDEX "SuratJalan_no_key" ON "SuratJalan"("no");

-- CreateIndex
CREATE UNIQUE INDEX "PrintCalib_jenis_key" ON "PrintCalib"("jenis");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pembayaran" ADD CONSTRAINT "Pembayaran_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuratJalan" ADD CONSTRAINT "SuratJalan_armadaId_fkey" FOREIGN KEY ("armadaId") REFERENCES "Armada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
