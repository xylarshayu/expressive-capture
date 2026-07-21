import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { collectSemanticLineRanges } from "../src/editor/semanticMarkdown";

function semanticLines(source: string) {
  const state = EditorState.create({ doc: source, extensions: [markdown()] });
  return collectSemanticLineRanges(state).map(({ from, className }) => ({
    line: state.doc.lineAt(from).number,
    classes: new Set(className.split(" ")),
  }));
}

describe("semantic Markdown line ranges", () => {
  it("assigns a modest hierarchy to ATX and setext headings", () => {
    const lines = semanticLines("# One\n\n## Two\n\nThree\n-----\n");

    expect(lines).toEqual([
      { line: 1, classes: new Set(["cm-heading-line", "cm-heading-1"]) },
      { line: 3, classes: new Set(["cm-heading-line", "cm-heading-2"]) },
      { line: 5, classes: new Set(["cm-heading-line", "cm-heading-2"]) },
      { line: 6, classes: new Set(["cm-heading-line", "cm-heading-2"]) },
    ]);
  });

  it("marks every blockquote line while leaving ordinary lines untouched", () => {
    const lines = semanticLines("> first\n> second\n\nordinary\n");

    expect(lines).toEqual([
      { line: 1, classes: new Set(["cm-blockquote-line"]) },
      { line: 2, classes: new Set(["cm-blockquote-line"]) },
    ]);
  });

  it("marks complete fenced blocks and identifies their cap lines", () => {
    const lines = semanticLines("```ts\nconst answer = 42\nreturn answer\n```\n");

    expect(lines).toEqual([
      { line: 1, classes: new Set(["cm-fenced-code-line", "cm-fenced-code-start"]) },
      { line: 2, classes: new Set(["cm-fenced-code-line"]) },
      { line: 3, classes: new Set(["cm-fenced-code-line"]) },
      { line: 4, classes: new Set(["cm-fenced-code-line", "cm-fenced-code-end"]) },
    ]);
  });

  it("combines semantic classes for fenced code nested inside a quote", () => {
    const lines = semanticLines("> ```js\n> const ok = true\n> ```\n");

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.classes).toContain("cm-blockquote-line");
      expect(line.classes).toContain("cm-fenced-code-line");
    }
  });
});
