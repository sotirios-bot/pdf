# PDF Tools

A multilingual website offering online PDF tools — starting with **PDF → Excel**,
and built to grow into a full suite (like freepdfconvert.com).

- **Languages:** English (default, served at `/`), Russian (`/ru/`), Turkish (`/tr/`).
- **Frontend:** plain static HTML/CSS/JS, generated from templates + locale JSON.
- **Conversion:** server-side via a Vercel serverless function (`/api/convert`).
- **Hosting:** Vercel (static frontend + serverless API in one deploy).

> **Why Vercel and not GitHub Pages?** GitHub Pages only serves static files and
> cannot run the server-side conversion API. The frontend build output (`public/`)
> is fully static, so it *can* be hosted on GitHub Pages too — but the `/api`
> endpoint needs a real runtime (Vercel, Cloudflare Workers, etc.).

## Project structure

```
.
├── build.js              # Generates public/ from templates + locales (zero deps)
├── vercel.json           # Vercel build + routing config
├── package.json
├── api/
│   └── convert.js        # Serverless PDF→Excel endpoint
├── scripts/
│   └── serve.js          # Local static preview server (npm run dev)
├── src/
│   ├── templates/        # Page templates with {{placeholders}}
│   │   └── home.html
│   ├── partials/         # Shared header.html / footer.html
│   ├── locales/          # ★ Translations live here — edit these
│   │   ├── en.json
│   │   ├── ru.json       # contains "TODO" placeholders to translate
│   │   └── tr.json       # contains "TODO" placeholders to translate
│   └── assets/
│       ├── css/styles.css
│       └── js/app.js     # Upload, drag-drop, convert, language switcher
└── public/               # Build output (gitignored) — what gets served
```

## Develop locally

```bash
npm install
npm run build      # generates public/
npm run dev        # build + serve at http://localhost:3000
```

To test the conversion API locally, use the Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

## Add or update a translation

All text lives in `src/locales/<lang>.json`. The `ru.json` and `tr.json` files
currently contain `"TODO"` placeholders — replace them with real translations,
then run `npm run build`. Each locale must keep the **same key structure** as
`en.json`.

## Add a new language

1. Create `src/locales/<code>.json` (copy `en.json`, translate the values).
2. Add the code to `config.locales` in `build.js`.
3. Rebuild. New pages appear at `/<code>/...` automatically, with hreflang tags.

## Add a new tool/page

1. Add a `pages.<id>` block to every locale JSON (with its `slug`, `title`, etc.).
2. Create `src/templates/<id>.html`.
3. Register it in `config.pages` in `build.js`.

## Configuration

Edit `config` at the top of `build.js`:

- `baseUrl` — your real domain (used for canonical URLs, hreflang, sitemap).
- `defaultLocale` — the language served at `/` (currently `en`).
- `locales` — list of enabled language codes.
- `pages` — list of pages to generate.

## Conversion notes

`api/convert.js` is a working **v1**: it extracts text with `pdf-parse` and
writes rows/columns to an `.xlsx` with `exceljs`, using a whitespace-based
column heuristic. It handles simple text-based tables. Planned improvements:
position-based table detection and OCR for scanned PDFs (likely a Python
service using `camelot`/`pdfplumber`).
