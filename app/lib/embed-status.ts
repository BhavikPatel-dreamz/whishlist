export type ExtensionInfo = {
  type: string;
  activations: { handle: string; target: string; status: string }[];
};

export type EmbedStatus = "Enabled" | "Disabled" | "Unavailable" | "Unknown";

/** App Bridge can leave a request pending when the admin connection is lost. */
export async function fetchEmbedExtensions(
  bridge: { app?: { extensions?: () => Promise<ExtensionInfo[]> } },
  timeoutMs = 5000,
): Promise<ExtensionInfo[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (!bridge.app?.extensions) {
          throw new Error("Extension status API unavailable");
        }
        return bridge.app.extensions();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Extension status check timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function getEmbedStatus(
  extensions: ExtensionInfo[],
  handle: string,
): EmbedStatus {
  const blocks = extensions
    .filter((extension) => extension.type === "theme_app_extension")
    .flatMap((extension) => extension.activations)
    .filter(
      (block) =>
        block.handle === handle &&
        ["body", "head", "compliance_head"].includes(block.target),
    );
  if (blocks.some((block) => block.status === "active")) return "Enabled";
  if (blocks.some((block) => block.status === "available")) return "Disabled";
  if (blocks.some((block) => block.status === "unavailable"))
    return "Unavailable";
  return "Unknown";
}
