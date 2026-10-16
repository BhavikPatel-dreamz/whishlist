-- CreateTable
CREATE TABLE "UIConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "extensionActive" TEXT NOT NULL DEFAULT 'none',
    "productCardConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UIConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UIConfig_shopId_key" ON "UIConfig"("shopId");

-- CreateIndex
CREATE INDEX "UIConfig_extensionActive_idx" ON "UIConfig"("extensionActive");

-- AddForeignKey
ALTER TABLE "UIConfig" ADD CONSTRAINT "UIConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;