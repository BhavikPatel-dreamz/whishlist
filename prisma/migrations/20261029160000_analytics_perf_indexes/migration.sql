-- Analytics live-query indexes (StockAlert notified/converted + NotificationLog channel/sentAt)
CREATE INDEX IF NOT EXISTS "StockAlert_shopId_notifiedAt_idx" ON "StockAlert"("shopId", "notifiedAt");
CREATE INDEX IF NOT EXISTS "StockAlert_shopId_convertedAt_idx" ON "StockAlert"("shopId", "convertedAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_shopId_channel_sentAt_idx" ON "NotificationLog"("shopId", "channel", "sentAt");
