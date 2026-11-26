import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteCustomerWishlistMetafield,
  readCustomerWishlistMetafield,
} from "../privacy-shopify.server";

const mocks = vi.hoisted(() => ({ gqlRequest: vi.fn() }));
vi.mock("../graphql.server", () => ({ gqlRequest: mocks.gqlRequest }));
vi.mock("../shopify-data.server", () => ({
  toCustomerGid: (id: string) => `gid://shopify/Customer/${id}`,
}));

const admin = { graphql: vi.fn() };

describe("Shopify privacy data helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a customer by email and exports the wishlist metafield", async () => {
    mocks.gqlRequest
      .mockResolvedValueOnce({ customers: { nodes: [{ id: "gid://shopify/Customer/42" }] } })
      .mockResolvedValueOnce({ customer: { metafield: { value: '[{"productId":"17"}]' } } });

    const result = await readCustomerWishlistMetafield(admin, { email: "person@example.com" });

    expect(result).toBe('[{"productId":"17"}]');
    expect(mocks.gqlRequest.mock.calls[0][2]).toEqual({ variables: { search: 'email:"person@example.com"' } });
    expect(mocks.gqlRequest.mock.calls[1][2]).toEqual({ variables: { id: "gid://shopify/Customer/42" } });
  });

  it("deletes the app-owned customer wishlist metafield", async () => {
    mocks.gqlRequest
      .mockResolvedValueOnce({ customer: { id: "gid://shopify/Customer/42" } })
      .mockResolvedValueOnce({ metafieldsDelete: { userErrors: [] } });

    await deleteCustomerWishlistMetafield(admin, { customerId: "42" });

    expect(mocks.gqlRequest.mock.calls[1][2]).toEqual({
      variables: {
        metafields: [{
          ownerId: "gid://shopify/Customer/42",
          namespace: "wishlist_stock",
          key: "items",
        }],
      },
    });
  });
});
