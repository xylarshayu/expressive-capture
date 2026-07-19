export type TextRange = { from: number; to: number };

/** Route every image MIME type to native policy (including GIF), never silently drop one. */
export function isImageClipboardType(type: string): boolean {
  return /^image\//i.test(type);
}

/** Pure representation of the CodeMirror replacement used after async staging. */
export function insertAtRange(document: string, range: TextRange, text: string): string {
  const from = Math.max(0, Math.min(range.from, document.length));
  const to = Math.max(from, Math.min(range.to, document.length));
  return `${document.slice(0, from)}${text}${document.slice(to)}`;
}

/** Map an async paste anchor through a document change without inverting a caret. */
export function mapPasteRange(range: TextRange, mapPos: (position: number, assoc: -1 | 1) => number): TextRange {
  if (range.from === range.to) {
    const position = mapPos(range.from, 1);
    return { from: position, to: position };
  }
  const from = mapPos(range.from, 1);
  const to = mapPos(range.to, -1);
  return { from: Math.min(from, to), to: Math.max(from, to) };
}
