/** Download authenticated API responses from inside the embedded Shopify app. */
export async function downloadCsv(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Export failed");

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
