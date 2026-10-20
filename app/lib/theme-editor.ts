const EDITOR_BASE = "https://{shop}/admin/themes/current/editor";

export function themeEditorUrl(
  shop: string,
  options?: { template?: string; activateAppId?: string },
): string {
  const params = new URLSearchParams({ context: "apps" });
  if (options?.template) params.set("template", options.template);
  if (options?.activateAppId) params.set("activateAppId", options.activateAppId);
  return `${EDITOR_BASE.replace("{shop}", shop)}?${params.toString()}`;
}

/** Theme editor deep-link that auto-activates one of the app's embed blocks. */
export function embedEditorUrl(shop: string, handle: string): string {
  const apiKey = process.env.SHOPIFY_API_KEY;
  return themeEditorUrl(
    shop,
    apiKey ? { template: "index", activateAppId: `${apiKey}/${handle}` } : { template: "index" },
  );
}
