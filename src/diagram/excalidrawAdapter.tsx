import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";
import type {
  DiagramArtifact,
  DiagramBlock,
  DiagramFlushHandle,
  DiagramScene,
  DiagramStorage,
} from "./types";

type ExcalidrawModule = {
  Excalidraw: ComponentType<Record<string, unknown>>;
  serializeAsJSON(
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
    type: "local" | "database",
  ): string;
  exportToSvg(data: {
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files?: Record<string, unknown>;
  }): Promise<SVGSVGElement>;
};

interface ExcalidrawApi {
  updateLibrary(items: readonly unknown[]): void;
}

/**
 * Keep the heavyweight canvas out of the initial capture bundle. The package
 * is deliberately imported only when a DiagramCanvas is mounted.
 */
let excalidrawModule: Promise<ExcalidrawModule> | undefined;
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  excalidrawModule ??= import("@excalidraw/excalidraw") as Promise<ExcalidrawModule>;
  return excalidrawModule;
}

export const MVP_EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: true,
    clearCanvas: true,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: true,
  },
  tools: {
    // Diagram v1 has no file-manifest contract, so images are forbidden.
    image: false,
  },
} as const;

export interface DiagramCanvasProps {
  readonly block: DiagramBlock;
  readonly storage: DiagramStorage;
  /** The owner retains this handle and awaits it before any document submit. */
  readonly onFlushHandle: (handle: DiagramFlushHandle | null) => void;
  readonly onError?: (error: Error) => void;
  readonly children?: ReactNode;
}

/**
 * Lazily mounted Excalidraw surface. Host-owned Save/Cancel controls should
 * live around it; Excalidraw's own file/export actions are disabled.
 */
export function DiagramCanvas({
  block,
  storage,
  onFlushHandle,
  onError,
  children,
}: DiagramCanvasProps) {
  const [module, setModule] = useState<ExcalidrawModule | null>(null);
  const [initialData, setInitialData] = useState<DiagramScene | null>(null);
  const sceneRef = useRef<DiagramScene>({ elements: [], appState: {} });
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadExcalidraw(), storage.loadScene(block.source)])
      .then(([loadedModule, loadedScene]) => {
        if (cancelled) return;
        sceneRef.current = loadedScene ?? { elements: [], appState: {} };
        setInitialData(sceneRef.current);
        setModule(loadedModule);
      })
      .catch((reason: unknown) => {
        if (!cancelled) onErrorRef.current?.(toError(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [block.source, storage]);

  useEffect(() => {
    const handle: DiagramFlushHandle = {
      flush: async () => {
        const loadedModule = await loadExcalidraw();
        const scene = sceneRef.current;
        assertNoDiagramFiles(scene.files);
        const svg = await loadedModule.exportToSvg({
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
        });
        const artifact: DiagramArtifact = {
          block,
          sceneJson: loadedModule.serializeAsJSON(
            scene.elements,
            scene.appState,
            scene.files ?? {},
            "local",
          ),
          svg: svg.outerHTML,
        };
        await storage.saveDraft(artifact);
        return artifact;
      },
    };
    onFlushHandle(handle);
    return () => onFlushHandle(null);
  }, [block, onFlushHandle, storage]);

  if (!module || !initialData) {
    return <div aria-busy="true">Loading diagram editor…</div>;
  }

  const Excalidraw = module.Excalidraw;
  return (
    <Excalidraw
      initialData={initialData}
      autoFocus
      handleKeyboardGlobally={false}
      UIOptions={MVP_EXCALIDRAW_UI_OPTIONS}
      validateEmbeddable={false}
      excalidrawAPI={(api: ExcalidrawApi) => {
        apiRef.current = api;
      }}
      onPaste={() => false}
      onChange={(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
        // Reject files even if an upstream Excalidraw version exposes another path.
        sceneRef.current = { elements, appState, files };
      }}
      onLibraryChange={(items: readonly unknown[]) => {
        // Do not pass a Library child or libraryReturnUrl. If an upstream UI
        // exposes a library action anyway, immediately clear it rather than
        // allowing an unversioned library to become part of this document.
        if (items.length > 0) {
          apiRef.current?.updateLibrary([]);
          onErrorRef.current?.(new Error("Excalidraw libraries are disabled in MVP."));
        }
      }}
    >
      {children}
    </Excalidraw>
  );
}

function assertNoDiagramFiles(files: Record<string, unknown> | undefined): void {
  if (files && Object.keys(files).length > 0) {
    throw new Error("Diagram v1 does not support embedded files or images.");
  }
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
