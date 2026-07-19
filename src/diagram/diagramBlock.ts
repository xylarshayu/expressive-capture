import {
  ATTACHMENTS_DIRECTORY,
  DIAGRAM_BLOCK_VERSION,
  type DiagramBlock,
} from "./types";

const ID_PATTERN = /^dia_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ALT_PATTERN = /^[^\r\n]*$/;

export class DiagramBlockParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagramBlockParseError";
  }
}

/** Returns the exact v1 paths; callers cannot choose arbitrary sidecars. */
export function diagramPaths(id: string): Pick<DiagramBlock, "source" | "preview"> {
  assertDiagramId(id);
  return {
    source: `${ATTACHMENTS_DIRECTORY}/${id}.excalidraw`,
    preview: `${ATTACHMENTS_DIRECTORY}/${id}.svg`,
  };
}

export function createDiagramBlock(id: string, alt = "Diagram"): DiagramBlock {
  assertDiagramId(id);
  assertAlt(alt);
  return {
    version: DIAGRAM_BLOCK_VERSION,
    id,
    ...diagramPaths(id),
    alt,
  };
}

/**
 * Serialize only the directive body. The editor owns the surrounding
 * ```diagram fences and the ordinary Markdown SVG image below it.
 */
export function serializeDiagramBlock(block: DiagramBlock): string {
  assertValidBlock(block);
  return [
    `version: ${DIAGRAM_BLOCK_VERSION}`,
    `id: ${block.id}`,
    `source: ${block.source}`,
    `preview: ${block.preview}`,
    `alt: ${block.alt}`,
  ].join("\n");
}

/** Strict v1 parser: no extra keys, duplicate keys, quoting, or path aliases. */
export function parseDiagramBlock(body: string): DiagramBlock {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length !== 5) {
    throw new DiagramBlockParseError("DiagramBlock v1 must contain exactly five fields.");
  }

  const expectedKeys = ["version", "id", "source", "preview", "alt"] as const;
  const values = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    const separator = line.indexOf(": ");
    if (separator < 1 || line.indexOf(": ", separator + 2) !== -1) {
      throw new DiagramBlockParseError(`Invalid DiagramBlock field at line ${index + 1}.`);
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 2);
    if (key !== expectedKeys[index] || values.has(key)) {
      throw new DiagramBlockParseError(`Expected '${expectedKeys[index]}' at line ${index + 1}.`);
    }
    values.set(key, value);
  }

  if (values.get("version") !== String(DIAGRAM_BLOCK_VERSION)) {
    throw new DiagramBlockParseError("Unsupported DiagramBlock version.");
  }

  const block = {
    version: DIAGRAM_BLOCK_VERSION,
    id: values.get("id") ?? "",
    source: values.get("source") ?? "",
    preview: values.get("preview") ?? "",
    alt: values.get("alt") ?? "",
  } satisfies DiagramBlock;
  assertValidBlock(block);
  return block;
}

export function renderDiagramMarkdown(block: DiagramBlock): string {
  return [`\`\`\`diagram`, serializeDiagramBlock(block), "\`\`\`", `![${block.alt}](${block.preview})`].join("\n");
}

export function assertValidBlock(block: DiagramBlock): void {
  if (block.version !== DIAGRAM_BLOCK_VERSION) {
    throw new DiagramBlockParseError("Unsupported DiagramBlock version.");
  }
  assertDiagramId(block.id);
  assertAlt(block.alt);
  const paths = diagramPaths(block.id);
  if (block.source !== paths.source || block.preview !== paths.preview) {
    throw new DiagramBlockParseError(
      "DiagramBlock v1 source and preview must be their exact ./attachments paths.",
    );
  }
}

function assertDiagramId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new DiagramBlockParseError("Diagram id must match dia_[A-Za-z0-9][A-Za-z0-9_-]*.");
  }
}

function assertAlt(alt: string): void {
  if (!ALT_PATTERN.test(alt)) {
    throw new DiagramBlockParseError("Diagram alt text must be a single line.");
  }
}
