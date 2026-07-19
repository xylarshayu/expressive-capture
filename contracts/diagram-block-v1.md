# DiagramBlock v1

`DiagramBlock v1` is the durable contract for an editable Excalidraw block in
an Expressive Capture Markdown document. The Markdown directive is public data;
the React component is not part of the format.

## Markdown representation

````md
```diagram
version: 1
id: dia_01JABCDEF
source: ./attachments/dia_01JABCDEF.excalidraw
preview: ./attachments/dia_01JABCDEF.svg
alt: Request routing sketch
```
![Request routing sketch](./attachments/dia_01JABCDEF.svg)
````

The directive body consists of exactly the five lines above in that order,
using `: ` as the separator and LF or CRLF line endings. Unknown, omitted,
reordered, duplicate, quoted, or multiline fields are invalid v1 directives.

`id` must match `dia_[A-Za-z0-9][A-Za-z0-9_-]*`. Its paths are not arbitrary:

- `source` must be `./attachments/<id>.excalidraw`;
- `preview` must be `./attachments/<id>.svg`.

The attachment directory is relative to the Markdown file. It is intentionally
forward-slash Markdown syntax, not an absolute Windows or WSL path.

## Editor behavior

Only a person typing the exact opening-line text ` ```diagram` and pressing
Enter activates the canvas. A pasted/programmatic occurrence never activates
it. The active canvas is a projection of the directive; an inactive block is
the ordinary SVG preview.

The canvas must flush synchronously before document submission: serialize the
scene JSON, generate the SVG fallback, persist them to draft staging, and only
then allow the document transaction to start. A flush failure blocks submission
and leaves the capture draft intact.

## MVP safety boundary

Diagram v1 does not support Excalidraw image files or reusable libraries.
The image tool, Excalidraw paste handling, scene load/save/export UI, and
library persistence are disabled. A future version may enable them only with a
versioned manifest that persists every referenced binary file.
