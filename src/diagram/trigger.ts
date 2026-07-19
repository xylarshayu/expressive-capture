/**
 * CodeMirror calls this after an editor transaction. Paste and programmatic
 * edits are intentionally never activation events: only a human typing the
 * exact opening fence and pressing Enter can summon the canvas.
 */
export type DiagramTriggerOrigin = "typed" | "paste" | "programmatic";

export interface DiagramTriggerAttempt {
  readonly origin: DiagramTriggerOrigin;
  readonly lineText: string;
  readonly enterPressed: boolean;
  /** True only when the Markdown parser sees this as an opening fence. */
  readonly isOpeningFence: boolean;
}

export function shouldActivateDiagramTrigger(attempt: DiagramTriggerAttempt): boolean {
  return (
    attempt.origin === "typed" &&
    attempt.enterPressed &&
    attempt.isOpeningFence &&
    attempt.lineText === "```diagram"
  );
}

