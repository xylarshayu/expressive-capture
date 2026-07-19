# Threat model

## Protected assets

- Existing user files under and outside the configured output root.
- Private draft contents and pasted images.
- Clipboard integrity and the distinction between committed and uncommitted captures.

## Trust boundaries

The webview may submit a user-entered absolute output root through the Settings command, plus Markdown
and opaque staged-image bytes. Native code canonicalizes or creates that root, then generates capture
and attachment filenames beneath it. The configured capability grants no general filesystem, network,
or shell command to the webview.

## Required controls

- Reject absolute paths, parent traversal, Windows reserved names, invalid components, and
  symlink/junction/reparse-point escapes.
- Create temporary commit directories and ZIPs inside the selected output root so final renames do
  not cross volumes.
- Write attachments before Markdown, verify the committed document and archive entries, and never
  overwrite an existing capture during a collision.
- Treat clipboard failure after commit as a recoverable copy error, not as persistence failure.
- Enforce image byte/dimension limits and reject animated/video content rather than silently
  flattening it.
- Keep Excalidraw image/library insertion disabled until a versioned file manifest preserves its
  binary dependencies.

The current direct-child checks and generated collision-resistant names reduce path-escape risk, but
real Windows testing must still exercise pre-existing reparse points and junctions before treating that
control as release-verified. The output-root text field is not a native folder-grant boundary.

Preferences contain only the output root and bounded hotkey. Unsaved Markdown and a staged-session ID
are stored in the WebView's local storage to support restart recovery; they are not encrypted by the
application. Staged image and diagram files remain under the configured root until commit, explicit
abort, or manual cleanup.

## Explicit non-goals for MVP

The application does not protect a capture after another program receives its path, encrypt saved
captures, provide cloud synchronization, or execute Markdown/diagram content.
