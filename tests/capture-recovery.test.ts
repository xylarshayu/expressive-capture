import { describe, expect, it } from "vitest";
import { hasAttachmentReferences } from "../src/capture/markdown";

describe("attachment recovery guard", () => {
  it("recognizes Markdown links and diagram directive references", () => {
    expect(hasAttachmentReferences("![shot](attachments/image.png)")).toBe(true);
    expect(hasAttachmentReferences("source: ./attachments/dia_1.excalidraw")).toBe(true);
    expect(hasAttachmentReferences("# text only")).toBe(false);
  });
});
