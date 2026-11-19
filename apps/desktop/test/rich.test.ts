import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Rich, renderRich } from "../src/renderer/src/components/Rich";
import { contentLang } from "../src/renderer/src/lib/format";

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
    expect(renderRich("liczbami [[A|B]].", ctx)).toContain(`<span class="rich-slot"><b aria-hidden="true">A</b><b aria-hidden="true">B</b><span class="sr-only">luka: A albo B</span></span>`);
    expect(renderRich("liczbami [[A|B]].", { ...ctx, slotText: () => "nieparzystymi" })).toContain('rich-slot filled"><span class="sr-only">wybrano: </span>nieparzystymi</span>');
  });

  it("escapes HTML and blocks script links in task text", () => {
    const html = renderRich('<script>alert(1)</script> <img src=x onerror=alert(1)> [klik](javascript:alert(1))', ctx);
    expect(html).not.toMatch(/<script|<img src=x|href="javascript/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops redundant [[P|F]] markers and renders <u> underlines safely", () => {
    expect(renderRich("Liczba jest parzysta. [[P|F]]", ctx, true)).toBe("Liczba jest parzysta.");
    expect(renderRich("To <u>serdeczne</u> chłopczysko.", ctx, true)).toContain("<u>serdeczne</u>");
    expect(renderRich('<u onclick="x">a</u> <u><b>b</b></u>', ctx, true)).not.toMatch(/<u onclick|<b>/);
  });
});

describe("language of task content", () => {
  it("marks English papers as English and leaves the others unmarked", () => {
    expect(contentLang({ subjectId: "angielski" })).toBe("en");
    expect(contentLang({ subjectId: "polski" })).toBeUndefined();
    expect(contentLang(null)).toBeUndefined();
  });

  it("puts lang on block and inline Rich wrappers only when given", () => {
    expect(renderToStaticMarkup(createElement(Rich, { text: "What was in the parcel?", ctx, lang: "en" }))).toContain('lang="en"');
    expect(renderToStaticMarkup(createElement(Rich, { text: "A cat", ctx, inline: true, lang: "en" }))).toContain('<span lang="en"');
    expect(renderToStaticMarkup(createElement(Rich, { text: "Kot", ctx }))).not.toContain("lang=");
  });
});
