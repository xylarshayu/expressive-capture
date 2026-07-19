import { describe, expect, it } from "vitest";
import { DRAFT_STORAGE_KEY, draftRecoveryMessage, loadDraft, saveDraft } from "../src/capture/draft";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { length: 0, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: () => null, removeItem: (key) => values.delete(key), setItem: (key, value) => values.set(key, value) };
}

describe("capture draft persistence", () => {
  it("stores Markdown and a resumable session id, never image bytes", () => {
    const storage = memoryStorage();
    saveDraft({ markdown: "# captured", showWslNote: true, sessionId: "session-1", timestamp: 100 }, storage);
    expect(loadDraft(storage)).toEqual({ markdown: "# captured", showWslNote: true, sessionId: "session-1", timestamp: 100 });
    expect(storage.getItem(DRAFT_STORAGE_KEY)).not.toContain("previewBytes");
  });

  it("calls out stale recovered drafts", () => {
    expect(draftRecoveryMessage(0, 2 * 24 * 60 * 60 * 1000)).toContain("2 day");
  });
});
