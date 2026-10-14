-- Keputusan user soal pencocokan Surat Jalan -> PO (terhubung / ditolak).
CREATE TABLE "PoSuratJalan" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "suratJalanId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoSuratJalan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PoSuratJalan_poId_suratJalanId_key" ON "PoSuratJalan"("poId", "suratJalanId");
CREATE INDEX "PoSuratJalan_suratJalanId_idx" ON "PoSuratJalan"("suratJalanId");

ALTER TABLE "PoSuratJalan" ADD CONSTRAINT "PoSuratJalan_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoSuratJalan" ADD CONSTRAINT "PoSuratJalan_suratJalanId_fkey" FOREIGN KEY ("suratJalanId") REFERENCES "SuratJalan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
