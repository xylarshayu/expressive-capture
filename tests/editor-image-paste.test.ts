import { describe, expect, it } from "vitest";
import { insertAtRange, isImageClipboardType, mapPasteRange } from "../src/editor/imagePaste";

describe("async image paste helpers", () => {
  it("replaces the original selection instead of appending at document end", () => {
    expect(insertAtRange("before selected after", { from: 7, to: 15 }, "![image](attachments/a.png)"))
      .toBe("before ![image](attachments/a.png) after");
  });

  it("inserts at a collapsed caret", () => {
    expect(insertAtRange("hello world", { from: 5, to: 5 }, "![x](a.png)")).toBe("hello![x](a.png) world");
  });

  it("routes GIF and other image MIME types to native validation", () => {
    expect(isImageClipboardType("image/gif")).toBe(true);
    expect(isImageClipboardType("image/png")).toBe(true);
    expect(isImageClipboardType("text/plain")).toBe(false);
  });

  it("keeps a collapsed async-paste anchor collapsed when typing occurs at its caret", () => {
    const mapped = mapPasteRange({ from: 4, to: 4 }, (_position, assoc) => assoc === 1 ? 7 : 4);
    expect(mapped).toEqual({ from: 7, to: 7 });
  });
});
