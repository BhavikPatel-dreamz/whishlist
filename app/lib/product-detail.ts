/**
 * Shapes returned by the product drill-down used by the Overview's
 * "Top 5 products by saves" card. Shared between the resource route and the
 * client-side drawer so both sides agree on the contract.
 */

export type ProductDetailSaver = {
  id: string;
  name: string;
  type: "customer" | "guest";
  saves: number;
  firstSavedAt: string;
  lastSavedAt: string;
  source: string | null;
  device: string | null;
};

export type ProductDetailSubscription = {
  id: string;
  contact: string;
  channel: string;
  variantTitle: string;
  status: string;
  confirmed: boolean;
  createdAt: string;
  notifiedAt: string | null;
  convertedAt: string | null;
  purchasedAt: string | null;
  purchaseOrderId: string | null;
  purchaseRevenue: number | null;
  purchaseCurrency: string | null;
  pendingReason: string | null;
  lastError: string | null;
};

export type ProductDetailNotification = {
  id: string;
  recipient: string;
  channel: string;
  kind: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  errorReason: string | null;
  retryCount: number;
};

export type ProductDetailOrder = {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: string;
  orderedAt: string;
  sources: string[];
  types: string[];
  quantity: number;
  revenue: number;
};

export type ProductDetailRevenueRow = {
  source: string;
  type: string;
  orders: number;
  units: number;
  revenue: number;
};

export type ProductDetailVariant = {
  variantId: string;
  title: string;
  price: string | null;
  availableForSale: boolean;
  sku: string | null;
};

export type ProductDetail = {
  product: {
    productId: string;
    title: string;
    imageUrl: string | null;
    onlineStoreUrl: string | null;
    status: string;
    totalInventory: number;
    price: string | null;
    currencyCode: string | null;
    variants: ProductDetailVariant[];
  };
  range: { from: string; to: string };
  summary: {
    saves: number;
    uniqueSavers: number;
    subscriptions: number;
    pendingAlerts: number;
    notificationsSent: number;
    notificationsDelivered: number;
    notificationsClicked: number;
    attributedOrders: number;
    attributedUnits: number;
    attributedRevenue: number;
  };
  savers: ProductDetailSaver[];
  subscriptions: ProductDetailSubscription[];
  pendingAlerts: ProductDetailSubscription[];
  notifications: ProductDetailNotification[];
  orders: ProductDetailOrder[];
  revenue: ProductDetailRevenueRow[];
  revenueLabel: "direct" | "estimated" | "mixed";
};

/** How many rows each drawer section lists before it stops rendering. */
export const PRODUCT_DETAIL_ROW_LIMIT = 100;
