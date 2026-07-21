import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, native, type CaptureSession, type RuntimeStatus } from "./bridge/native";
import { hasAttachmentReferences, imageMarkdown, titleFromMarkdown } from "./capture/markdown";
import { clearDraft, draftRecoveryMessage, loadDraft, saveDraft } from "./capture/draft";
import { pasteOutcomeMessage } from "./capture/paste";
import type { CaptureStatus } from "./capture/types";
import { createDiagramBlock, DiagramCanvas, parseDiagramBlock, type DiagramBlock, type DiagramFlushHandle, type DiagramStorage, renderDiagramMarkdown } from "./diagram";
import { MarkdownEditor } from "./editor/MarkdownEditor";
import { replaceDiagramTrigger, type DiagramTriggerRequest } from "./editor/diagramTrigger";
import "./App.css";

const WSL_NOTE = "> WSL: when a Windows path such as `C:\\…` is shown, access it from WSL as `/mnt/c/…`.";
const emptyCapture = (showWslNote: boolean) => `${showWslNote ? `${WSL_NOTE}\n\n` : ""}# Untitled capture\n\n`;
const HOTKEY_CHOICES = ["Ctrl+Alt+X", "Ctrl+Alt+Shift+X"] as const;

function isSemanticallyEmptyCapture(markdown: string): boolean {
  return markdown.replace(`${WSL_NOTE}\n\n`, "").trim() === "# Untitled capture";
}

