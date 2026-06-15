// build.js — generates the static site from templates + locale JSON.
// Zero dependencies. Run with: npm run build
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "public");

// ----- Site configuration -------------------------------------------------
const config = {
  // Used for canonical URLs / hreflang / sitemap. Update to your real domain.
  baseUrl: "https://pdfconvertme.com",
  defaultLocale: "en",
  locales: ["en", "ru", "tr", "kk", "uz"],
  // Languages a page falls back to when it isn't translated for a locale
  // (e.g. Kazakh has no legal pages → its footer links point here).
  legalFallbackLocale: "en",
  ogImage: "/assets/og-image.png",
  ogLocaleMap: { en: "en_US", ru: "ru_RU", tr: "tr_TR", kk: "kk_KZ", uz: "uz_UZ" },
  org: {
    name: "PDFConvertMe",
    legalName: "Mytheon Technologies",
    email: "hello@xyzlab.com",
    street: "133/1 Gagarin Avenue",
    locality: "Almaty",
    country: "KZ"
  },
  // Pages to render. Each maps a locale `pages.<id>` block to a template.
  // `locales` restricts which languages a page is built for (default: all).
  pages: [
    { id: "home", template: "hub.html", type: "hub", locales: ["en", "ru", "tr", "kk", "uz"] },
    { id: "pdfToExcel", template: "converter.html", type: "converter", category: "convert", endpoint: "/api/convert", ext: "xlsx", downloadEvent: "excel_download", inputAccept: "application/pdf,.pdf", acceptExt: "pdf" },
    { id: "pdfToWord", template: "converter.html", type: "converter", category: "convert", endpoint: "/api/convert-word", ext: "docx", downloadEvent: "download_word", inputAccept: "application/pdf,.pdf", acceptExt: "pdf", locales: ["en", "ru", "tr", "kk", "uz"] },
    { id: "pdfToPpt", template: "converter.html", type: "converter", category: "convert", endpoint: "/api/convert-ppt", ext: "pptx", downloadEvent: "download_ppt", inputAccept: "application/pdf,.pdf", acceptExt: "pdf", locales: ["en", "tr", "ru", "kk", "uz"] },
    { id: "jpgToPdf", template: "converter.html", type: "converter", category: "convert", endpoint: "/api/image-to-pdf", ext: "pdf", downloadEvent: "jpg_to_pdf_download", inputAccept: "image/jpeg,.jpg,.jpeg", acceptExt: "jpe?g", locales: ["en", "uz", "kk", "ru", "tr"] },
    { id: "pngToPdf", template: "converter.html", type: "converter", category: "convert", endpoint: "/api/image-to-pdf", ext: "pdf", downloadEvent: "png_to_pdf_download", inputAccept: "image/png,.png", acceptExt: "png", locales: ["en", "ru", "tr", "kk", "uz"] },
    { id: "mergePdf", template: "converter.html", type: "converter", category: "edit", endpoint: "/api/merge-pdf", ext: "pdf", downloadEvent: "merge_pdf_download", inputAccept: "application/pdf,.pdf", acceptExt: "pdf", multiple: true, locales: ["en"] },
    { id: "splitPdf", template: "converter.html", type: "converter", category: "edit", endpoint: "/api/split-pdf", ext: "zip", downloadEvent: "split_pdf_download", inputAccept: "application/pdf,.pdf", acceptExt: "pdf", locales: ["en"] },
    { id: "deletePdfPages", template: "converter.html", type: "converter", category: "edit", endpoint: "/api/delete-pdf-pages", ext: "pdf", downloadEvent: "delete_pages_download", inputAccept: "application/pdf,.pdf", acceptExt: "pdf", param: "pages", locales: ["en"] },
    { id: "terms", template: "legal.html", type: "legal", locales: ["en", "ru", "tr"] },
    { id: "privacy", template: "legal.html", type: "legal", locales: ["en", "ru", "tr"] }
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
const absUrl = (loc, slug) => `${config.baseUrl}${urlPath(loc, slug)}`;
// Locales a given page is built for (defaults to all configured locales).
const pageLocales = (page) => page.locales || config.locales;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const ld = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// ----- Build ---------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const headTpl = read(path.join(SRC, "partials", "head.html"));
const headerTpl = read(path.join(SRC, "partials", "header.html"));
const footerTpl = read(path.join(SRC, "partials", "footer.html"));
const allLocales = config.locales.map((l) => loadLocale(l));
const defaultT = allLocales.find((l) => l.lang === config.defaultLocale);
const getLocale = (code) => allLocales.find((l) => l.lang === code);
// URL of a tool page in a given locale, falling back to the default locale
// when that language doesn't have the page.
function toolHref(locale, pageId) {
  const loc = getLocale(locale);
  if (loc.pages[pageId]) return urlPath(locale, loc.pages[pageId].slug || "");
  const d = getLocale(config.defaultLocale);
  return urlPath(config.defaultLocale, d.pages[pageId].slug || "");
}

// All converter pages, in config order.
const toolPages = config.pages.filter((p) => p.type === "converter");
const toolIcons = { pdfToExcel: "📊", pdfToWord: "📝", pdfToPpt: "📽️", jpgToPdf: "🖼️", pngToPdf: "🖼️", mergePdf: "🔗", splitPdf: "✂️", deletePdfPages: "🗑️" };
// <a> links to the tools in `category` available in `locale` (labelled locally).
function toolLinksFor(locale, t, category) {
  return toolPages
    .filter((p) => (p.category || "convert") === category && pageLocales(p).includes(locale))
    .map(
      (p) =>
        `<a href="${urlPath(locale, getLocale(locale).pages[p.id].slug || "")}">${t.nav[p.id]}</a>`
    );
}
// Header dropdown + footer column for a category, or "" if it has no tools
// in this locale (e.g. Edit PDF on non-English pages).
function navGroup(locale, t, category, label) {
  const links = toolLinksFor(locale, t, category);
  if (!links.length) return { dropdown: "", footerCol: "" };
  return {
    dropdown: `<div class="nav-dropdown">
        <button type="button" class="nav-dropbtn" aria-haspopup="true">${label}<span class="caret" aria-hidden="true">▾</span></button>
        <div class="nav-menu">
          ${links.join("\n          ")}
        </div>
      </div>`,
    footerCol: `<div class="footer-col">
      <h4>${label}</h4>
      ${links.join("\n      ")}
    </div>`
  };
}

// "Related tools" section: 3 other tools (cyclic from the current one),
// localized, linking to the same-language pages. Card text reuses the hub's
// localized tool names/descriptions. Returns "" if none are available.
function relatedSection(locale, t, currentId) {
  const order = toolPages.map((p) => p.id);
  const idx = order.indexOf(currentId);
  const cards = [];
  for (let i = 1; i < order.length && cards.length < 3; i++) {
    const id = order[(idx + i) % order.length];
    const cfg = config.pages.find((p) => p.id === id);
    if (!pageLocales(cfg).includes(locale)) continue;
    const meta = (t.pages.home.tools || []).find((c) => c.id === id);
    const page = t.pages[id];
    if (!meta || !page) continue;
    cards.push(`<a class="tool-card" href="${urlPath(locale, page.slug || "")}">
          <span class="tool-icon">${toolIcons[id] || "📄"}</span>
          <span class="tool-name">${meta.name}</span>
          <span class="tool-desc">${meta.description}</span>
        </a>`);
  }
  if (!cards.length) return "";
  return `<section class="related">
      <h2>${t.common.relatedTools}</h2>
      <div class="related-grid">
        ${cards.join("\n        ")}
      </div>
    </section>`;
}
const ogImageAbs = `${config.baseUrl}${config.ogImage}`;
const buildDate = new Date().toISOString().slice(0, 10);

// Content-hash the CSS/JS into the URL (?v=hash) so browsers/CDN always fetch
// the latest after a change, while still allowing long caching.
const assetVer = (rel) =>
  crypto.createHash("md5").update(read(path.join(SRC, rel))).digest("hex").slice(0, 8);
const cssHref = `/assets/css/styles.css?v=${assetVer("assets/css/styles.css")}`;
const jsHref = `/assets/js/app.js?v=${assetVer("assets/js/app.js")}`;

// Locales that have legal pages (used for footer link fallback).
const legalLocales = pageLocales(config.pages.find((p) => p.id === "privacy"));
const privacySlug = defaultT.pages.privacy.slug || "privacy";
const termsSlug = defaultT.pages.terms.slug || "terms";

// Precompute hreflang alternates per page id (only the locales it's built for).
const altsByPage = {};
for (const page of config.pages) {
  const links = pageLocales(page).map((code) => ({
    hreflang: code,
    href: absUrl(code, getLocale(code).pages[page.id].slug || "")
  }));
  links.push({
    hreflang: "x-default",
    href: absUrl(config.defaultLocale, defaultT.pages[page.id].slug || "")
  });
  altsByPage[page.id] = links;
}

// Reusable Organization + WebSite structured data.
const orgLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: config.org.name,
  url: config.baseUrl,
  logo: `${config.baseUrl}/assets/icons/icon-512.png`,
  legalName: config.org.legalName,
  email: config.org.email,
  address: {
    "@type": "PostalAddress",
    streetAddress: config.org.street,
    addressLocality: config.org.locality,
    addressCountry: config.org.country
  }
};

const sitemapEntries = [];

for (const locale of config.locales) {
  const t = loadLocale(locale);

  for (const page of config.pages) {
    const locs = pageLocales(page);
    if (!locs.includes(locale)) continue; // page not built for this language
    const pdata = t.pages[page.id];
    const slug = pdata.slug || "";
    const route = urlPath(locale, slug);
    const canonical = `${config.baseUrl}${route}`;

    // The hub homepage offers every language (pointing to each language's
    // root); other pages only list the locales they're actually built for.
    const switcherLocales = page.type === "hub" ? config.locales : locs;
    const langOptions = switcherLocales
      .map((code) => {
        const o = getLocale(code);
        const otherRoute =
          page.type === "hub" ? urlPath(code, "") : urlPath(code, o.pages[page.id].slug || "");
        const selected = code === locale ? " selected" : "";
        return `<option value="${otherRoute}"${selected}>${o.localeName}</option>`;
      })
      .join("\n        ");

    const hreflang = altsByPage[page.id]
      .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
      .join("\n  ");

    const ogLocaleAlternates = locs
      .filter((code) => code !== locale)
      .map(
        (code) =>
          `<meta property="og:locale:alternate" content="${config.ogLocaleMap[code]}" />`
      )
      .join("\n  ");

    // Legal links fall back to the configured locale when this language
    // has no legal pages of its own (e.g. Kazakh → English).
    const legalLoc = legalLocales.includes(locale)
      ? locale
      : config.legalFallbackLocale;

    // ----- structured data (JSON-LD) -----
    const websiteLd = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: config.org.name,
      url: config.baseUrl,
      inLanguage: t.lang
    };
    const ldBlocks = [orgLd, websiteLd];

    if (page.type === "converter") {
      ldBlocks.push({
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: pdata.h1,
        url: canonical,
        applicationCategory: "BusinessApplication",
        operatingSystem: "All",
        inLanguage: t.lang,
        description: pdata.metaDescription,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }
      });
      if (pdata.faq && pdata.faq.items) {
        ldBlocks.push({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          inLanguage: t.lang,
          mainEntity: pdata.faq.items.map((it) => ({
            "@type": "Question",
            name: it.q,
            acceptedAnswer: { "@type": "Answer", text: it.a }
          }))
        });
      }
      ldBlocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t.nav.home, item: absUrl(locale, "") },
          { "@type": "ListItem", position: 2, name: t.nav[page.id], item: canonical }
        ]
      });
    } else if (page.type === "legal") {
      ldBlocks.push({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t.nav.home, item: absUrl(locale, "") },
          { "@type": "ListItem", position: 2, name: pdata.h1, item: canonical }
        ]
      });
    }
    const jsonLd = ldBlocks.map(ld).join("\n  ");

    // ----- context -----
    const ctx = {
      lang: t.lang,
      dir: t.dir,
      homeHref: urlPath(locale, ""),
      privacyHref: urlPath(legalLoc, privacySlug),
      termsHref: urlPath(legalLoc, termsSlug),
      canonical,
      robots: "",
      hreflang,
      ogImage: ogImageAbs,
      ogLocale: config.ogLocaleMap[locale],
      ogLocaleAlternates,
      jsonLd,
      year: new Date().getFullYear(),
      siteName: t.site.name,
      cssHref,
      jsHref,
      navHome: t.nav.home,
      navConvertPdf: t.nav.convertPdf,
      navConvertLinks: toolLinksFor(locale, t, "convert").join("\n          "),
      footerConvertLinks: toolLinksFor(locale, t, "convert").join("\n      "),
      editDropdown: navGroup(locale, t, "edit", t.nav.editPdf).dropdown,
      footerEditCol: navGroup(locale, t, "edit", t.nav.editPdf).footerCol,
      languageLabel: t.common.languageLabel,
      langOptions,
      footerRights: t.footer.rights,
      footerTagline: t.footer.tagline,
      footerLegalHeading: t.footer.legalHeading,
      footerPrivacy: t.footer.privacy,
      footerTerms: t.footer.terms,
      title: pdata.title,
      metaDescription: pdata.metaDescription,
      h1: pdata.h1
    };

    if (page.type === "converter") {
      ctx.breadcrumbName = t.nav[page.id];
      ctx.trustNote = t.common.trustNote.replace(
        "{type}",
        { pdf: "PDF", "jpe?g": "JPG", png: "PNG" }[page.acceptExt] || ""
      );
      ctx.relatedSection = relatedSection(locale, t, page.id);
      ctx.endpoint = page.endpoint;
      ctx.downloadExt = page.ext;
      ctx.downloadEvent = page.downloadEvent;
      ctx.inputAccept = page.inputAccept;
      ctx.acceptExt = page.acceptExt;
      ctx.fileMultiple = page.multiple ? " multiple" : "";
      ctx.paramField = page.param
        ? `<input id="paramInput" class="param-input" type="text" data-param="${page.param}" placeholder="${pdata.paramPlaceholder || ""}" aria-label="${pdata.paramPlaceholder || ""}" />`
        : "";
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
      ctx.uploaderErrorMin = pdata.uploader.errorMin || "";
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
      // Benefits section is optional — only render it when present.
      if (pdata.benefits && pdata.benefits.items && pdata.benefits.items.length) {
        const benefitsList = pdata.benefits.items
          .map((f) => `<div class="benefit"><h3>${f.title}</h3><p>${f.text}</p></div>`)
          .join("\n        ");
        ctx.benefitsSection = `<section class="benefits">
      <h2>${pdata.benefits.heading}</h2>
      <p class="benefits-intro">${pdata.benefits.intro}</p>
      <div class="benefits-grid">
        ${benefitsList}
      </div>
    </section>`;
      } else {
        ctx.benefitsSection = "";
      }
      // FAQ section (optional).
      ctx.faqSection = pdata.faq
        ? `<section class="faq">
      <h2>${pdata.faq.heading}</h2>
      <div class="faq-list">
        ${pdata.faq.items
          .map(
            (it) =>
              `<details class="faq-item" open><summary>${it.q}</summary><p>${it.a}</p></details>`
          )
          .join("\n        ")}
      </div>
    </section>`
        : "";
    } else if (page.type === "hub") {
      ctx.subtitle = pdata.subtitle;
      ctx.toolsHeading = pdata.toolsHeading;
      const icons = toolIcons;
      ctx.toolsList = pdata.tools
        .map((tool) => {
          const href = urlPath(locale, getLocale(locale).pages[tool.id].slug || "");
          const badge = tool.badge
            ? `<span class="tool-badge">${tool.badge}</span>`
            : "";
          return `<a class="tool-card" href="${href}">
          <span class="tool-icon">${icons[tool.id] || "📄"}</span>
          <span class="tool-name">${tool.name}${badge}</span>
          <span class="tool-desc">${tool.description}</span>
        </a>`;
        })
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

    ctx.head = render(headTpl, ctx);
    ctx.header = render(headerTpl, ctx);
    ctx.footer = render(footerTpl, ctx);

    const html = render(read(path.join(SRC, "templates", page.template)), ctx);
    const outDir = path.join(OUT, route);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), html);
    sitemapEntries.push({ loc: canonical, pageId: page.id, type: page.type });
    console.log(`✓ ${locale}/${page.id} → ${route}`);
  }
}

