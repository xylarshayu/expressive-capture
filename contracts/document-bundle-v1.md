# Document bundle v1

Each completed capture is a directory directly beneath the configured capture root:

```text
<capture-root>/
  <unix-seconds>-<slug>-<eight-uuid-hex>/
    <unix-seconds>-<slug>-<eight-uuid-hex>.md
    attachments/
      image-001.png
  <unix-seconds>-<slug>-<eight-uuid-hex>.zip
```

The Markdown file is UTF-8 and uses the same collision-safe timestamp/slug basename as its containing folder. `attachments/` is the only attachment directory: it holds pasted images, `.excalidraw` files, and SVG previews. Images are normalized to PNG while staging and referenced with a relative Markdown link such as `![Pasted image](attachments/image-001.png)`. Relative paths make a bundle portable and avoid WSL-specific links.

On Windows, paths returned to the UI and copied to the clipboard are native Windows paths (for example `C:\Users\name\Captures\1700000000-capture-a1b2c3d4\1700000000-capture-a1b2c3d4.md`). WSL users translate `C:\...` to `/mnt/c/...` when opening the result from WSL. `/mnt/c/...` is never canonical output.

## Native command boundary

1. `configure_capture_root(root)` accepts one absolute directory, creates it when missing, and establishes the only directory the native core may write to.
2. `begin_capture()` creates an opaque staged session below `<root>/.expressive-capture-staging/`.
3. `stage_image(sessionId, bytes)` accepts an encoded static image (GIF rejected; maximum 24 megapixels), decodes and re-encodes it as PNG in `attachments/`, then returns its relative path and normalized `previewBytes` for safe inline rendering. It cannot select a filename or destination.
4. `stage_diagram({ sessionId, id, sceneJson, svg })` requires the DiagramBlock v1 id form `dia_<token>` (letters, digits, `_`, and `-`) and writes exactly `attachments/<id>.excalidraw` and `attachments/<id>.svg`. `load_staged_diagram({ sessionId, sourceRelativePath })` only reads a generated `.excalidraw` path beneath `attachments/`.
5. `finalize_capture({ sessionId, markdown, title, archive })` writes the same-basename Markdown file and atomically publishes the folder. With `archive: true`, it additionally verifies a ZIP generated beside the final folder before publishing and copies the ZIP path; with `archive: false`, no ZIP is generated and it copies the Markdown path.
6. `retry_copy(path)` can retry only the app's persisted committed-but-not-copied path; it never finalizes a capture again. A process restart preserves that pending recovery state. `abort_capture(sessionId)` removes only its staging folder.

All paths are canonicalized and checked to remain under the configured root; symlinks and traversal escapes are rejected. A failed finalize leaves no published folder or ZIP when cleanup succeeds. A capture session is consumed only after successful finalize or explicit abort.

The frontend should call `finalize_capture` as its close/save action and surface its returned `clipboardCopied` state. The native close button is intercepted and emits `capture://finalize-request`; the frontend finalizes first and hides only after success. An empty close request may hide without creating a document.
