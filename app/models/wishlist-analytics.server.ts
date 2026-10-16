import db from "../db.server";
import { wishlistChartDays } from "../lib/wishlist-chart.shared";

export async function wishlistDailyAnalytics(shopId: string, today = new Date()) {
  const days = wishlistChartDays(today, [], []);
  const start = new Date(`${days[0].date}T00:00:00.000Z`);
  const end = new Date(new Date(`${days[29].date}T00:00:00.000Z`).getTime() + 86400000);
  const [saves, orders, carts] = await Promise.all([
    db.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS count
      FROM "WishlistItem" WHERE "shopId" = ${shopId}
      AND "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY to_char("createdAt", 'YYYY-MM-DD')
    `,
    db.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT to_char("recordedAt", 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS count
      FROM (
        SELECT "orderId", MIN("createdAt") AS "recordedAt"
        FROM "WishlistOrder" WHERE "shopId" = ${shopId} GROUP BY "orderId"
      ) AS orders
      WHERE "recordedAt" >= ${start} AND "recordedAt" < ${end}
      GROUP BY to_char("recordedAt", 'YYYY-MM-DD')
    `,
    db.wishlistCartDay.findMany({ where: { shopId, date: { gte: start, lt: end } } }),
  ]);
  return wishlistChartDays(today,
    saves.map(row => ({ date: row.date, count: Number(row.count) })),
    carts.map(row => ({ date: row.date.toISOString().slice(0, 10), count: row.count })),
    carts.map(row => ({ date: row.date.toISOString().slice(0, 10), count: row.pageViews })),
    orders.map(row => ({ date: row.date, count: Number(row.count) })),
  );
}

export async function recordWishlistPageView(shopId: string, now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await db.wishlistCartDay.upsert({
    where: { shopId_date: { shopId, date } },
    create: { shopId, date, pageViews: 1 },
    update: { pageViews: { increment: 1 } },
  });
}