// ----- 404 page (single, default locale, noindex) -----
{
  const t = defaultT;
  const langOptions = allLocales
    .map(
      (o) =>
        `<option value="${urlPath(o.lang, "")}"${o.lang === t.lang ? " selected" : ""}>${o.localeName}</option>`
    )
    .join("\n        ");
  const ctx = {
    lang: t.lang,
    dir: t.dir,
    homeHref: urlPath(t.lang, ""),
    privacyHref: urlPath(t.lang, t.pages.privacy.slug || ""),
    termsHref: urlPath(t.lang, t.pages.terms.slug || ""),
    canonical: `${config.baseUrl}/404`,
    robots: '<meta name="robots" content="noindex" />',
    hreflang: "",
    ogImage: ogImageAbs,
    ogLocale: config.ogLocaleMap[t.lang],
    ogLocaleAlternates: "",
    jsonLd: "",
    year: new Date().getFullYear(),
    siteName: t.site.name,
    cssHref,
    jsHref,
    navHome: t.nav.home,
    navConvertPdf: t.nav.convertPdf,
    navConvertLinks: toolLinksFor(t.lang, t, "convert").join("\n          "),
    footerConvertLinks: toolLinksFor(t.lang, t, "convert").join("\n      "),
    editDropdown: navGroup(t.lang, t, "edit", t.nav.editPdf).dropdown,
    footerEditCol: navGroup(t.lang, t, "edit", t.nav.editPdf).footerCol,
    languageLabel: t.common.languageLabel,
    langOptions,
    footerRights: t.footer.rights,
    footerTagline: t.footer.tagline,
    footerLegalHeading: t.footer.legalHeading,
    footerPrivacy: t.footer.privacy,
    footerTerms: t.footer.terms,
    title: t.meta.notFoundTitle,
    metaDescription: t.meta.notFoundDescription,
    notFoundText: t.meta.notFoundText,
    notFoundHome: t.meta.notFoundHome
  };
  ctx.head = render(headTpl, ctx);
  ctx.header = render(headerTpl, ctx);
  ctx.footer = render(footerTpl, ctx);
  fs.writeFileSync(
    path.join(OUT, "404.html"),
    render(read(path.join(SRC, "templates", "404.html")), ctx)
  );
  console.log("✓ 404 → /404.html");
}

