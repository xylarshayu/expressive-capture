import { describe, expect, it } from "vitest";
import { shouldOpenDiagram } from "../src/editor/diagramTrigger";

describe("diagram activation context", () => {
  it("opens only a typed opening diagram fence followed by Enter", () => {
    expect(shouldOpenDiagram("```diagram\n", 1, "typed", true)).toBe(true);
  });

  it("does not activate a diagram-looking line inside an existing fence", () => {
    const markdown = "```text\n```diagram\n";
    expect(shouldOpenDiagram(markdown, 2, "typed", true)).toBe(false);
  });

  it("does not activate pasted Markdown", () => {
    expect(shouldOpenDiagram("```diagram\n", 1, "paste", true)).toBe(false);
  });
});
