# Architecture

Expressive Capture separates the durable document contract from its current desktop implementation.

## Layers

- **Tauri 2 / Rust** owns the singleton process, global shortcut, native window, output-root policy,
  staged asset directories, atomic capture commit, ZIP verification, and native clipboard completion.
- **React + CodeMirror 6** owns source-faithful Markdown editing, keyboard flows, visible lifecycle
  state, inline previews, and ordered paste transactions.
- **Excalidraw** is loaded only when a diagram is activated. Its undo history remains separate from
  CodeMirror. Each diagram persists editable JSON plus an SVG fallback.

The Settings command may choose an absolute output root. After that, asset and finalization commands
use an active capture session and generated attachment IDs rather than caller-selected filenames.
Finalization is one-way: after a verified folder is committed, clipboard failure becomes
`SavedButNotCopied`; retrying clipboard in the same process does not create a second capture.

## Lifecycle

1. The resident process registers the saved shortcut. The bounded choices are `Ctrl+Alt+X` and
   `Ctrl+Alt+Shift+X`; startup tries the alternatives if registration conflicts.
2. The hotkey shows and focuses the singleton window.
3. Images and diagram exports are staged under `.expressive-capture-staging/` in the configured root.
   Markdown and the session identifier are debounced into WebView local storage, allowing startup to
   restore the text and reconnect a valid staged directory.
4. Save synchronously flushes the editor and active canvas.
5. Rust constructs a temporary capture directory under the output root, flushes it, and atomically
   renames the directory into place.
6. Normal save copies the Markdown path. Archive save creates and verifies a ZIP beside the capture,
   then copies the ZIP path.

## Compatibility boundary

The `contracts/` files are public APIs. UI state, framework components, and private draft journals
may evolve without changing already-written capture folders. Contract migrations must be versioned
and fixtures must continue to open without the app.

## Current durability boundaries

- The selected root and one of the two supported hotkeys are stored in a small preferences file. The
  default root is used if no valid saved root is available.
- Escape hides a draft. Debounced WebView local storage restores Markdown after restart and the native
  `resume_capture` command reconnects a valid UUID-named staging directory beneath the configured root.
  Recovery does not reconstruct missing attachments or restore their preview URLs. The frontend blocks a
  recovered draft with broken generated references, and native finalization independently validates every
  contract attachment reference.
- A committed-but-not-copied path is persisted before clipboard access, restored after restart, and is the
  only path accepted by the retry command.
- Changing the root is rejected while a capture session is active.
- The native close button emits a finalization request; the frontend performs **Save + copy** and hides
  only after a successful commit and clipboard copy. Empty captures remain unsaved.
