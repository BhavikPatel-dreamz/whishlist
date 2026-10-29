import { describe, expect, it, afterEach } from "vitest";
import { isRestockQueueEnabled } from "../queue-flag.server";

describe("isRestockQueueEnabled", () => {
  const prev = process.env.RESTOCK_QUEUE_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.RESTOCK_QUEUE_ENABLED;
    else process.env.RESTOCK_QUEUE_ENABLED = prev;
  });

  it("respects global env true", () => {
    process.env.RESTOCK_QUEUE_ENABLED = "true";
    expect(isRestockQueueEnabled({ restockQueueEnabled: false })).toBe(true);
  });

  it("falls back to shop flag when env unset", () => {
    delete process.env.RESTOCK_QUEUE_ENABLED;
    expect(isRestockQueueEnabled({ restockQueueEnabled: true })).toBe(true);
    expect(isRestockQueueEnabled({ restockQueueEnabled: false })).toBe(false);
  });

  it("allows per-shop opt-in when env is false", () => {
    process.env.RESTOCK_QUEUE_ENABLED = "false";
    expect(isRestockQueueEnabled({ restockQueueEnabled: true })).toBe(true);
    expect(isRestockQueueEnabled({ restockQueueEnabled: false })).toBe(false);
  });
});
