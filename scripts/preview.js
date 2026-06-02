// Generates self-contained, openable preview HTML files for every built page.
// CSS + JS are inlined and internal links are rewired to local files so you can
// open them directly in a browser (no server needed) and navigate/switch langs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const OUT = path.join(ROOT, "previews");
const KNOWN_LOCALES = ["ru", "tr", "kk"]; // non-default locale prefixes

const css = fs.readFileSync(path.join(PUB, "assets/css/styles.css"), "utf8");
const js = fs.readFileSync(path.join(PUB, "assets/js/app.js"), "utf8");

// Find every generated index.html and derive its route.
function findPages(dir, base = "/") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "assets") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPages(full, `${base}${entry.name}/`));
    } else if (entry.name === "index.html") {
      out.push({ route: base, src: full });
    }
  }
  return out;
}

// Route -> local preview filename, e.g. "/ru/terms/" -> "preview-ru-terms.html".
function fileFor(route) {
  const segs = route.split("/").filter(Boolean);
  let locale = "en";
  let rest = segs;
  if (KNOWN_LOCALES.includes(segs[0])) {
    locale = segs[0];
    rest = segs.slice(1);
  }
  const page = rest.length ? rest.join("-") : "home";
  return `preview-${locale}-${page}.html`;
}

const pages = findPages(PUB);
const routeMap = Object.fromEntries(pages.map((p) => [p.route, fileFor(p.route)]));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const { route, src } of pages) {
  let html = fs.readFileSync(src, "utf8");

  // Inline CSS and JS.
  html = html.replace(
    /<link rel="stylesheet" href="[^"]*styles\.css" \/>/,
    `<style>\n${css}\n</style>`
  );
  html = html.replace(
    /<script src="[^"]*app\.js"><\/script>/,
    `<script>\n${js}\n</script>`
  );

  // Rewire internal links + language-switcher values to local preview files.
  // Sort longest-first so "/ru/terms/" is replaced before "/ru/".
  for (const r of Object.keys(routeMap).sort((a, b) => b.length - a.length)) {
    html = html.replaceAll(`value="${r}"`, `value="${routeMap[r]}"`);
    html = html.replaceAll(`href="${r}"`, `href="${routeMap[r]}"`);
  }

  fs.writeFileSync(path.join(OUT, routeMap[route]), html);
  console.log(`✓ ${routeMap[route]}  (${route})`);
}

console.log(`\n${pages.length} previews written to previews/`);
