ALTER TABLE "CustomerPrice" ADD COLUMN "vehicleType" TEXT NOT NULL DEFAULT 'CD';
DROP INDEX IF EXISTS "CustomerPrice_customerId_destinationCode_stockCode_key";
CREATE UNIQUE INDEX "CustomerPrice_customerId_destinationCode_vehicleType_stockCode_key" ON "CustomerPrice"("customerId", "destinationCode", "vehicleType", "stockCode");
