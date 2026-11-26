import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@prisma/client";
import { deliverCustomerDataRequest } from "../privacy-data-request.server";

const mocks = vi.hoisted(() => ({
  db: {
    wishlistItem: { findMany: vi.fn() },
    wishlistEvent: { findMany: vi.fn() },
    stockAlert: { findMany: vi.fn() },
    trackingEvent: { findMany: vi.fn() },
    notificationLog: { findMany: vi.fn() },
    wishlistShare: { findMany: vi.fn() },
    wishlistList: { findMany: vi.fn() },
    shopifyOrderRecord: { findMany: vi.fn() },
    wishlistOrder: { findMany: vi.fn() },
    attribution: { findMany: vi.fn() },
  },
  readMetafield: vi.fn(),
  managedMailgunConfigured: vi.fn(),
  resolveSettingsForPlan: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../../db.server", () => ({ default: mocks.db }));
vi.mock("../privacy-shopify.server", () => ({
  readCustomerWishlistMetafield: mocks.readMetafield,
}));
vi.mock("../notifications/managed-mailgun.server", () => ({
  managedMailgunConfigured: mocks.managedMailgunConfigured,
}));
vi.mock("../notifications/providers.server", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../shop.server", () => ({ resolveSettingsForPlan: mocks.resolveSettingsForPlan }));

const shop = {
  id: "shop-id",
  shop: "store.myshopify.com",
  contactEmail: "owner@example.org",
  email: "fallback@example.org",
} as Shop;

describe("deliverCustomerDataRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mocks.db).forEach((model) => model.findMany.mockResolvedValue([]));
    mocks.readMetafield.mockResolvedValue('[{"productId":"17"}]');
    mocks.managedMailgunConfigured.mockReturnValue(true);
    mocks.resolveSettingsForPlan.mockReturnValue({ provider: "mailgun" });
    mocks.sendEmail.mockResolvedValue({ ok: true });
  });

  it("sends app-held records and the Shopify metafield to the merchant contact", async () => {
    mocks.db.stockAlert.findMany.mockResolvedValue([
      { email: "customer@example.net", productId: "17" },
    ]);
    mocks.db.shopifyOrderRecord.findMany.mockResolvedValue([
      { orderId: "101", lines: [{ lineItemId: "line-1" }] },
    ]);

    await deliverCustomerDataRequest(
      shop,
      {
        customer: { id: 42, email: "Customer@Example.net" },
        data_request: { id: 9001 },
        orders_requested: [101],
      },
      { graphql: vi.fn() },
    );

    const message = mocks.sendEmail.mock.calls[0][1];
    expect(message.to).toBe("owner@example.org");
    expect(message.subject).toContain("9001");
    expect(message.text).toContain('"productId": "17"');
    expect(message.text).toContain("customer@example.net");
    expect(message.text).toContain("line-1");
    expect(mocks.db.shopifyOrderRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ orderId: { in: ["101"] } }]) }) }),
    );
  });

  it("fails rather than silently acknowledging when managed delivery is unavailable", async () => {
    mocks.managedMailgunConfigured.mockReturnValue(false);

    await expect(
      deliverCustomerDataRequest(shop, { customer: { id: 42 } }, { graphql: vi.fn() }),
    ).rejects.toThrow("managed email is not configured");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
