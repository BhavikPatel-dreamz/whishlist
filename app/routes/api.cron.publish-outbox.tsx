import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "../lib/crypto.server";
import { publishOutboxBatch } from "../lib/notifications/outbox.server";

async function authorize(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json({ ok: false, error: "cron_disabled" }, { status: 503 });
  }
  const provided = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!provided || !timingSafeEqual(provided, secret)) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Publishes unpublished OutboxMessage rows to SQS.
 * Schedule frequently (e.g. every minute) as a safety net beside webhook best-effort publish.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const denied = await authorize(request);
  if (denied) return denied;
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const result = await publishOutboxBatch(200);
  return json({ ok: true, ...result });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const denied = await authorize(request);
  if (denied) return denied;
  const result = await publishOutboxBatch(200);
  return json({ ok: true, ...result });
};
