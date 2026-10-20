/** Minimal shape of the Admin API client returned by `authenticate.*`. */
export type GraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GqlRequestOptions<T> = {
  variables?: Record<string, unknown>;
  /**
   * When set, every failure (HTTP status, GraphQL errors, missing data) throws
   * this exact message instead of the per-error message.
   */
  errorMessage?: string;
  /** Prefix for joined GraphQL error messages. Defaults to `"Shopify GraphQL: "`. */
  errorPrefix?: string;
  /** Whether a missing `data` payload is an error. Defaults to `true`. */
  requireData?: boolean;
  /** Extra success check on `data`; `false` throws like a missing payload. */
  hasData?: (data: T) => boolean;
};

type GqlPayload<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

/**
 * Shared `admin.graphql` → JSON → error handling used by every Shopify data
 * loader, so response parsing and error shapes stay consistent.
 */
export async function gqlRequest<T>(
  admin: GraphqlClient,
  query: string,
  options: GqlRequestOptions<T> = {},
): Promise<T> {
  const { variables, errorMessage, errorPrefix = "Shopify GraphQL: ", requireData = true } = options;

  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const payload = (await response.json()) as GqlPayload<T>;

  const hasPayload = payload.data != null;
  const failed =
    Boolean(payload.errors?.length) ||
    (errorMessage ? !response.ok : false) ||
    (requireData && !hasPayload) ||
    (hasPayload && Boolean(options.hasData) && !options.hasData!(payload.data as T));

  if (failed) {
    if (errorMessage) throw new Error(errorMessage);
    if (payload.errors?.length) {
      throw new Error(
        `${errorPrefix}${payload.errors.map((error) => error.message).join("; ")}`,
      );
    }
    throw new Error(`${errorPrefix}${hasPayload ? "returned unexpected data" : "returned no data"}`);
  }

  return payload.data as T;
}
