import { history, historyKeymap, indentWithTab, defaultKeymap, insertNewlineAndIndent } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { imageReferences, windowsPathToFileUrl } from "../capture/markdown";
import { shouldOpenDiagram, type DiagramTriggerRequest } from "./diagramTrigger";
import { isImageClipboardType, mapPasteRange, type TextRange } from "./imagePaste";
import { semanticMarkdownExtensions } from "./semanticMarkdown";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  /** Return Markdown after native staging; it is inserted at the original caret/selection. */
  onPasteImages: (images: Blob[]) => Promise<string | void>;
  onDiagramDirective: (request: DiagramTriggerRequest) => void;
  /** Optional host hook for already-rendered diagram SVG previews. */
  onEditDiagram?: (previewPath: string) => void;
  imagePreviewUrls: Record<string, string>;
  onSave: () => void;
  onEscape: () => void;
};

class ImagePreview extends WidgetType {
  constructor(private readonly alt: string, private readonly path: string, private readonly src: string, private readonly onEditDiagram?: (path: string) => void) { super(); }
  eq(other: ImagePreview) { return other.alt === this.alt && other.path === this.path && other.src === this.src; }
  toDOM() {
    const figure = document.createElement("figure");
    figure.className = "cm-image-preview";
    const image = document.createElement("img");
    image.src = windowsPathToFileUrl(this.src);
    image.alt = this.alt;
    image.loading = "lazy";
    image.onerror = () => figure.classList.add("is-missing");
    figure.append(image);
    const caption = document.createElement("figcaption");
    caption.textContent = this.alt;
    figure.append(caption);
    if (this.onEditDiagram && /\.svg$/i.test(this.path)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "cm-edit-diagram";
      edit.textContent = "Edit diagram";
      edit.setAttribute("aria-label", `Edit diagram: ${this.alt}`);
      edit.addEventListener("click", () => this.onEditDiagram?.(this.path));
      figure.append(edit);
    }
    return figure;
  }
  ignoreEvent() { return true; }
}

const refreshPreviews = StateEffect.define<number>();
const previewRevision = StateField.define<number>({
  create: () => 0,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(refreshPreviews)) return effect.value;
    return value;
  },
});

function previewExtension(previewUrls: () => Record<string, string>, onEditDiagram: () => ((path: string) => void) | undefined) {
  return [previewRevision, EditorView.decorations.compute([previewRevision, "doc"], (state) => {
    const decorations: Range<Decoration>[] = [];
    const text = state.doc.toString();
    for (const reference of imageReferences(text)) {
      const marker = `![${reference.alt}](${reference.path})`;
      const index = text.indexOf(marker);
      if (index < 0) continue;
      const line = state.doc.lineAt(index);
      decorations.push(Decoration.widget({ widget: new ImagePreview(reference.alt, reference.path, previewUrls()[reference.path] ?? reference.path, onEditDiagram()), side: 1, block: true }).range(line.to));
    }
    return Decoration.set(decorations, true);
  })];
}

export function MarkdownEditor({ value, onChange, onPasteImages, onDiagramDirective, onEditDiagram, imagePreviewUrls, onSave, onEscape }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onPasteImages, onDiagramDirective, onEditDiagram, onSave, onEscape });
  callbacks.current = { onChange, onPasteImages, onDiagramDirective, onEditDiagram, onSave, onEscape };
  const previews = useRef(imagePreviewUrls);
  previews.current = imagePreviewUrls;
  const externalValue = useRef(value);
  externalValue.current = value;

  useEffect(() => {
    if (!host.current) return;
    const pasteAnchors = new Map<symbol, TextRange>();
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        for (const transaction of update.transactions) {
          if (!transaction.docChanged) continue;
          for (const [token, range] of pasteAnchors) {
            pasteAnchors.set(token, mapPasteRange(range, (position, assoc) => transaction.changes.mapPos(position, assoc)));
          }
        }
      }
      if (!update.docChanged) return;
      const next = update.state.doc.toString();
      callbacks.current.onChange(next);
    });
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), semanticMarkdownExtensions(), previewExtension(() => previews.current, () => callbacks.current.onEditDiagram), updateListener,
          keymap.of([
            { key: "Mod-Enter", run: () => { callbacks.current.onSave(); return true; } },
            { key: "Escape", run: () => { callbacks.current.onEscape(); return true; } },
            { key: "Enter", run: (editorView) => {
              const selection = editorView.state.selection.main;
              const head = selection.head;
              const openingLine = editorView.state.doc.lineAt(head);
              const markdown = editorView.state.doc.toString();
              if (!selection.empty || head !== openingLine.to || !shouldOpenDiagram(markdown, openingLine.number, "typed", true)) return false;

              const from = openingLine.from;
              const to = openingLine.to;
              if (!insertNewlineAndIndent(editorView)) return false;
              callbacks.current.onDiagramDirective({
                markdown: editorView.state.doc.toString(),
                from,
                to,
              });
              return true;
            } },
            indentWithTab, ...defaultKeymap, ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste: (event, editorView) => {
              const images = [...event.clipboardData?.items ?? []]
                .filter((item) => isImageClipboardType(item.type))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (!images.length) return false;
              event.preventDefault();
              const token = Symbol("paste-anchor");
              const selection = editorView.state.selection.main;
              pasteAnchors.set(token, { from: selection.from, to: selection.to });
              void callbacks.current.onPasteImages(images)
                .then((markdown) => {
                  const anchor = pasteAnchors.get(token);
                  pasteAnchors.delete(token);
                  if (!anchor || !markdown) return;
                  const insertionEnd = anchor.from + markdown.length;
                  editorView.dispatch({
                    changes: { from: anchor.from, to: anchor.to, insert: markdown },
                    selection: { anchor: insertionEnd },
                  });
                })
                .catch(() => {
                  // The App owns user-facing native staging errors. Clear only our anchor.
                  pasteAnchors.delete(token);
                });
              return true;
            },
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
  // The view deliberately owns its state after mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: refreshPreviews.of(Date.now()) });
  }, [imagePreviewUrls, onEditDiagram]);

  return <div className="markdown-editor" ref={host} aria-label="Markdown capture editor" />;
}
