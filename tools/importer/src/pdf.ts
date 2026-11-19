// PDF text and page images with pdf.js (pure npm, same behaviour on Windows and macOS).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
// pdf.js wants URLs with a trailing slash; pathToFileURL handles Windows drive letters.
const assetUrl = (sub: string) => pathToFileURL(join(pdfjsDir, sub)).href + "/";

export interface TextLine {
  text: string;
  /** Distance from the top of the page, in PDF points. */
  y: number;
  x: number;
}

export interface PdfPage {
  page: number; // 1-based
  width: number;
  height: number;
  lines: TextLine[];
}

export type PdfDoc = Awaited<ReturnType<typeof openPdf>>;

export async function openPdf(file: string) {
  const data = new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: assetUrl("standard_fonts"),
    cMapUrl: assetUrl("cmaps"),
    cMapPacked: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  return doc;
}

/** Text of every page, rebuilt into lines (items on the same baseline joined left to right). */
const WATERMARK = /arkuszy znajdziesz|arkusze\.pl/i;

export async function readPages(doc: PdfDoc): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextLine[] = [];
    // Copies from arkusze.pl carry a rotated watermark ("Więcej arkuszy znajdziesz na stronie: arkusze.pl") whose
    // pieces would otherwise end up inside task headings. On such pages rotated text and the phrase are dropped.
    const raw = content.items.filter((it): it is Extract<typeof it, { str: string }> => "str" in it && !!it.str.trim());
    const watermarked = raw.some((it) => WATERMARK.test(it.str));
    for (const it of raw) {
      const [, b, , , e, f] = it.transform as number[];
      if (watermarked && (Math.abs(b ?? 0) > 0.01 || WATERMARK.test(it.str))) continue;
      items.push({ text: it.str, x: e ?? 0, y: vp.height - (f ?? 0) });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: TextLine[] = [];
    for (const it of items) {
      const last = lines.at(-1);
      if (last && Math.abs(last.y - it.y) < 2.5) {
        last.text += (it.x - last.x > 0 ? " " : "") + it.text;
      } else {
        lines.push({ ...it });
      }
    }
    for (const l of lines) l.text = l.text.replace(/\s+/g, " ").trim().normalize("NFC");
    pages.push({ page: n, width: vp.width, height: vp.height, lines });
    page.cleanup();
  }
  return pages;
}

/** Renders one page to PNG. scale 1.5 ≈ 890×1260 px for A4: formulas stay readable for the AI and the reviewer. */
export async function renderPage(doc: PdfDoc, pageNumber: number, scale = 1.5): Promise<Buffer> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // @napi-rs/canvas implements the 2D API pdf.js needs; the DOM types differ only nominally.
  await page.render({ canvas, canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
  page.cleanup();
  return canvas.toBuffer("image/png");
}

/** Crops a region given as fractions of the page (0–1) from a rendered page PNG. */
export async function cropPng(png: Buffer, box: [number, number, number, number]): Promise<Buffer> {
  const { loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const [x0, y0, x1, y1] = box.map(clamp) as [number, number, number, number];
  const sx = Math.floor(x0 * img.width), sy = Math.floor(y0 * img.height);
  const sw = Math.max(1, Math.ceil((x1 - x0) * img.width)), sh = Math.max(1, Math.ceil((y1 - y0) * img.height));
  const canvas = createCanvas(sw, sh);
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toBuffer("image/png");
}

/** Re-encodes a page PNG as JPEG: text pages shrink 3–4× with no loss in legibility, for size-limited endpoints. */
export async function toJpeg(png: Buffer, quality = 82): Promise<Buffer> {
  const { loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.encode("jpeg", quality);
}

/** Decodes a PNG into raw RGBA pixels (for ink detection when cropping figures). */
export async function decodePng(png: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, img.width, img.height).data as unknown as Uint8ClampedArray, width: img.width, height: img.height };
}
