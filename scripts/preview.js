// Generates self-contained, openable preview HTML files for each locale.
// CSS + JS are inlined and links are rewired to local files so you can open
// them directly in a browser (no server needed) and switch languages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const OUT = path.join(ROOT, "previews");

const css = fs.readFileSync(path.join(PUB, "assets/css/styles.css"), "utf8");
const js = fs.readFileSync(path.join(PUB, "assets/js/app.js"), "utf8");

const locales = [
  { code: "en", src: "index.html", file: "preview-en.html" },
  { code: "ru", src: "ru/index.html", file: "preview-ru.html" },
  { code: "tr", src: "tr/index.html", file: "preview-tr.html" }
];
const fileFor = { "/": "preview-en.html", "/ru/": "preview-ru.html", "/tr/": "preview-tr.html" };

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const loc of locales) {
  let html = fs.readFileSync(path.join(PUB, loc.src), "utf8");

  // Inline CSS and JS.
  html = html.replace(
    /<link rel="stylesheet" href="[^"]*styles\.css" \/>/,
    `<style>\n${css}\n</style>`
  );
  html = html.replace(
    /<script src="[^"]*app\.js"><\/script>/,
    `<script>\n${js}\n</script>`
  );

  // Rewire language-switcher option values + home links to local preview files.
  for (const [route, file] of Object.entries(fileFor)) {
    html = html.replaceAll(`value="${route}"`, `value="${file}"`);
    html = html.replaceAll(`href="${route}"`, `href="${file}"`);
  }

  fs.writeFileSync(path.join(OUT, loc.file), html);
  console.log(`✓ ${loc.file}`);
}
console.log("\nPreviews written to previews/");
