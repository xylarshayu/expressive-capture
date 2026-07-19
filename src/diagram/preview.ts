import type { DiagramBlock, DiagramPreviewModel } from "./types";

/** Model for a non-active CodeMirror widget; it never loads Excalidraw. */
export function createDiagramPreview(block: DiagramBlock): DiagramPreviewModel {
  return {
    kind: "diagram-preview",
    block,
    image: {
      src: block.preview,
      alt: block.alt,
    },
  };
}

