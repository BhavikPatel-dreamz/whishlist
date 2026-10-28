import { afterEach, describe, expect, it } from "vitest";
import {
  managedMailgunApiBaseUrl,
  managedMailgunApiKey,
  managedMailgunConfigured,
  managedMailgunDomain,
  managedSenderEmail,
} from "../managed-mailgun.server";

const KEYS = [
  "MAILGUN_API_KEY",
  "MAILGUN_DOMAIN",
  "MAILGUN_API_BASE_URL",
  "DEFAULT_SENDER_EMAIL",
  "MAILGUN_FROM_EMAIL",
] as const;

const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of KEYS) {
    if (previous.has(key)) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      previous.delete(key);
    }
  }
});

function setEnv(key: (typeof KEYS)[number], value: string | undefined) {
  if (!previous.has(key)) previous.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("managedMailgun helpers", () => {
  it("reads platform Mailgun env", () => {
    setEnv("MAILGUN_API_KEY", "key-test");
    setEnv("MAILGUN_DOMAIN", "mg.example.com");
    setEnv("DEFAULT_SENDER_EMAIL", "alerts@mg.example.com");
    setEnv("MAILGUN_API_BASE_URL", "https://api.eu.mailgun.net/");

    expect(managedMailgunApiKey()).toBe("key-test");
    expect(managedMailgunDomain()).toBe("mg.example.com");
    expect(managedSenderEmail()).toBe("alerts@mg.example.com");
    expect(managedMailgunApiBaseUrl()).toBe("https://api.eu.mailgun.net");
    expect(managedMailgunConfigured()).toBe(true);
  });

  it("reports not configured when key or domain is missing", () => {
    setEnv("MAILGUN_API_KEY", undefined);
    setEnv("MAILGUN_DOMAIN", "mg.example.com");
    setEnv("DEFAULT_SENDER_EMAIL", "alerts@mg.example.com");
    expect(managedMailgunConfigured()).toBe(false);
  });
});
