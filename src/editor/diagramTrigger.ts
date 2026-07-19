import { shouldActivateDiagramTrigger, type DiagramTriggerOrigin } from "../diagram";

/**
 * The exact post-transaction source and range of a typed diagram fence.
 *
 * React state updates are asynchronous, so consumers must use this source
 * rather than reading their last rendered editor value when replacing the
 * fence with a DiagramBlock.
 */
export interface DiagramTriggerRequest {
  readonly markdown: string;
  readonly from: number;
  readonly to: number;
}

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

/** Replace only the opening fence which produced this request. */
export function replaceDiagramTrigger(request: DiagramTriggerRequest, replacement: string): string | null {
  if (request.from < 0 || request.to < request.from || request.to > request.markdown.length) return null;
  if (request.markdown.slice(request.from, request.to) !== "```diagram") return null;
  return `${request.markdown.slice(0, request.from)}${replacement}${request.markdown.slice(request.to)}`;
}
