# Real-Windows smoke-test checklist

Run this checklist on a physical or normally logged-in Windows 11 desktop. Automated CI is not an
interactive-session substitute. Record the Windows build, keyboard layout, app commit/build identifier,
installation method, output volume, and pass/fail evidence.

## Launch and summon

- [ ] Install or launch the desktop build and confirm the capture window is visible and focused.
- [ ] Press Escape to hide it, then press `Ctrl+Alt+X`; confirm the existing singleton window returns
      focused with its unfinished text intact.
- [ ] Launch the executable a second time and confirm it focuses the existing process rather than
      opening another capture process.
- [ ] Occupy `Ctrl+Alt+X` with another application before launch. Confirm Expressive Capture still opens
      manually and either selects the bounded `Ctrl+Alt+Shift+X` fallback or reports that neither
      shortcut is available.
- [ ] Switch between `Ctrl+Alt+X` and `Ctrl+Alt+Shift+X` in Settings. Confirm the old shortcut stops
      summoning the app, the new one works, and the choice survives a process restart.
- [ ] Confirm the app does not claim tray or launch-at-login behavior; both are currently absent.

## Plain capture and clipboard

- [ ] Save a text capture with the button. Confirm exactly one folder is created, its same-basename
      Markdown file is at the root, `attachments/` exists, and the clipboard contains the native
      Markdown path without a `\\?\` prefix.
- [ ] Repeat with `Ctrl+Enter` and confirm one keypress creates exactly one capture.
- [ ] Close a non-empty capture with the native window close button. Confirm it follows **Save + copy**
      and hides only after success.
- [ ] Force or simulate clipboard contention after commit. Confirm the folder remains saved, the window
      shows **Saved, not copied**, and **Retry copy** copies the same path without creating another folder.

## Images and diagrams

- [ ] Paste PNG, JPEG/JPG, and WebP images at both an empty caret and over selected text. Confirm each
      link is inserted at that location, each stored attachment is PNG, and its Markdown path uses
      forward slashes relative to the document.
- [ ] Paste a GIF and an unreadable `image/*` clipboard item. Confirm each is rejected visibly without
      corrupting the editor or silently adding an attachment.
- [ ] Type an exact opening-line ` ```diagram` and press Enter. Draw, return to Markdown, confirm the SVG
      preview, reopen it, edit it, and save.
- [ ] Open the saved `.excalidraw` sidecar in Excalidraw and the SVG in a normal browser/image viewer.
      Confirm both match the final drawing and no embedded image/library dependency is missing.

## Folder, ZIP, Windows/WSL, and failure paths

- [ ] Use **ZIP + copy** with and without attachments. Extract the ZIP and confirm the Markdown file and
      `attachments/` directory are present and byte-identical to the committed capture folder.
- [ ] From WSL, translate the copied `C:\...` path to `/mnt/c/...`; open the Markdown and resolve every
      relative attachment without rewriting the document.
- [ ] Start a capture with an attachment, then try to change the output root. Confirm the app rejects the
      change rather than moving or splitting the active session.
- [ ] Hide and summon an unfinished draft in the same process. Then terminate the process with another
      unfinished text-and-attachment draft, restart, and confirm Markdown restoration plus reconnection
      to the UUID-named `.expressive-capture-staging/` directory. Complete the recovered capture and
      verify its attachments.
- [ ] Remove or corrupt that staged directory before restarting another draft. Confirm the Markdown is
      still restored, the UI warns that attachments were not resumed, and saving cannot silently claim
      missing attachments are present.
- [ ] Select a custom output root, restart the app, and confirm the root persists. Inspect
      `%APPDATA%\Expressive Capture\preferences.json` and confirm it contains only the root and bounded
      hotkey, not capture content.
- [ ] Exercise an output root containing a pre-existing junction or reparse point. Confirm generated
      capture and attachment writes cannot escape the selected canonical root.

## Packaging and performance record

- [ ] Install, upgrade, relaunch, and uninstall the intended Windows package; record signing or warning
      behavior and whether user captures remain untouched.
- [ ] In a release build, measure hotkey-to-focused-editor latency, cold launch, idle private working set,
      4K image paste, first diagram load, and small-capture finalize using the budgets in
      [performance.md](performance.md).
