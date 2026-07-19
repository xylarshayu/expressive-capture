/**
 * Excalidraw 0.17 always adds a `style-fonts` block whose `src: url(...)`
 * declarations point at its web-hosted font assets. Capture previews must be
 * self-contained, so discard that one package-owned stylesheet before the SVG
 * crosses the native validation boundary. Text remains readable via the
 * fallback font family emitted on Excalidraw text nodes.
 */
const EXCALIDRAW_FONT_STYLE =
  /<style\b[^>]*\bclass\s*=\s*(?:"(?:[^"\s]+\s+)*style-fonts(?:\s+[^"\s]+)*"|'(?:[^'\s]+\s+)*style-fonts(?:\s+[^'\s]+)*')[^>]*>[\s\S]*?<\/style\s*>/gi;

export function stripExcalidrawFontStyles(svg: string): string {
  return svg.replace(EXCALIDRAW_FONT_STYLE, "");
}
