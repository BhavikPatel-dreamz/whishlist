import type { ReactNode } from "react";

/** Shared page chrome for the public stock-alert landing pages. */
const pageStyle = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  maxWidth: "32rem",
  margin: "10vh auto",
  padding: "0 1.5rem",
  textAlign: "center",
  color: "#1a1a1a",
} as const;

const headingStyle = { fontSize: "1.5rem", marginBottom: "0.75rem" } as const;
const bodyStyle = { color: "#4a4f54", lineHeight: 1.6 } as const;

export function AlertLandingShell({ children }: { children: ReactNode }) {
  return <main style={pageStyle}>{children}</main>;
}

export function AlertLandingHeading({ children }: { children: ReactNode }) {
  return <h1 style={headingStyle}>{children}</h1>;
}

export function AlertLandingBody({ children }: { children: ReactNode }) {
  return <p style={bodyStyle}>{children}</p>;
}
