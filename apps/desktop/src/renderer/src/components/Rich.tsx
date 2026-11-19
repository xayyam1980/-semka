// Renders task text: Markdown (no raw HTML), KaTeX formulas, figures (![…](stimulus:ID)) and answer slots ([[A|B]]).
import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownIt from "markdown-it";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
      // In task text a figure is focusable and opens full size on click/Enter (small figures, e.g. game cards).
      // Not inline: those sit inside answer-option buttons, where a click must choose the answer.
      const zoom = inline ? "" : ` tabindex="0" role="button" title="Powiększ rysunek" aria-label="Powiększ rysunek: ${esc(alt || s.title || "")}"`;
      return hold(`<figure class="rich-figure"${zoom}><img src="${esc(assetUrl(ctx.sessionId, s.asset))}" alt="${esc(alt || s.title || "")}"></figure>`);
    })
    // A true/false row already has its own P/F buttons, so a "[[P|F]]" slot in its text is noise.
    .replace(/\s*\[\[P\|F\]\]/g, "")
    // Underline ("podkreślony wyraz" tasks): Markdown has none and raw HTML is off, so only this exact tag pair passes.
    .replace(/<u>([^<>\n]+?)<\/u>/g, (_, t: string) => hold(`<u>${esc(t)}</u>`))
    .replace(/\[\[([A-F1-4])\|([A-F1-4])\]\]/g, (_, a: string, b: string) => {
      const chosen = ctx.slotText?.(a, b) ?? "";
      // A screen reader hears "luka: A albo B" (or the chosen text), not the letters run together.
      return hold(
        `<span class="rich-slot${chosen ? " filled" : ""}">${chosen ? `<span class="sr-only">wybrano: </span>${esc(chosen)}` : `<b aria-hidden="true">${a}</b><b aria-hidden="true">${b}</b><span class="sr-only">luka: ${a} albo ${b}</span>`}</span>`,
      );
    });

  let html = inline ? md.renderInline(src) : md.render(src);
  html = html.replace(/⁣(\d+)⁣/g, (_, n: string) => parts[Number(n)] ?? "");
  return html;
}

export const Rich = memo(function Rich({ text, ctx, inline, className, lang }: { text: string; ctx: RichContext; inline?: boolean; className?: string; lang?: string | undefined }) {
  const html = useMemo(() => renderRich(text, ctx, inline), [text, ctx, inline]);
  const [zoom, setZoom] = useState<{ src: string; alt: string; from: HTMLElement } | null>(null);
  const open = (e: { target: EventTarget }) => {
    const fig = (e.target as HTMLElement).closest?.('.rich-figure[role="button"]') as HTMLElement | null;
    const img = fig?.querySelector("img");
    if (fig && img) setZoom({ src: img.src, alt: img.alt, from: fig });
  };
  const handlers = {
    onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).classList?.contains("rich-figure")) {
        e.preventDefault();
        open(e);
      }
    },
  };
  return (
    <>
      {inline ? <span className={className} lang={lang} dangerouslySetInnerHTML={{ __html: html }} {...handlers} /> : <div className={`rich ${className ?? ""}`} lang={lang} dangerouslySetInnerHTML={{ __html: html }} {...handlers} />}
      {zoom && (
        <FigureZoom
          {...zoom}
          onClose={() => {
            zoom.from.focus();
            setZoom(null);
          }}
        />
      )}
    </>
  );
});

/** Full-window view of one figure; Escape, the button or a click outside closes it. */
function FigureZoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        // The only control is the close button: keep the focus inside the dialog.
        e.preventDefault();
        close.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="figure-zoom" role="dialog" aria-modal="true" aria-label={`Rysunek: ${alt}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <img src={src} alt={alt} />
      <button ref={close} className="btn" onClick={onClose}>
        Zamknij (Esc)
      </button>
    </div>
  );
}
