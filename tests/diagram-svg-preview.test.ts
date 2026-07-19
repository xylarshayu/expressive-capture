import { describe, expect, it } from "vitest";
import { stripExcalidrawFontStyles } from "../src/diagram";

describe("Excalidraw SVG preview normalization", () => {
  it("removes the package-owned external font stylesheet", () => {
    const exported = [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      "<defs>",
      '<style class="style-fonts">',
      '@font-face { font-family: "Virgil"; src: url("https://unpkg.com/@excalidraw/excalidraw@0.17.6/dist/excalidraw-assets/Virgil.woff2"); }',
      "</style>",
      '<style class="shape-colors">.shape { fill: #1b1b1f; }</style>',
      "</defs>",
      '<path class="shape" d="M0 0L10 10"/>',
      "</svg>",
    ].join("");

    const preview = stripExcalidrawFontStyles(exported);

    expect(preview).not.toContain("style-fonts");
    expect(preview).not.toContain("unpkg.com");
    expect(preview).toContain('<style class="shape-colors">');
    expect(preview).toContain('<path class="shape"');
  });

  it("handles the single-quoted class serialization without touching lookalikes", () => {
    const exported =
      "<svg><style class='theme style-fonts'>@font-face{src:url(https://example.test/font.woff2)}</style>" +
      '<style class="style-fonts-copy">.safe{fill:black}</style></svg>';

    expect(stripExcalidrawFontStyles(exported)).toBe(
      '<svg><style class="style-fonts-copy">.safe{fill:black}</style></svg>',
    );
  });
});
