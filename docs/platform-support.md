# Platform support

| Surface | Windows 11 | macOS | Linux |
| --- | --- | --- | --- |
| Portable capture folders | Designed | Designed | Designed |
| Global shortcut | Release-blocking verification | Experimental | Experimental; compositor-dependent |
| Window summon/focus | Release-blocking verification | Experimental; permission-sensitive | Experimental; Wayland varies |
| Clipboard image ingestion | Release-blocking verification | Experimental | Experimental |
| Native path copy | Release-blocking verification | Experimental | Experimental |
| Installer/signing | NSIS/MSI planned | Not yet verified | Not yet verified |

“Designed” is not a claim of real-machine verification. Before a public release, record the exact OS,
keyboard layout, hotkey conflicts, focus behavior, image clipboard sources, archive hand-off, and
installer result. Windows/WSL interoperability tests must confirm that Markdown uses relative
forward-slash attachment links while copied paths remain native Windows paths.

Automated Windows CI is a compile-and-unit-test gate for the full desktop feature set. It does not
create an interactive session, register a real global shortcut, use the system clipboard, validate
WebView focus, or install and launch a packaged application. Those remain release-blocking manual
checks in the [Windows smoke-test checklist](windows-smoke-test.md).
