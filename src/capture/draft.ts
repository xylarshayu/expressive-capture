export const DRAFT_STORAGE_KEY = "expressive-capture.draft.v1";

export type CaptureDraft = {
  markdown: string;
  showWslNote: boolean;
  sessionId?: string;
  timestamp: number;
};

export function loadDraft(storage: Storage = localStorage): CaptureDraft | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DRAFT_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const draft = parsed as Partial<CaptureDraft>;
    if (typeof draft.markdown !== "string" || typeof draft.showWslNote !== "boolean" || typeof draft.timestamp !== "number") return null;
    return { markdown: draft.markdown, showWslNote: draft.showWslNote, sessionId: typeof draft.sessionId === "string" ? draft.sessionId : undefined, timestamp: draft.timestamp };
  } catch {
    return null;
  }
}

export function saveDraft(draft: CaptureDraft, storage: Storage = localStorage): void {
  storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft(storage: Storage = localStorage): void {
  storage.removeItem(DRAFT_STORAGE_KEY);
}

export function draftRecoveryMessage(timestamp: number, now = Date.now()): string {
  const ageMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  return ageMinutes > 60 * 24
    ? `Recovered a draft from ${Math.floor(ageMinutes / (60 * 24))} day(s) ago. Review it before saving.`
    : "Recovered your unsaved draft.";
}
