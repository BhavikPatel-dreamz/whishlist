export type WishlistDay = { date: string; orders: number; views: number; wishlist: number; cart: number };

export function wishlistChartDays(
  today: Date,
  saves: { date: string; count: number }[],
  carts: { date: string; count: number }[],
  pageViews: { date: string; count: number }[] = [],
  orderCounts: { date: string; count: number }[] = [],
): WishlistDay[] {
  const wishlist = new Map(saves.map(row => [row.date, row.count]));
  const cart = new Map(carts.map(row => [row.date, row.count]));
  const orders = new Map(orderCounts.map(row => [row.date, row.count]));
  const views = new Map(pageViews.map(row => [row.date, row.count]));
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29));
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    return { date, orders: orders.get(date) ?? 0, views: views.get(date) ?? 0, wishlist: wishlist.get(date) ?? 0, cart: cart.get(date) ?? 0 };
  });
}
