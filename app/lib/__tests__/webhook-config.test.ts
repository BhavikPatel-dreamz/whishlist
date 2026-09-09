import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const routePath = resolve(rootDir, "app/routes/webhooks.orders.create.tsx");
const configPath = resolve(rootDir, "shopify.app.toml");

describe("webhook configuration", () => {
  it("registers the order-create webhook and route", () => {
    expect(existsSync(routePath)).toBe(true);

    const config = readFileSync(configPath, "utf8");
    expect(config).toContain('uri = "/webhooks/orders/create"');
    expect(config).toContain('topics = [ "orders/create" ]');
  });
});
