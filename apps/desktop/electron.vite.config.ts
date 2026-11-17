import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// Workspace packages ship TypeScript source, so they are bundled rather than left as runtime imports.
const bundleWorkspace = { exclude: ["@osemka/schema", "@osemka/scoring"] };

/** Strict Content-Security-Policy in production builds only (dev needs Vite's inline HMR script). */
function productionCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: osemka-content:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "osemka-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleWorkspace },
  },
  preload: {
    build: { externalizeDeps: bundleWorkspace },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
    plugins: [react(), tailwindcss(), productionCsp()],
  },
});
