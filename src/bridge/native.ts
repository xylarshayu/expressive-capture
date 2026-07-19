import { invoke } from "@tauri-apps/api/core";
export type RuntimeStatus = {
  hotkey: string;
  hotkeyRegistered: boolean;
  hotkeyConflict: boolean;
  outputRoot?: string;
  pendingCopyPath?: string;
};

export type CaptureSession = { sessionId: string; stagingPath: string };
export type StagedImage = { relativePath: string; assetUrl: null; previewBytes: number[] };
export type FinalizedCapture = {
  documentPath: string;
  bundlePath: string;
  archivePath?: string;
  copiedPath: string;
  clipboardCopied: boolean;
};

export type StagedDiagram = { sourceRelativePath: string; previewRelativePath: string };

type NativeResult<T> = Promise<T>;

async function command<T>(name: string, payload?: Record<string, unknown>): NativeResult<T> {
  return invoke<T>(name, payload);
}

export const native = {
  runtimeStatus: () => command<RuntimeStatus>("get_runtime_status"),
  configureHotkey: (hotkey: string) => command<RuntimeStatus>("configure_hotkey", { hotkey }),
  configureRoot: (root: string) => command<void>("configure_capture_root", { root }),
  beginCapture: () => command<CaptureSession>("begin_capture"),
  resumeCapture: (sessionId: string) => command<CaptureSession>("resume_capture", { sessionId }),
  stageImage: (sessionId: string, bytes: Uint8Array) => command<StagedImage>("stage_image", { sessionId, bytes }),
  loadStagedDiagram: (sessionId: string, sourceRelativePath: string) =>
    command<string>("load_staged_diagram", { sessionId, sourceRelativePath }),
  stageDiagram: (sessionId: string, id: string, sceneJson: string, svg: string) =>
    command<StagedDiagram>("stage_diagram", { sessionId, id, sceneJson, svg }),
  finalizeCapture: (sessionId: string, markdown: string, title: string, archive: boolean) =>
    command<FinalizedCapture>("finalize_capture", { sessionId, markdown, title, archive }),
  retryCopy: (path: string) => command<{ copiedPath: string; clipboardCopied: boolean }>("retry_copy", { path }),
};

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
