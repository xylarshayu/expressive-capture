import { describe, expect, it } from "vitest";
import { pasteOutcomeMessage } from "../src/capture/paste";

describe("multi-image paste result", () => {
  it("preserves and reports successful links when a later image fails", () => {
    expect(pasteOutcomeMessage(2, 3, true)).toBe("2 images added; a later image was rejected.");
  });
});
