import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateStoreScopes } from "../models/store.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = (payload.current as string[]) || [];
    if (session) {
      await db.session.update({
        where: { id: session.id },
        data: { scope: current.toString() },
      });
    }
    await updateStoreScopes(shop, current).catch((error) => {
      console.error("updateStoreScopes failed", error);
    });
    return new Response();
  } catch (error) {
    console.error("app/scopes_update handler error", error);
    return new Response();
  }
};
