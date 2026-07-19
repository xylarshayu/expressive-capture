import { shouldActivateDiagramTrigger, type DiagramTriggerOrigin } from "../diagram";

/**
 * Determines whether a line is an opening fence in the surrounding Markdown
 * source. It deliberately examines the actual fence stack, rather than
 * trusting a caller-provided boolean.
 */
export function isOpeningDiagramFence(markdown: string, lineNumber: number): boolean {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const candidate = lines[lineNumber - 1];
  if (candidate !== "```diagram") return false;

  let open: { marker: "`" | "~"; length: number } | null = null;
  for (let index = 0; index < lineNumber - 1; index += 1) {
    const match = lines[index].match(/^\s*(`{3,}|~{3,})/);
    if (!match) continue;
    const marker = match[1][0] as "`" | "~";
    if (!open) {
      open = { marker, length: match[1].length };
    } else if (open.marker === marker && match[1].length >= open.length) {
      open = null;
    }
  }
  return open === null;
}

export function shouldOpenDiagram(
  markdown: string,
  lineNumber: number,
  origin: DiagramTriggerOrigin,
  enterPressed: boolean,
): boolean {
  const lineText = markdown.replace(/\r\n?/g, "\n").split("\n")[lineNumber - 1] ?? "";
  return shouldActivateDiagramTrigger({
    origin,
    lineText,
    enterPressed,
    isOpeningFence: isOpeningDiagramFence(markdown, lineNumber),
  });
}
