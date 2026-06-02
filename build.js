// build.js — generates the static site from templates + locale JSON.
// Zero dependencies. Run with: npm run build
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "public");

// ----- Site configuration -------------------------------------------------
const config = {
  // Used for canonical URLs / hreflang / sitemap. Update to your real domain.
  baseUrl: "https://example.com",
  defaultLocale: "en",
  locales: ["en", "ru", "tr"],
  // Pages to render. Each maps a locale `pages.<id>` block to a template.
  // `type` selects how the page-specific content is rendered.
  pages: [
    { id: "home", template: "home.html", type: "home" },
    { id: "terms", template: "legal.html", type: "legal" },
    { id: "privacy", template: "legal.html", type: "legal" }
  ]
};

// ----- Helpers -------------------------------------------------------------
const read = (p) => fs.readFileSync(p, "utf8");
const loadLocale = (loc) =>
  JSON.parse(read(path.join(SRC, "locales", `${loc}.json`)));

// Replace every {{key}} in `str` using the flat `ctx` object.
function render(str, ctx) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
    key in ctx ? ctx[key] : ""
  );
}

// URL path (root-relative) for a given locale + page slug.
function urlPath(locale, slug) {
  const localePart = locale === config.defaultLocale ? "" : `${locale}/`;
  const slugPart = slug ? `${slug}/` : "";
  return `/${localePart}${slugPart}`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ----- Build ---------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const headerTpl = read(path.join(SRC, "partials", "header.html"));
const footerTpl = read(path.join(SRC, "partials", "footer.html"));
const allLocales = config.locales.map((l) => loadLocale(l));
const sitemapUrls = [];

for (const locale of config.locales) {
  const t = loadLocale(locale);

  for (const page of config.pages) {
    const pdata = t.pages[page.id];
    const slug = pdata.slug || "";
    const route = urlPath(locale, slug);

    // Language switcher options (point to the same page in each locale).
    const langOptions = allLocales
      .map((other) => {
        const otherRoute = urlPath(other.lang, other.pages[page.id].slug || "");
        const selected = other.lang === locale ? " selected" : "";
        return `<option value="${otherRoute}"${selected}>${other.localeName}</option>`;
      })
      .join("\n        ");

    // hreflang alternates for SEO.
    const hreflang =
      allLocales
        .map((other) => {
          const otherRoute = urlPath(other.lang, other.pages[page.id].slug || "");
          return `<link rel="alternate" hreflang="${other.lang}" href="${config.baseUrl}${otherRoute}" />`;
        })
        .join("\n  ") +
      `\n  <link rel="alternate" hreflang="x-default" href="${config.baseUrl}${urlPath(
        config.defaultLocale,
        t.pages[page.id].slug || ""
      )}" />`;

    // Context shared by every page + the partials.
    const ctx = {
      lang: t.lang,
      dir: t.dir,
      assetBase: "/",
      homeHref: urlPath(locale, ""),
      privacyHref: urlPath(locale, t.pages.privacy.slug || ""),
      termsHref: urlPath(locale, t.pages.terms.slug || ""),
      canonical: `${config.baseUrl}${route}`,
      hreflang,
      year: new Date().getFullYear(),
      siteName: t.site.name,
      navHome: t.nav.home,
      languageLabel: t.common.languageLabel,
      langOptions,
      footerRights: t.footer.rights,
      footerTagline: t.footer.tagline,
      footerLegalHeading: t.footer.legalHeading,
      footerPrivacy: t.footer.privacy,
      footerTerms: t.footer.terms,
      // page meta
      title: pdata.title,
      metaDescription: pdata.metaDescription,
      h1: pdata.h1
    };

    if (page.type === "home") {
      ctx.subtitle = pdata.subtitle;
      ctx.uploaderDropText = pdata.uploader.dropText;
      ctx.uploaderHint = pdata.uploader.hint;
      ctx.uploaderButton = pdata.uploader.button;
      ctx.uploaderConverting = pdata.uploader.converting;
      ctx.uploaderDownloadReady = pdata.uploader.downloadReady;
      ctx.uploaderDownload = pdata.uploader.download;
      ctx.uploaderErrorGeneric = pdata.uploader.errorGeneric;
      ctx.uploaderErrorFileType = pdata.uploader.errorFileType;
      ctx.uploaderErrorTooLarge = pdata.uploader.errorTooLarge;
      ctx.howToHeading = pdata.howTo.heading;
      ctx.howToList = pdata.howTo.steps
        .map(
          (s, i) =>
            `<li class="step">
          <span class="step-num">${i + 1}</span>
          <div class="step-body"><h3>${s.title}</h3><p>${s.text}</p></div>
        </li>`
        )
        .join("\n        ");
      ctx.benefitsHeading = pdata.benefits.heading;
      ctx.benefitsIntro = pdata.benefits.intro;
      ctx.benefitsList = pdata.benefits.items
        .map((f) => `<div class="benefit"><h3>${f.title}</h3><p>${f.text}</p></div>`)
        .join("\n        ");
    } else if (page.type === "legal") {
      ctx.lastUpdatedLabel = pdata.lastUpdatedLabel;
      ctx.lastUpdated = pdata.lastUpdated;
      ctx.sectionsHtml = pdata.sections
        .map(
          (s) =>
            `<section class="legal-section">
          <h2>${s.heading}</h2>
          ${s.body.map((p) => `<p>${p}</p>`).join("\n          ")}
        </section>`
        )
        .join("\n        ");
    }

    ctx.header = render(headerTpl, ctx);
    ctx.footer = render(footerTpl, ctx);

    const tpl = read(path.join(SRC, "templates", page.template));
    const html = render(tpl, ctx);

    const outDir = path.join(OUT, route);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), html);
    sitemapUrls.push(`${config.baseUrl}${route}`);
    console.log(`✓ ${locale}/${page.id} → ${route}`);
  }
}

// Static assets
copyDir(path.join(SRC, "assets"), path.join(OUT, "assets"));

// sitemap.xml + robots.txt
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(OUT, "sitemap.xml"), sitemap);
fs.writeFileSync(
  path.join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`
);

console.log("\nBuild complete → public/");
