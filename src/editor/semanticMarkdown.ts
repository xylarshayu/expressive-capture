import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type SemanticLineRange = {
  from: number;
  className: string;
};

const headingClasses: Record<string, string> = {
  ATXHeading1: "cm-heading-line cm-heading-1",
  ATXHeading2: "cm-heading-line cm-heading-2",
  ATXHeading3: "cm-heading-line cm-heading-3",
  ATXHeading4: "cm-heading-line cm-heading-4",
  ATXHeading5: "cm-heading-line cm-heading-5",
  ATXHeading6: "cm-heading-line cm-heading-6",
  SetextHeading1: "cm-heading-line cm-heading-1",
  SetextHeading2: "cm-heading-line cm-heading-2",
};

function addClass(classes: Map<number, Set<string>>, from: number, className: string) {
  let lineClasses = classes.get(from);
  if (!lineClasses) classes.set(from, lineClasses = new Set());
  for (const name of className.split(" ")) lineClasses.add(name);
}

function addClassToLines(
  state: EditorState,
  classes: Map<number, Set<string>>,
  from: number,
  to: number,
  className: string,
) {
  let line = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  while (line.number <= lastLine.number) {
    addClass(classes, line.from, className);
    if (line.number === lastLine.number) break;
    line = state.doc.line(line.number + 1);
  }
}

/**
 * Derive whole-line presentation from the Markdown syntax tree. Keeping this pure
 * makes semantic styling testable without constructing an EditorView or DOM.
 */
export function collectSemanticLineRanges(
  state: EditorState,
  tree = syntaxTree(state),
): SemanticLineRange[] {
  const classes = new Map<number, Set<string>>();

  tree.iterate({
    enter(node) {
      const headingClass = headingClasses[node.name];
      if (headingClass) {
        addClassToLines(state, classes, node.from, node.to, headingClass);
        return;
      }

      if (node.name === "Blockquote") {
        addClassToLines(state, classes, node.from, node.to, "cm-blockquote-line");
        return;
      }

      if (node.name === "FencedCode") {
        addClassToLines(state, classes, node.from, node.to, "cm-fenced-code-line");
        addClass(classes, state.doc.lineAt(node.from).from, "cm-fenced-code-start");
        addClass(classes, state.doc.lineAt(node.to).from, "cm-fenced-code-end");
      }
    },
  });

  return [...classes]
    .sort(([left], [right]) => left - right)
    .map(([from, names]) => ({ from, className: [...names].join(" ") }));
}

function semanticLineDecorations(state: EditorState) {
  const ranges: Range<Decoration>[] = collectSemanticLineRanges(state).map(({ from, className }) =>
    Decoration.line({ class: className }).range(from)
  );
  return Decoration.set(ranges, true);
}

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx", "mjs", "cjs", "javascript"],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "tsx", "mts", "cts", "typescript"],
    support: javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then(({ json }) => json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html", "htm"],
    support: html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    support: css(),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    load: () => import("@codemirror/lang-python").then(({ python }) => python()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql", "postgres", "postgresql", "mysql", "sqlite"],
    load: () => import("@codemirror/lang-sql").then(({ sql }) => sql()),
  }),
];

const paperHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: "var(--editor-punctuation, #898982)" },
  { tag: tags.heading, color: "var(--editor-heading, #eeeae0)", fontWeight: "600" },
  { tag: tags.strong, color: "var(--editor-strong, #ece8df)", fontWeight: "650" },
  { tag: tags.emphasis, color: "var(--editor-emphasis, #ded8cf)", fontStyle: "italic" },
  { tag: tags.quote, color: "var(--editor-quote, #b9b5ac)" },
  { tag: tags.monospace, color: "var(--editor-code, #d8d3c8)", backgroundColor: "rgb(255 255 255 / 5%)" },
  { tag: tags.link, color: "var(--editor-link, #b9c7ca)", textDecoration: "underline", textDecorationColor: "rgb(185 199 202 / 40%)" },
  { tag: tags.url, color: "var(--editor-link-muted, #8f9c9e)" },
  { tag: [tags.keyword, tags.modifier], color: "var(--syntax-keyword, #c8b6cf)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string, #b9c7a5)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-literal, #cfb89f)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment, #85857e)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--syntax-function, #b5c6d1)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type, #c9c2a3)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property, #c5bbb0)" },
  { tag: [tags.tagName, tags.atom], color: "var(--syntax-tag, #c9aaa7)" },
  { tag: tags.invalid, color: "var(--syntax-invalid, #e0a49b)", textDecoration: "underline wavy" },
]);

const paperSemanticTheme = EditorView.theme({
  ".cm-line.cm-heading-line": {
    color: "var(--editor-heading, #eeeae0)",
    fontWeight: "600",
    letterSpacing: "-0.018em",
  },
  ".cm-line.cm-heading-1": { fontSize: "1.36em", lineHeight: "1.5" },
  ".cm-line.cm-heading-2": { fontSize: "1.2em", lineHeight: "1.55" },
  ".cm-line.cm-heading-3": { fontSize: "1.08em", lineHeight: "1.62" },
  ".cm-line.cm-heading-4, .cm-line.cm-heading-5, .cm-line.cm-heading-6": {
    fontSize: "1em",
    fontWeight: "650",
  },
  ".cm-line.cm-blockquote-line": {
    paddingLeft: "0.9em",
    borderLeft: "2px solid var(--editor-quote-rule, #55554f)",
    color: "var(--editor-quote, #b9b5ac)",
    fontStyle: "italic",
  },
  ".cm-line.cm-fenced-code-line": {
    paddingLeft: "0.9em",
    paddingRight: "0.9em",
    color: "var(--editor-code, #d8d3c8)",
    backgroundColor: "var(--editor-code-surface, rgb(255 255 255 / 3.5%))",
    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "0.88em",
    lineHeight: "1.62",
  },
  ".cm-line.cm-fenced-code-start": {
    paddingTop: "0.38em",
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
  },
  ".cm-line.cm-fenced-code-end": {
    paddingBottom: "0.38em",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
  },
});

/** Markdown parsing, semantic line treatment and locally bundled lazy code languages. */
export function semanticMarkdownExtensions(): Extension {
  return [
    markdown({ codeLanguages }),
    syntaxHighlighting(paperHighlightStyle, { fallback: true }),
    EditorView.decorations.compute(["doc"], semanticLineDecorations),
    paperSemanticTheme,
  ];
}