// Static assets
copyDir(path.join(SRC, "assets"), path.join(OUT, "assets"));

// site.webmanifest
fs.writeFileSync(
  path.join(OUT, "site.webmanifest"),
  JSON.stringify(
    {
      name: "PDFConvertMe",
      short_name: "PDFConvertMe",
      description: defaultT.meta.manifestDescription,
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#2563eb",
      icons: [
        { src: "/assets/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/assets/icons/icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    },
    null,
    2
  )
);

// sitemap.xml (with lastmod + hreflang alternates) + robots.txt
// Per-page-type sitemap hints (changefreq is advisory; priority is relative).
const sitemapMeta = {
  hub: { changefreq: "weekly", priority: "1.0" },
  converter: { changefreq: "weekly", priority: "0.9" },
  legal: { changefreq: "yearly", priority: "0.3" }
};
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapEntries
  .map((e) => {
    const m = sitemapMeta[e.type] || { changefreq: "monthly", priority: "0.5" };
    return `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${buildDate}</lastmod>
    <changefreq>${m.changefreq}</changefreq>
    <priority>${m.priority}</priority>
${altsByPage[e.pageId]
  .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
  .join("\n")}
  </url>`;
  })
  .join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(OUT, "sitemap.xml"), sitemap);
fs.writeFileSync(
  path.join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`
);

console.log("\nBuild complete → public/");
