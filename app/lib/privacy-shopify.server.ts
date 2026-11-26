import { gqlRequest, type GraphqlClient } from "./graphql.server";
import { toCustomerGid } from "./shopify-data.server";

type CustomerIdentifiers = {
  customerId?: string | null;
  email?: string | null;
  phone?: string | null;
};

const WISHLIST_METAFIELD = { namespace: "wishlist_stock", key: "items" } as const;

async function findCustomerGid(
  admin: GraphqlClient,
  identifiers: CustomerIdentifiers,
): Promise<string | null> {
  if (identifiers.customerId) {
    return identifiers.customerId.startsWith("gid://")
      ? identifiers.customerId
      : toCustomerGid(identifiers.customerId);
  }

  const searchValue = identifiers.email ?? identifiers.phone;
  const search = searchValue
    ? `${identifiers.email ? "email" : "phone"}:"${searchValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      : null;
  if (!search) return null;

  const data = await gqlRequest<{
    customers: { nodes: Array<{ id: string }> };
  }>(
    admin,
    `#graphql
      query FindCustomerForPrivacyRequest($search: String!) {
        customers(first: 1, query: $search) { nodes { id } }
      }
    `,
    { variables: { search } },
  );
  return data.customers.nodes[0]?.id ?? null;
}

export async function readCustomerWishlistMetafield(
  admin: GraphqlClient,
  identifiers: CustomerIdentifiers,
): Promise<string | null> {
  const customerId = await findCustomerGid(admin, identifiers);
  if (!customerId) return null;

  const data = await gqlRequest<{
    customer: { metafield: { value: string | null } | null } | null;
  }>(
    admin,
    `#graphql
      query CustomerWishlistDataRequest($id: ID!) {
        customer(id: $id) {
          metafield(namespace: "${WISHLIST_METAFIELD.namespace}", key: "${WISHLIST_METAFIELD.key}") { value }
        }
      }
    `,
    { variables: { id: customerId } },
  );
  return data.customer?.metafield?.value ?? null;
}

export async function deleteCustomerWishlistMetafield(
  admin: GraphqlClient,
  identifiers: CustomerIdentifiers,
): Promise<void> {
  const customerId = await findCustomerGid(admin, identifiers);
  if (!customerId) return;

  const customer = await gqlRequest<{
    customer: { id: string } | null;
  }>(
    admin,
    `#graphql
      query CustomerExistsForPrivacyRedaction($id: ID!) { customer(id: $id) { id } }
    `,
    { variables: { id: customerId } },
  );
  if (!customer.customer) return;

  const result = await gqlRequest<{
    metafieldsDelete: { userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation DeleteCustomerWishlistForPrivacyRedaction($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          userErrors { message }
        }
      }
    `,
    {
      variables: {
        metafields: [{
          ownerId: customerId,
          namespace: WISHLIST_METAFIELD.namespace,
          key: WISHLIST_METAFIELD.key,
        }],
      },
    },
  );
  const userErrors = result.metafieldsDelete.userErrors;
  if (userErrors.length) {
    throw new Error(`Customer wishlist metafield deletion failed: ${userErrors.map((error) => error.message).join("; ")}`);
  }
}
