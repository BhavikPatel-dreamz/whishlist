import { authenticateProxyRequest, type ProxyContext } from "./proxy-auth.server";
import { clientIp, errorResponse } from "./proxy.server";
import { rateLimit } from "./rate-limit.server";

export type ProxyLimit = {
  /** Bucket prefix — usually the endpoint name. */
  name: string;
  limit: number;
  windowSeconds: number;
  message?: string;
};

export type ProxyRouteOptions = {
  /** Primary rate limit applied before the handler runs. */
  limit?: ProxyLimit;
  /** Further limits applied alongside the primary one (e.g. hourly caps). */
  extraLimits?: ProxyLimit[];
};

/**
 * Shared storefront proxy shell: authenticate, apply rate limits, run the
 * handler, and map any thrown `ProxyError`/`Response` to the standard reply.
 * Pass `null` for routes that need no rate limiting.
 */
export async function withProxy<T>(
  request: Request,
  options: ProxyRouteOptions | null,
  handler: (ctx: ProxyContext) => Promise<T> | T,
): Promise<T | Response> {
  try {
    const ctx = await authenticateProxyRequest(request);

    const limits = [
      ...(options?.limit ? [options.limit] : []),
      ...(options?.extraLimits ?? []),
    ];
    if (limits.length) {
      const ip = clientIp(request);
      // Independent buckets — check them together instead of one round trip each.
      await Promise.all(
        limits.map((rule) =>
          rateLimit({
            key: `${rule.name}:${ctx.shopDomain}:${ip}`,
            limit: rule.limit,
            windowSeconds: rule.windowSeconds,
            shopId: ctx.shop.id,
            ...(rule.message ? { message: rule.message } : {}),
          }),
        ),
      );
    }

    return await handler(ctx);
  } catch (error) {
    return errorResponse(error);
  }
}
