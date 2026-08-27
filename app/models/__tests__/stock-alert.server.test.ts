import { describe, it, expect } from "vitest";
import { ALERT_STATUS, type AlertStatus } from "../stock-alert.server";

describe("ALERT_STATUS", () => {
  it("has all required statuses", () => {
    expect(ALERT_STATUS.pending).toBe("PENDING");
    expect(ALERT_STATUS.confirmed).toBe("CONFIRMED");
    expect(ALERT_STATUS.sending).toBe("SENDING");
    expect(ALERT_STATUS.sent).toBe("SENT");
    expect(ALERT_STATUS.failed).toBe("FAILED");
    expect(ALERT_STATUS.cancelled).toBe("CANCELLED");
  });

  it("has exactly 6 statuses", () => {
    expect(Object.keys(ALERT_STATUS)).toHaveLength(6);
  });

  it("AlertStatus type includes all values", () => {
    const statuses: AlertStatus[] = [
      ALERT_STATUS.pending,
      ALERT_STATUS.confirmed,
      ALERT_STATUS.sending,
      ALERT_STATUS.sent,
      ALERT_STATUS.failed,
      ALERT_STATUS.cancelled,
    ];
    expect(statuses).toHaveLength(6);
  });
});
