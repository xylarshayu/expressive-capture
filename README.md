# Expressive Capture

Expressive Capture is a keyboard-first desktop scratchpad for composing portable Markdown prompts
with pasted images and editable Excalidraw diagrams. Press a global shortcut, write in a focused
window, then save and copy either the Markdown path or a ZIP path for another tool or person.

## Product contract

- Default Windows shortcut: `Ctrl+Alt+X`, with visible conflict reporting.
- Markdown is the canonical, human-readable document.
- Every capture is one movable directory containing the Markdown file at its root and an
  `attachments/` directory.
- Clipboard raster images are normalized to PNG and linked with relative forward-slash paths.
- Diagram blocks retain editable `.excalidraw` JSON and an ordinary SVG preview.
- **Save + copy** copies the native Markdown path. **ZIP + copy** archives the complete folder and
  copies the native ZIP path.
- Windows output may include an optional note explaining how `C:\...` maps to `/mnt/c/...` in WSL;
  Windows paths remain canonical.
- The MVP is offline-only and has no telemetry.

See [the document contract](contracts/document-bundle-v1.md),
[diagram contract](contracts/diagram-block-v1.md), and [architecture](docs/architecture.md).

## Development

Prerequisites: Node.js, npm, Rust, and the platform-specific
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run dev
npm run build
npm run test
npm run tauri dev
```

The web UI and pure contracts can be developed from WSL. Running the actual Windows desktop shell,
global shortcut, clipboard-image path, focus behavior, and installer must be tested with the Windows
toolchain rather than inferred from the browser build. Automated Windows CI compiles the full desktop
feature set and runs unit tests; it does not exercise an interactive desktop session.

## Current MVP runtime behavior

- The app opens its singleton capture window on launch. The default `Ctrl+Alt+X` shortcut shows and
  focuses it while the process is running. Settings can switch to `Ctrl+Alt+Shift+X`; startup also tries
  the other bounded choice if the saved shortcut conflicts. There is no arbitrary shortcut recorder,
  tray menu, or launch-at-login support yet.
- The first launch uses `<user profile>/Documents/Expressive Captures` and creates it when needed.
  Settings persist the selected output root and bounded hotkey in the platform configuration directory
  (`%APPDATA%/Expressive Capture/preferences.json` on Windows).
- Escape hides an unfinished draft without saving it, and showing the same resident process restores
  the editor. The native close button requests **Save + copy** instead. Markdown and its staged-session
  identifier are debounced into WebView local storage; after restart, the app restores the text and
  attempts to reconnect attachments in `.expressive-capture-staging/`. If that directory is missing or
  invalid, text recovery still succeeds but the user is warned and saving is blocked while generated
  attachment references remain broken.
- A clipboard failure after commit does not create a second capture. The window keeps the committed path
  and offers **Retry copy**. That pending path is persisted and restored after restart.

## Platform status

The file format is cross-platform. Windows 11 is the first release-blocking desktop target;
macOS/Linux remain experimental until their hotkey, focus, permissions, and packaging paths have
been exercised on real systems. See [platform support](docs/platform-support.md) and the
[real-Windows smoke-test checklist](docs/windows-smoke-test.md).

## Privacy and security

The renderer receives narrow capture commands rather than general filesystem or shell access. The
Settings command accepts a user-entered absolute output root; after selection, generated capture and
attachment paths are confined beneath it. See [threat model](docs/threat-model.md).

## License

[MIT](LICENSE)
