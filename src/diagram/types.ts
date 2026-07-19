/**
 * Public, UI-independent types for a DiagramBlock v1. The Markdown directive
 * is the durable source of truth; this module deliberately contains no Tauri
 * or CodeMirror dependencies.
 */

export const DIAGRAM_BLOCK_VERSION = 1 as const;
export const ATTACHMENTS_DIRECTORY = "./attachments" as const;

export interface DiagramBlock {
  readonly version: typeof DIAGRAM_BLOCK_VERSION;
  readonly id: string;
  readonly source: string;
  readonly preview: string;
  readonly alt: string;
}

export interface DiagramPreviewModel {
  readonly kind: "diagram-preview";
  readonly block: DiagramBlock;
  readonly image: {
    readonly src: string;
    readonly alt: string;
  };
}

/**
 * Excalidraw's public callback deliberately exposes opaque values here. The
 * adapter passes them through unchanged to Excalidraw's serializer/exporter,
 * which avoids coupling the document contract to a package-internal type.
 */
export interface DiagramScene {
  readonly elements: readonly unknown[];
  readonly appState: Record<string, unknown>;
  readonly files?: Record<string, unknown>;
}

export interface DiagramArtifact {
  readonly block: DiagramBlock;
  /** JSON scene source for `<id>.excalidraw`. */
  readonly sceneJson: string;
  /** SVG fallback source for `<id>.svg`. */
  readonly svg: string;
}

/** Native bridge implemented by the persistence worker. */
export interface DiagramStorage {
  loadScene(source: string): Promise<DiagramScene | null>;
  saveDraft(artifact: DiagramArtifact): Promise<void>;
}

/**
 * Registered by an active canvas. The capture submit path must await this
 * method before it begins its bundle transaction.
 */
export interface DiagramFlushHandle {
  flush(): Promise<DiagramArtifact>;
}

