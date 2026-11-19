// Renders task text: Markdown (no raw HTML), KaTeX formulas, figures (![…](stimulus:ID)) and answer slots ([[A|B]]).
import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import { memo, useMemo } from "react";
import { assetUrl, type PublicStimulus } from "../../../shared/ipc";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: true });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface RichContext {
  sessionId: string;
  stimuli: PublicStimulus[];
  /** Text shown inside an answer slot, e.g. the chosen option; "" shows the slot's letters. */
  slotText?: (a: string, b: string) => string;
}

/** Converts task text to safe HTML. Exported for tests. */
export function renderRich(text: string, ctx: RichContext, inline = false): string {
  const parts: string[] = [];
  const hold = (html: string) => `⁣${parts.push(html) - 1}⁣`;

  let src = text
    // Display math first, then inline math. Formulas never reach Markdown, so "_" and "*" inside them are safe.
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => hold(katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: "ignore" })))
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => hold(katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: "ignore" })))
    .replace(/!\[([^\]]*)\]\(stimulus:([^)]+)\)/g, (_, alt: string, id: string) => {
      const s = ctx.stimuli.find((x) => x.id === id);
      if (!s?.asset) return hold(`<span class="rich-missing">[rysunek niedostępny]</span>`);
      return hold(`<figure class="rich-figure"><img src="${esc(assetUrl(ctx.sessionId, s.asset))}" alt="${esc(alt || s.title || "")}"></figure>`);
    })
    // A true/false row already has its own P/F buttons, so a "[[P|F]]" slot in its text is noise.
    .replace(/\s*\[\[P\|F\]\]/g, "")
    // Underline ("podkreślony wyraz" tasks): Markdown has none and raw HTML is off, so only this exact tag pair passes.
    .replace(/<u>([^<>\n]+?)<\/u>/g, (_, t: string) => hold(`<u>${esc(t)}</u>`))
    .replace(/\[\[([A-F1-4])\|([A-F1-4])\]\]/g, (_, a: string, b: string) => {
      const chosen = ctx.slotText?.(a, b) ?? "";
      return hold(`<span class="rich-slot${chosen ? " filled" : ""}">${chosen ? esc(chosen) : `<b>${a}</b><b>${b}</b>`}</span>`);
    });

  let html = inline ? md.renderInline(src) : md.render(src);
  html = html.replace(/⁣(\d+)⁣/g, (_, n: string) => parts[Number(n)] ?? "");
  return html;
}

export const Rich = memo(function Rich({ text, ctx, inline, className }: { text: string; ctx: RichContext; inline?: boolean; className?: string }) {
  const html = useMemo(() => renderRich(text, ctx, inline), [text, ctx, inline]);
  return inline ? <span className={className} dangerouslySetInnerHTML={{ __html: html }} /> : <div className={`rich ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
