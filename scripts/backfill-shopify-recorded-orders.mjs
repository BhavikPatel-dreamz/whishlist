import { Prisma, PrismaClient } from "@prisma/client";

const shopDomain = process.argv.find((arg) => arg.startsWith("--shop="))?.slice(7);
const apply = process.argv.includes("--apply");
if (!shopDomain) {
    console.error("Usage: node --env-file=.env scripts/backfill-shopify-recorded-orders.mjs --shop=<shop.myshopify.com> [--apply]");
    process.exit(1);
}

const db = new PrismaClient();
const apiVersion = "2025-01";
const tailId = (value) => String(value ?? "").split("/").pop() || "";

try {
    const shop = await db.shop.findUnique({
        where: { shop: shopDomain },
        select: { id: true },
    });
    if (!shop) throw new Error(`Shop not found: ${shopDomain}`);

    const session = await db.session.findFirst({
        where: { shop: shopDomain, isOnline: false },
        select: { accessToken: true },
    });
    if (!session?.accessToken) throw new Error("No offline Shopify admin session found for this shop.");

    const [wishlistRefs, purchasedAlerts] = await Promise.all([
        db.wishlistOrder.findMany({
            where: { shopId: shop.id },
            select: { orderId: true, productId: true },
        }),
        db.stockAlert.findMany({
            where: {
                shopId: shop.id,
                purchaseOrderId: { not: null },
                purchasedAt: { not: null },
            },
            select: {
                purchaseOrderId: true,
                productId: true,
                variantId: true,
                purchasedAt: true,
            },
        }),
    ]);
    const orderIds = [...new Set([
        ...wishlistRefs.map((row) => row.orderId),
        ...purchasedAlerts.map((row) => row.purchaseOrderId),
    ].filter(Boolean))];
    if (!orderIds.length) {
        console.log(JSON.stringify({ shop: shopDomain, apply, orderRefs: 0, eligibleLines: 0, inserted: 0 }));
        process.exitCode = 0;
    } else {
        const ids = orderIds.map((id) => id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`);
        const response = await fetch(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": session.accessToken,
            },
            body: JSON.stringify({
                query: `query BackfillRecordedWishlistOrders($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id
              name
              createdAt
              processedAt
              customer { id }
              customAttributes { key value }
              lineItems(first: 250) {
                nodes {
                  id
                  quantity
                  product { id }
                  variant { id }
                  originalUnitPriceSet { shopMoney { amount } }
                  discountedTotalSet { shopMoney { amount } }
                }
              }
            }
          }
        }`,
                variables: { ids },
            }),
        });
        const payload = await response.json();
        if (!response.ok || payload.errors?.length) {
            throw new Error(`Shopify order lookup failed (HTTP ${response.status}): ${JSON.stringify(payload.errors ?? payload)}`);
        }

        const wishlistProductsByOrder = new Map();
        for (const ref of wishlistRefs) {
            const key = tailId(ref.orderId);
            const products = wishlistProductsByOrder.get(key) ?? new Set();
            products.add(ref.productId);
            wishlistProductsByOrder.set(key, products);
        }
        const alertsByOrderProduct = new Map();
        for (const alert of purchasedAlerts) {
            const key = `${tailId(alert.purchaseOrderId)}:${alert.productId}`;
            const rows = alertsByOrderProduct.get(key) ?? [];
            rows.push(alert);
            alertsByOrderProduct.set(key, rows);
        }

        const rows = [];
        let foundOrders = 0;
        for (const order of payload.data?.nodes ?? []) {
            if (!order) continue;
            foundOrders++;
            const orderId = tailId(order.id);
            const orderedAt = new Date(order.processedAt || order.createdAt);
            const customerId = order.customer?.id ? tailId(order.customer.id) : null;
            const shareVisitor = order.customAttributes?.find((attribute) => attribute.key === "_ws_share_visitor_id")?.value;
            const shopperId = typeof shareVisitor === "string" && /^[\w-]{16,64}$/.test(shareVisitor)
                ? shareVisitor
                : customerId;
            const wishlistProducts = wishlistProductsByOrder.get(orderId) ?? new Set();

            for (const line of order.lineItems?.nodes ?? []) {
                const productId = tailId(line.product?.id);
                if (!productId) continue;
                const variantId = line.variant?.id ? tailId(line.variant.id) : null;
                const lineItemId = tailId(line.id);
                const wishlistTouch = wishlistProducts.has(productId);
                const matchingAlerts = (alertsByOrderProduct.get(`${orderId}:${productId}`) ?? [])
                    .filter((alert) => !alert.variantId || !variantId || tailId(alert.variantId) === variantId);
                if (!wishlistTouch && !matchingAlerts.length) continue;

                const quantity = Number(line.quantity) || 1;
                const discountedTotal = Number(line.discountedTotalSet?.shopMoney?.amount);
                const unitPrice = Number(line.originalUnitPriceSet?.shopMoney?.amount);
                const revenue = Number.isFinite(discountedTotal)
                    ? Math.max(0, discountedTotal)
                    : Math.max(0, unitPrice * quantity);
                const base = {
                    shopId: shop.id,
                    orderId,
                    lineItemId,
                    orderNumber: String(order.name || orderId),
                    customerId,
                    shopperId,
                    productId,
                    variantId,
                    type: "DIRECT",
                    notificationLogId: null,
                    wishlistItemId: null,
                    revenue: new Prisma.Decimal(revenue.toFixed(2)),
                    quantity,
                    orderedAt,
                };

                if (matchingAlerts.length) {
                    rows.push({
                        ...base,
                        source: "RESTOCK_ALERT",
                        model: "last_click",
                        touchAt: matchingAlerts[0].purchasedAt ?? orderedAt,
                    });
                    if (wishlistTouch) {
                        rows.push({
                            ...base,
                            source: "WISHLIST",
                            model: "any_touch",
                            touchAt: orderedAt,
                        });
                    }
                } else {
                    rows.push({
                        ...base,
                        source: "WISHLIST",
                        model: "last_click",
                        touchAt: orderedAt,
                    });
                }
            }
        }

        let inserted = 0;
        if (apply && rows.length) {
            const result = await db.attribution.createMany({ data: rows, skipDuplicates: true });
            inserted = result.count;
        }
        console.log(JSON.stringify({
            shop: shopDomain,
            apply,
            wishlistOrderProductRefs: wishlistRefs.length,
            purchasedAlertRefs: purchasedAlerts.length,
            requestedOrders: orderIds.length,
            returnedOrders: foundOrders,
            eligibleAttributionRows: rows.length,
            inserted,
        }));
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : "Backfill failed");
    process.exitCode = 1;
} finally {
    await db.$disconnect();
}
