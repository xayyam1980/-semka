import { describe, expect, it } from "vitest";
import { renderRich } from "../src/renderer/src/components/Rich";

const ctx = { sessionId: "matematyka-2026-05-glowny", stimuli: [{ id: "ma-2026-01-fig1", kind: "figure", asset: "assets/ma-2026-01-fig1.png" }] };

describe("renderRich", () => {
  it("renders formulas with KaTeX and keeps Markdown around them", () => {
    const html = renderRich("**Oblicz** $\\sqrt{100-64}-2$ oraz $a_1 * b_2$.", ctx);
    expect(html).toContain("<strong>Oblicz</strong>");
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("<em>"); // "_" and "*" inside formulas are not Markdown
  });

  it("shows figures from the session's assets", () => {
    expect(renderRich("![Diagram](stimulus:ma-2026-01-fig1)", ctx)).toContain('src="osemka-content://matematyka-2026-05-glowny/assets/ma-2026-01-fig1.png"');
    expect(renderRich("![x](stimulus:nope)", ctx)).toContain("rysunek niedostępny");
  });

  it("renders answer slots, empty or filled", () => {
    expect(renderRich("liczbami [[A|B]].", ctx)).toContain('<span class="rich-slot"><b>A</b><b>B</b></span>');
    expect(renderRich("liczbami [[A|B]].", { ...ctx, slotText: () => "nieparzystymi" })).toContain('rich-slot filled">nieparzystymi<');
  });

  it("escapes HTML and blocks script links in task text", () => {
    const html = renderRich('<script>alert(1)</script> <img src=x onerror=alert(1)> [klik](javascript:alert(1))', ctx);
    expect(html).not.toMatch(/<script|<img src=x|href="javascript/);
    expect(html).toContain("&lt;script&gt;");
  });
});
