import { describe, expect, it } from "vitest";
import { replaceDiagramTrigger, shouldOpenDiagram } from "../src/editor/diagramTrigger";

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

  it("replaces the exact fence in the post-Enter document", () => {
    const markdown = "# Capture\n\n```diagram\nfollowing text";
    const from = markdown.indexOf("```diagram");
    const to = from + "```diagram".length;

    expect(replaceDiagramTrigger({ markdown, from, to }, "rendered block")).toBe(
      "# Capture\n\nrendered block\nfollowing text",
    );
  });

  it("refuses stale or non-diagram ranges without changing text", () => {
    const markdown = "```diagram\n";
    expect(replaceDiagramTrigger({ markdown, from: 0, to: 3 }, "rendered block")).toBeNull();
    expect(replaceDiagramTrigger({ markdown: "older state", from: 0, to: 10 }, "rendered block")).toBeNull();
  });
});