function App() {
  const [restoredDraft] = useState(() => loadDraft());
  const [showWslNote, setShowWslNote] = useState(() => restoredDraft?.showWslNote ?? navigator.userAgent.includes("Windows"));
  const [markdown, setMarkdown] = useState(() => restoredDraft?.markdown ?? emptyCapture(navigator.userAgent.includes("Windows")));
  const [destination, setDestination] = useState("");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeResolved, setRuntimeResolved] = useState(false);
  const [hotkey, setHotkey] = useState<string>("Ctrl+Alt+X");
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [status, setStatus] = useState<CaptureStatus>("ready");
  const [message, setMessage] = useState("Ready for a fast capture.");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [activeDiagram, setActiveDiagram] = useState<DiagramBlock | null>(null);
  const [diagramReady, setDiagramReady] = useState(false);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [pendingCopyPath, setPendingCopyPath] = useState<string | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = useMemo(() => titleFromMarkdown(markdown), [markdown]);
  const latestMarkdown = useRef(markdown);
  const sessionRef = useRef<CaptureSession | null>(session);
  const diagramFlush = useRef<DiagramFlushHandle | null>(null);
  const saveRef = useRef<(archive: boolean) => Promise<void>>(async () => undefined);
  const saveInFlight = useRef(false);
  const sessionStartRef = useRef<Promise<CaptureSession> | null>(null);
  const operationInFlight = useRef(false);
  const previewUrlsRef = useRef<Record<string, string>>(imagePreviewUrls);
  latestMarkdown.current = markdown;
  sessionRef.current = session;
  previewUrlsRef.current = imagePreviewUrls;

  useEffect(() => {
    if (!isTauriRuntime()) {
      setMessage("Browser preview — local asset writing needs the desktop app.");
      setRuntimeResolved(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await native.runtimeStatus();
        if (cancelled) return;
        setRuntime(next);
        setHotkey(HOTKEY_CHOICES.includes(next.hotkey as (typeof HOTKEY_CHOICES)[number]) ? next.hotkey : HOTKEY_CHOICES[0]);
        setDestination(next.outputRoot ?? "");
        setSettingsOpen(!next.outputRoot || next.hotkeyConflict);
        if (next.pendingCopyPath) {
          setPendingCopyPath(next.pendingCopyPath);
          setStatus("saved");
          setMessage(`A previous capture was saved at ${next.pendingCopyPath}, but was not copied.`);
        }
        if (next.hotkeyConflict) setMessage(`Global hotkey ${next.hotkey} is unavailable; open Capture from the app.`);
      } catch (cause) {
        if (!cancelled) {
          setError(`Could not restore desktop status; capture actions remain blocked to protect any pending saved item. ${String(cause)}`);
        }
        return;
      }

      if (restoredDraft) {
        if (!cancelled) setMessage(draftRecoveryMessage(restoredDraft.timestamp));
        if (restoredDraft.sessionId) {
          const resume = native.resumeCapture(restoredDraft.sessionId);
          sessionStartRef.current = resume;
          try {
            const resumed = await resume;
            if (!cancelled) {
              sessionRef.current = resumed;
              setSession(resumed);
              setMessage(`${draftRecoveryMessage(restoredDraft.timestamp)} Reconnected to its staged attachments.`);
            }
          } catch {
            if (!cancelled) {
              if (hasAttachmentReferences(restoredDraft.markdown)) {
                setRecoveryBlocked(true);
                setError("Recovered Markdown references staged attachments that could not be resumed. Remove or repair those references before saving.");
                setMessage("Recovered draft needs attachment recovery before it can be saved.");
              } else {
                setMessage(`${draftRecoveryMessage(restoredDraft.timestamp)} Staged attachments could not be resumed; new ones will be added normally.`);
              }
            }
          } finally {
            if (sessionStartRef.current === resume) sessionStartRef.current = null;
          }
        }
      }
      if (!cancelled) setRuntimeResolved(true);
    })();
    return () => { cancelled = true; };
  // Startup is intentionally a one-time state-recovery transaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recoveryBlocked && !hasAttachmentReferences(markdown)) {
      setRecoveryBlocked(false);
      setError(null);
      setMessage("Attachment references removed; this recovered draft can now be saved.");
    }
  }, [markdown, recoveryBlocked]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isSemanticallyEmptyCapture(markdown) && !session?.sessionId) {
        clearDraft();
        return;
      }
      saveDraft({ markdown, showWslNote, sessionId: session?.sessionId, timestamp: Date.now() });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [markdown, showWslNote, session?.sessionId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen("capture://finalize-request", () => {
      if (isSemanticallyEmptyCapture(latestMarkdown.current)) void hideDraft();
      else void saveRef.current(false);
    })
      .then((dispose) => { unlisten = dispose; })
      .catch((cause: unknown) => setError(`Could not listen for close requests: ${String(cause)}`));
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeDiagram) void closeDiagram();
        else if (error) setError(null);
        else if (settingsOpen) setSettingsOpen(false);
        else void hideDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function getSession(): Promise<CaptureSession> {
    if (sessionRef.current) return sessionRef.current;
    if (!isTauriRuntime()) throw new Error("Image capture requires the desktop app.");
    if (sessionStartRef.current) return sessionStartRef.current;
    const started = native.beginCapture()
      .then((created) => {
        sessionRef.current = created;
        setSession(created);
        return created;
      })
      .finally(() => { sessionStartRef.current = null; });
    sessionStartRef.current = started;
    return started;
  }

  function beginCaptureOperation(): boolean {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    return true;
  }

  function endCaptureOperation() {
    operationInFlight.current = false;
  }

  async function applySettings() {
    if (!destination.trim()) {
      setError("Choose a Windows output folder before capturing.");
      return;
    }
    setBusy(true);
    try {
      await native.configureRoot(destination.trim());
      setSettingsOpen(false);
      setMessage(`Destination set: ${destination.trim()}`);
      setError(null);
    } catch (cause) {
      setError(`Could not configure destination: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyHotkey() {
    setBusy(true);
    try {
      const next = await native.configureHotkey(hotkey);
      setRuntime(next);
      setMessage(`Hotkey set to ${next.hotkey}.`);
      setError(null);
    } catch (cause) {
      setError(`Could not set hotkey: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleWslNote(enabled: boolean) {
    setShowWslNote(enabled);
    setMarkdown((current) => {
      const withoutNote = current.replace(`${WSL_NOTE}\n\n`, "");
      return enabled ? `${WSL_NOTE}\n\n${withoutNote}` : withoutNote;
    });
  }

  async function pasteImages(images: Blob[]): Promise<string> {
    if (!runtimeResolved) throw new Error("Capture is still restoring its previous state. Try again in a moment.");
    if (!beginCaptureOperation()) throw new Error("Another capture action is still running. Try again in a moment.");
    setBusy(true);
    setStatus("saving");
    let failure: unknown = null;
    try {
      const activeSession = await getSession();
      const references: string[] = [];
      for (const image of images) {
        try {
          const staged = await native.stageImage(activeSession.sessionId, new Uint8Array(await image.arrayBuffer()));
          const path = staged.relativePath;
          const previewUrl = URL.createObjectURL(new Blob([Uint8Array.from(staged.previewBytes)], { type: "image/png" }));
          setImagePreviewUrls((current) => {
            if (current[path]) URL.revokeObjectURL(current[path]);
            return { ...current, [path]: previewUrl };
          });
          references.push(imageMarkdown(path));
        } catch (cause) {
          failure = cause;
          break;
        }
      }
      if (!references.length && failure) throw failure;
      setStatus("saved");
      if (failure) {
        setMessage(pasteOutcomeMessage(references.length, images.length, true));
        setError(`Some pasted images were not saved: ${String(failure)}`);
      } else {
        setMessage(pasteOutcomeMessage(references.length, images.length, false));
        setError(null);
      }
      return `${references.join("\n")}\n`;
    } catch (cause) {
      setStatus("error");
      setError(`Image paste was not saved: ${String(cause)}`);
      throw cause;
    } finally {
      setBusy(false);
      endCaptureOperation();
    }
  }

  function activateDiagram(request: DiagramTriggerRequest) {
    const id = `dia_${crypto.randomUUID().replace(/-/g, "")}`;
    const block = createDiagramBlock(id);
    const next = replaceDiagramTrigger(request, renderDiagramMarkdown(block));
    if (next === null) {
      setError("The diagram shortcut could not replace its Markdown fence. Your text was left unchanged.");
      return;
    }
    latestMarkdown.current = next;
    setMarkdown(next);
    setActiveDiagram(block);
    setDiagramReady(false);
    setMessage("Diagram block activated. The canvas is part of this capture bundle.");
  }

  const diagramStorage = useMemo<DiagramStorage>(() => ({
    loadScene: async (source) => {
      const active = await getSession();
      try {
        const sceneJson = await native.loadStagedDiagram(active.sessionId, source.replace(/^\.\//, ""));
        return JSON.parse(sceneJson) as { elements: unknown[]; appState: Record<string, unknown>; files?: Record<string, unknown> };
      } catch {
        return null;
      }
    },
    saveDraft: async (artifact) => {
      const active = await getSession();
      await native.stageDiagram(active.sessionId, artifact.block.id, artifact.sceneJson, artifact.svg);
    },
  // Session access is ref-backed so the storage identity stays stable while the canvas is mounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  function rememberDiagramPreview(block: DiagramBlock, svg: string) {
    const previewUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setImagePreviewUrls((current) => {
      if (current[block.preview]) URL.revokeObjectURL(current[block.preview]);
      return { ...current, [block.preview]: previewUrl };
    });
  }

  function reopenDiagram(previewPath: string) {
    const fencePattern = /```diagram\r?\n([\s\S]*?)\r?\n```\r?\n!\[[^\]\r\n]*\]\(([^)]+)\)/g;
    for (const match of latestMarkdown.current.matchAll(fencePattern)) {
      if (match[2] !== previewPath) continue;
      try {
        setActiveDiagram(parseDiagramBlock(match[1]));
        setDiagramReady(false);
        setMessage("Diagram reopened for editing.");
      } catch (cause) {
        setError(`Could not reopen diagram: ${String(cause)}`);
      }
      return;
    }
    setError(`No DiagramBlock v1 directive references ${previewPath}.`);
  }

  async function closeDiagram() {
    if (!beginCaptureOperation()) {
      setMessage("Another capture action is still running.");
      return;
    }
    if (!diagramFlush.current) {
      setError("Diagram editor is still loading. Wait for it to become ready before leaving.");
      endCaptureOperation();
      return;
    }
    setBusy(true);
    try {
      const artifact = await diagramFlush.current.flush();
      rememberDiagramPreview(artifact.block, artifact.svg);
      setActiveDiagram(null);
      setDiagramReady(false);
      setMessage("Diagram draft saved. Back to Markdown.");
    } catch (cause) {
      setError(`Diagram draft was not saved: ${String(cause)}`);
    } finally {
      setBusy(false);
      endCaptureOperation();
    }
  }

  async function hideDraft() {
    if (isTauriRuntime()) {
      await getCurrentWindow().hide().catch((cause: unknown) => setError(`Could not hide capture: ${String(cause)}`));
    }
  }

  function resetAfterCommit() {
    sessionRef.current = null;
    setSession(null);
    setActiveDiagram(null);
    diagramFlush.current = null;
    setDiagramReady(false);
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    setImagePreviewUrls({});
    const fresh = emptyCapture(showWslNote);
    latestMarkdown.current = fresh;
    setMarkdown(fresh);
    setPendingCopyPath(null);
    clearDraft();
  }

  async function retryCopy() {
    if (!pendingCopyPath || busy || !beginCaptureOperation()) return;
    setBusy(true);
    try {
      const result = await native.retryCopy(pendingCopyPath);
      if (!result.clipboardCopied) {
        setMessage(`Capture is saved at ${result.copiedPath}, but clipboard copy is still unavailable.`);
        return;
      }
      setStatus("copied");
      setMessage(`Capture copied: ${result.copiedPath}`);
      setError(null);
      resetAfterCommit();
      await hideDraft();
    } catch (cause) {
      setError(`Retry copy failed. Your saved capture remains at ${pendingCopyPath}. ${String(cause)}`);
    } finally {
      setBusy(false);
      endCaptureOperation();
    }
  }

  async function save(archive: boolean) {
    if (!runtimeResolved) {
      setMessage("Capture is still restoring its previous state. Try again in a moment.");
      return;
    }
    if (busy || saveInFlight.current || !beginCaptureOperation()) return;
    if (pendingCopyPath) {
      setMessage("This capture is already saved; use Retry copy instead of saving it again.");
      endCaptureOperation();
      return;
    }
    if (isSemanticallyEmptyCapture(markdown)) {
      setStatus("ready");
      setMessage("Nothing to save yet. Add a thought, image, or diagram first.");
      endCaptureOperation();
      return;
    }
    if (recoveryBlocked) {
      setError("This recovered draft still references attachments that could not be resumed. Repair or remove them before saving.");
      endCaptureOperation();
      return;
    }
    saveInFlight.current = true;
    setBusy(true);
    setStatus("saving");
    try {
      const activeSession = await getSession();
      if (activeDiagram) {
        if (!diagramFlush.current) throw new Error("Diagram editor is still loading; save was blocked.");
        const artifact = await diagramFlush.current.flush();
        rememberDiagramPreview(artifact.block, artifact.svg);
      }
      const result = await native.finalizeCapture(activeSession.sessionId, markdown, title, archive);
      setError(null);
      if (!result.clipboardCopied) {
        setStatus("saved");
        setPendingCopyPath(result.copiedPath);
        setMessage(`${archive ? "ZIP" : "Capture"} committed at ${result.copiedPath}; clipboard copy failed.`);
        return;
      }
      setStatus(archive ? "zipped" : "copied");
      setMessage(`${archive ? "ZIP" : "Capture"} saved and copied: ${result.copiedPath}`);
      resetAfterCommit();
      await hideDraft();
    } catch (cause) {
      setStatus("error");
      setError(`Save failed. Your text is still in the editor. ${String(cause)}`);
    } finally {
      setBusy(false);
      saveInFlight.current = false;
      endCaptureOperation();
    }
  }

  saveRef.current = save;

  return (
    <main className="capture-shell">
      <header className="capture-header">
        <div>
          <p className="eyebrow">EXPRESSIVE CAPTURE</p>
          <h1>{title}</h1>
        </div>
        <div className="header-actions">
          <span className={`status-pill status-${status}`} aria-live="polite">{busy ? "Working…" : status}</span>
          <button className="quiet-button" onClick={() => setSettingsOpen(true)}>Settings</button>
          <button className="primary-button" disabled={busy || (!!activeDiagram && !diagramReady)} onClick={() => void save(false)}>Save <kbd>Ctrl+Enter</kbd></button>
          <button className="archive-button" disabled={busy || (!!activeDiagram && !diagramReady)} onClick={() => void save(true)}>ZIP</button>
        </div>
      </header>

      <section className="destination-bar" aria-label="Capture destination">
        <span>Destination</span>
        <code>{destination || "Choose an output folder"}</code>
        {runtime?.hotkeyConflict && <span className="warning">Hotkey conflict</span>}
      </section>

      {error && <section className="error-card" role="alert"><strong>Needs attention</strong><p>{error}</p><button onClick={() => setError(null)}>Dismiss <kbd>Esc</kbd></button></section>}
      {pendingCopyPath && <section className="error-card retry-card" role="status"><strong>Saved, not copied</strong><p>Committed at <code>{pendingCopyPath}</code>. Copy it without saving again.</p><button className="primary-button" disabled={busy} onClick={() => void retryCopy()}>Retry copy</button></section>}
      <p className="capture-message" aria-live="polite">{message}</p>

      {activeDiagram ? <section className="diagram-workspace" aria-label="Embedded diagram editor">
        <div className="diagram-toolbar"><span>Editing {activeDiagram.alt}</span><button className="quiet-button" disabled={busy} onClick={() => void closeDiagram()}>Back to Markdown <kbd>Esc</kbd></button></div>
        <DiagramCanvas block={activeDiagram} storage={diagramStorage} onFlushHandle={(handle) => { diagramFlush.current = handle; setDiagramReady(handle !== null); }} onError={(cause) => setError(`Diagram error: ${cause.message}`)} />
      </section> : <MarkdownEditor value={markdown} imagePreviewUrls={imagePreviewUrls} onChange={(next) => { latestMarkdown.current = next; setMarkdown(next); }} onPasteImages={pasteImages} onDiagramDirective={activateDiagram} onEditDiagram={reopenDiagram} onSave={() => void save(false)} onEscape={() => { if (error) setError(null); else if (settingsOpen) setSettingsOpen(false); else void hideDraft(); }} />}

      <footer className="capture-footer">
        <span>Paste PNG, JPEG, or WebP directly. Type <code>```diagram</code>, then Enter, to draw.</span>
        <span className="footer-dismiss-hint"><kbd>Esc</kbd> hides</span>
      </footer>

      {settingsOpen && <div className="modal-backdrop" role="presentation"><section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <p className="eyebrow">CAPTURE SETTINGS</p><h2 id="settings-title">Where should captures go?</h2>
        <p>Use a normal Windows path. Capture writes a self-contained Markdown bundle and assets here.</p>
        <label>Output folder<input value={destination} onChange={(event) => setDestination(event.currentTarget.value)} placeholder="C:\\Users\\you\\Documents\\Captures" autoFocus /></label>
        <label className="checkbox-label"><input type="checkbox" checked={showWslNote} onChange={(event) => toggleWslNote(event.currentTarget.checked)} /> Include the WSL path note at the top of captures</label>
        <label>Global hotkey<select value={hotkey} onChange={(event) => setHotkey(event.currentTarget.value)}>{HOTKEY_CHOICES.map((choice) => <option key={choice}>{choice}</option>)}</select></label>
        <button className="quiet-button" disabled={busy} onClick={() => void applyHotkey()}>Apply hotkey</button>
        <small>Enabled by default on Windows. WSL readers translate <code>C:\\…</code> to <code>/mnt/c/…</code>.</small>
        <div className="dialog-actions"><button className="quiet-button" onClick={() => setSettingsOpen(false)}>Cancel <kbd>Esc</kbd></button><button className="primary-button" disabled={busy} onClick={() => void applySettings()}>Use this folder</button></div>
      </section></div>}
    </main>
  );
}

export default App;
