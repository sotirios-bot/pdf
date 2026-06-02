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
  baseUrl: "https://pdfconvertme.com",
  defaultLocale: "en",
  locales: ["en", "ru", "tr"],
  ogImage: "/assets/og-image.png",
  ogLocaleMap: { en: "en_US", ru: "ru_RU", tr: "tr_TR" },
  org: {
    name: "PDFConvertMe",
    legalName: "XYZ LAB PTE. LTD.",
    email: "hello@xyzlab.com",
    street: "160 Robinson Road, #14-04, Singapore Business Federation Center",
    postalCode: "068914",
    country: "SG"
  },
  // Pages to render. Each maps a locale `pages.<id>` block to a template.
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
const absUrl = (loc, slug) => `${config.baseUrl}${urlPath(loc, slug)}`;

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
const ogImageAbs = `${config.baseUrl}${config.ogImage}`;
const buildDate = new Date().toISOString().slice(0, 10);

// Precompute hreflang alternates per page id (same for every locale of a page).
const altsByPage = {};
for (const page of config.pages) {
  const links = allLocales.map((o) => ({
    hreflang: o.lang,
    href: absUrl(o.lang, o.pages[page.id].slug || "")
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
    postalCode: config.org.postalCode,
    addressCountry: config.org.country
  }
};

const sitemapEntries = [];

for (const locale of config.locales) {
  const t = loadLocale(locale);

  for (const page of config.pages) {
    const pdata = t.pages[page.id];
    const slug = pdata.slug || "";
    const route = urlPath(locale, slug);
    const canonical = `${config.baseUrl}${route}`;

    const langOptions = allLocales
      .map((other) => {
        const otherRoute = urlPath(other.lang, other.pages[page.id].slug || "");
        const selected = other.lang === locale ? " selected" : "";
        return `<option value="${otherRoute}"${selected}>${other.localeName}</option>`;
      })
      .join("\n        ");

    const hreflang = altsByPage[page.id]
      .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
      .join("\n  ");

    const ogLocaleAlternates = allLocales
      .filter((o) => o.lang !== locale)
      .map(
        (o) =>
          `<meta property="og:locale:alternate" content="${config.ogLocaleMap[o.lang]}" />`
      )
      .join("\n  ");

    // ----- structured data (JSON-LD) -----
    const websiteLd = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: config.org.name,
      url: config.baseUrl,
      inLanguage: t.lang
    };
    const ldBlocks = [orgLd, websiteLd];

    if (page.type === "home") {
      ldBlocks.push({
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: `${config.org.name} — PDF to Excel Converter`,
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
      privacyHref: urlPath(locale, t.pages.privacy.slug || ""),
      termsHref: urlPath(locale, t.pages.terms.slug || ""),
      canonical,
      robots: "",
      hreflang,
      ogImage: ogImageAbs,
      ogLocale: config.ogLocaleMap[locale],
      ogLocaleAlternates,
      jsonLd,
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
              `<details class="faq-item"><summary>${it.q}</summary><p>${it.a}</p></details>`
          )
          .join("\n        ")}
      </div>
    </section>`
        : "";
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
    sitemapEntries.push({ loc: canonical, pageId: page.id });
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
    navHome: t.nav.home,
    languageLabel: t.common.languageLabel,
    langOptions,
    footerRights: t.footer.rights,
    footerTagline: t.footer.tagline,
    footerLegalHeading: t.footer.legalHeading,
    footerPrivacy: t.footer.privacy,
    footerTerms: t.footer.terms,
    title: "404 — Page Not Found | PDFConvertMe",
    metaDescription: "The page you’re looking for could not be found.",
    notFoundText: "Sorry, the page you’re looking for doesn’t exist or has moved.",
    notFoundHome: "Back to homepage"
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
      description: "Convert PDF to Excel for free — fast, online, and secure.",
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
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${sitemapEntries
  .map(
    (e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${buildDate}</lastmod>
${altsByPage[e.pageId]
  .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`)
  .join("\n")}
  </url>`
  )
  .join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(OUT, "sitemap.xml"), sitemap);
fs.writeFileSync(
  path.join(OUT, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`
);

console.log("\nBuild complete → public/");
