-- Purchase Order (PO) + barang PO + pengiriman per barang (input manual).
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "divisi" TEXT NOT NULL DEFAULT 'Supplier',
    "tanggal" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "namaCustomer" TEXT,
    "proyek" TEXT,
    "lokasiProyek" TEXT,
    "kepalaProyek" TEXT,
    "penerimaBarang" TEXT,
    "catatan" TEXT,
    "ppnPersen" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "batal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "urut" INTEGER NOT NULL DEFAULT 0,
    "uraian" TEXT NOT NULL,
    "satuan" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "hargaSatuan" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PoPengiriman" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "noSuratJalan" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoPengiriman_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_no_key" ON "PurchaseOrder"("no");
CREATE INDEX "PurchaseOrder_customerId_idx" ON "PurchaseOrder"("customerId");
CREATE INDEX "PurchaseOrder_tanggal_idx" ON "PurchaseOrder"("tanggal");
CREATE INDEX "PurchaseOrder_divisi_idx" ON "PurchaseOrder"("divisi");
CREATE INDEX "PurchaseOrderItem_poId_idx" ON "PurchaseOrderItem"("poId");
CREATE INDEX "PoPengiriman_poId_idx" ON "PoPengiriman"("poId");
CREATE INDEX "PoPengiriman_itemId_idx" ON "PoPengiriman"("itemId");

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoPengiriman" ADD CONSTRAINT "PoPengiriman_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoPengiriman" ADD CONSTRAINT "PoPengiriman_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
