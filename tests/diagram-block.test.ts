import { describe, expect, it } from "vitest";
import {
  createDiagramBlock,
  parseDiagramBlock,
  serializeDiagramBlock,
  shouldActivateDiagramTrigger,
} from "../src/diagram";

describe("DiagramBlock v1", () => {
  it("round-trips only its canonical attachment paths", () => {
    const block = createDiagramBlock("dia_01JABCDEF", "A sketch");
    expect(parseDiagramBlock(serializeDiagramBlock(block))).toEqual(block);
  });

  it("rejects a directive that escapes attachments", () => {
    expect(() =>
      parseDiagramBlock(
        [
          "version: 1",
          "id: dia_01JABCDEF",
          "source: ../escape.excalidraw",
          "preview: ./attachments/dia_01JABCDEF.svg",
          "alt: Escape",
        ].join("\n"),
      ),
    ).toThrow("exact ./attachments paths");
  });
});

describe("diagram trigger", () => {
  it("activates only a typed exact opening fence on Enter", () => {
    expect(
      shouldActivateDiagramTrigger({
        origin: "typed",
        lineText: "```diagram",
        enterPressed: true,
        isOpeningFence: true,
      }),
    ).toBe(true);
    expect(
      shouldActivateDiagramTrigger({
        origin: "paste",
        lineText: "```diagram",
        enterPressed: true,
        isOpeningFence: true,
      }),
    ).toBe(false);
  });
});
