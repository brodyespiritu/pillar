import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const at = (p) => normalizePath(path.join(ROOT, p));

/*
 * DEV ONLY — the fixtures harness: `npm run dev:fixtures` (vite --mode fixtures --port 1422).
 * It swaps the two modules that talk to the outside world for in-memory fakes, so every page (the App
 * section above all) can be opened at any window size with sample data, no real sign-in, and no way to
 * reach the church's Supabase project or its app server:
 *   src/lib/supabase.js → src/dev/fixtures/supabase.js
 *   src/lib/appApi.js   → src/dev/fixtures/appApi.js
 * It exists only in the dev server in that mode (`apply`, and the guard in `plugins` below). `vite build`
 * never loads it, and nothing outside src/dev/ imports src/dev/, so production bundles are unchanged
 * (tests/fixtures.test.mjs checks all of this).
 */
const FIXTURE_SWAPS = {
  [at("src/lib/supabase.js")]: at("src/dev/fixtures/supabase.js"),
  [at("src/lib/appApi.js")]: at("src/dev/fixtures/appApi.js"),
};
const FIXTURE_DIR = at("src/dev/fixtures") + "/";
const MEDIA_LIMIT = 64 * 1024 * 1024;   // what the dev server will hold for dropped pictures

export function pillarFixtures() {
  const media = new Map();   // id → { type, body }: pictures dropped while testing, gone when the server stops
  let held = 0;
  return {
    name: "pillar-fixtures",
    enforce: "pre",
    apply: (_config, env) => env.command === "serve" && env.mode === "fixtures",
    // belt and braces: even a page that builds a Supabase address by hand gets one that goes nowhere
    config: () => ({
      define: {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://fixtures.invalid"),
        "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("fixtures"),
      },
    }),
    async resolveId(source, importer, options) {
      if (!importer || !/(supabase|appApi)(\.js)?$/.test(source)) return null;
      if (normalizePath(importer).startsWith(FIXTURE_DIR)) return null;   // the fakes import each other
      const hit = await this.resolve(source, importer, { ...options, skipSelf: true });
      return (hit && FIXTURE_SWAPS[normalizePath(hit.id).split("?")[0]]) || null;
    },
    transformIndexHtml: (html) => html.replace("<title>", "<title>[fixtures] "),
    // /__fixtures/upload keeps a dropped picture in memory; /__fixtures/media/<id> serves it back
    configureServer(server) {
      server.middlewares.use("/__fixtures", (req, res, next) => {
        if (req.method === "POST" && req.url.startsWith("/upload")) {
          const chunks = [];
          let size = 0;
          req.on("data", (c) => { size += c.length; if (held + size <= MEDIA_LIMIT) chunks.push(c); });
          req.on("end", () => {
            res.setHeader("Content-Type", "application/json");
            if (held + size > MEDIA_LIMIT) { res.statusCode = 413; res.end(JSON.stringify({ error: "The fixtures server is full — restart it." })); return; }
            const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            media.set(id, { type: req.headers["content-type"] || "application/octet-stream", body: Buffer.concat(chunks) });
            held += size;
            res.end(JSON.stringify({ path: `/__fixtures/media/${id}` }));
          });
          return;
        }
        const m = /^\/media\/([a-z0-9]+)/.exec(req.url || "");
        if (m) {
          const f = media.get(m[1]);
          if (!f) { res.statusCode = 404; res.end(); return; }
          res.setHeader("Content-Type", f.type);
          res.setHeader("Cache-Control", "no-store");
          res.end(f.body);
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => ({
  plugins: [react(), command === "serve" && mode === "fixtures" && pillarFixtures()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
