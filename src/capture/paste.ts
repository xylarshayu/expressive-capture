export function pasteOutcomeMessage(successCount: number, requestedCount: number, failed: boolean): string {
  if (failed) return `${successCount} image${successCount === 1 ? "" : "s"} added; a later image was rejected.`;
  return `${requestedCount} image${requestedCount === 1 ? "" : "s"} added to this capture.`;
}
