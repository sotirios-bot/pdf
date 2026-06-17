// Serverless endpoint: Markdown (raw request body) -> PDF.
//
// Deployed on Vercel as /api/md-to-pdf. The browser POSTs the raw .md bytes
// (UTF-8). We parse a pragmatic subset of Markdown — headings, lists,
// blockquotes, fenced code blocks, horizontal rules, and inline bold/italic/
// code plus links/images — and lay it out onto A4 pages with pdf-lib.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const PAGE = { w: 595.28, h: 841.89 }; // A4 points
const MARGIN = 56;
const MAXW = PAGE.w - MARGIN * 2;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(new Error("FILE_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Standard fonts use WinAnsi (CP1252); map smart punctuation and replace
// anything unencodable so drawText never throws.
const CHAR_MAP = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", "•": "-", " ": " ", "\t": "    "
};
function sanitize(s) {
  let out = "";
  for (const ch of String(s)) {
    if (CHAR_MAP[ch] != null) {
      out += CHAR_MAP[ch];
      continue;
    }
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else out += "?";
  }
  return out;
}

// --- inline parsing: text -> [{ text, bold, italic, code }] ---
function parseEmphasis(text) {
  const out = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false, italic: false });
    if (m[1]) out.push({ text: m[2], bold: true, italic: false });
    else out.push({ text: m[4], bold: false, italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false, italic: false });
  return out;
}
export function parseInline(text) {
  const cleaned = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)"); // links -> text (url)
  const runs = [];
  for (const part of cleaned.split(/(`[^`]*`)/)) {
    if (!part) continue;
    if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
      runs.push({ text: part.slice(1, -1), bold: false, italic: false, code: true });
    } else {
      runs.push(...parseEmphasis(part));
    }
  }
  return runs;
}

// --- layout engine ---
function makeLayout(pdf, fonts) {
  const L = {
    pdf,
    fonts,
    page: pdf.addPage([PAGE.w, PAGE.h]),
    y: PAGE.h - MARGIN,
    newPage() {
      this.page = this.pdf.addPage([PAGE.w, PAGE.h]);
      this.y = PAGE.h - MARGIN;
    },
    ensure(h) {
      if (this.y - h < MARGIN) this.newPage();
    }
  };
  return L;
}
function pickFont(L, r) {
  if (r.code) return L.fonts.mono;
  if (r.bold && r.italic) return L.fonts.boldItalic;
  if (r.bold) return L.fonts.bold;
  if (r.italic) return L.fonts.italic;
  return L.fonts.regular;
}

// Flow a list of runs as wrapped, mixed-font text. Returns nothing; advances L.y.
function drawFlow(L, runs, opts) {
  const size = opts.size;
  const lh = size * (opts.lineHeight || 1.45);
  const indent = opts.indent || 0;
  const color = opts.color || rgb(0.1, 0.1, 0.1);
  const startX = MARGIN + indent;
  const maxX = PAGE.w - MARGIN;

  // Flatten runs into words, each carrying its font.
  const words = [];
  for (const r of runs) {
    const f = pickFont(L, r);
    for (const w of sanitize(r.text).split(/\s+/)) {
      if (w !== "") words.push({ w, f });
    }
  }
  if (words.length === 0) {
    L.y -= lh * 0.5;
    return;
  }

  L.ensure(lh);
  let x = startX;
  let yy = L.y - size;
  for (const { w, f } of words) {
    const ww = f.widthOfTextAtSize(w, size);
    const sp = x > startX ? f.widthOfTextAtSize(" ", size) : 0;
    if (x + sp + ww > maxX && x > startX) {
      L.y -= lh;
      L.ensure(lh);
      yy = L.y - size;
      x = startX;
    } else {
      x += sp;
    }
    L.page.drawText(w, { x, y: yy, size, font: f, color });
    x += ww;
  }
  L.y -= lh + (opts.gapBelow != null ? opts.gapBelow : 6);
}

const HEADING_SIZE = { 1: 22, 2: 18, 3: 15, 4: 13, 5: 12, 6: 11 };

function drawHeading(L, level, text) {
  const size = HEADING_SIZE[level] || 11;
  L.y -= level <= 2 ? 8 : 4; // a little space above
  drawFlow(L, [{ text, bold: true }], { size, lineHeight: 1.3, gapBelow: 6, color: rgb(0.05, 0.05, 0.05) });
}

function drawHr(L) {
  L.ensure(14);
  L.y -= 6;
  L.page.drawLine({
    start: { x: MARGIN, y: L.y },
    end: { x: PAGE.w - MARGIN, y: L.y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.7)
  });
  L.y -= 10;
}

function drawListItem(L, marker, text) {
  const size = 11;
  L.ensure(size * 1.45);
  L.page.drawText(marker, { x: MARGIN + 6, y: L.y - size, size, font: L.fonts.regular, color: rgb(0.1, 0.1, 0.1) });
  drawFlow(L, parseInline(text), { size, indent: 24, gapBelow: 2 });
}

function drawQuote(L, text) {
  const size = 11;
  // left rule for the blockquote
  const top = L.y;
  drawFlow(L, parseInline(text), { size, indent: 16, gapBelow: 4, color: rgb(0.35, 0.35, 0.35) });
  if (L.page) {
    L.page.drawLine({
      start: { x: MARGIN + 2, y: top - 2 },
      end: { x: MARGIN + 2, y: L.y + 4 },
      thickness: 2,
      color: rgb(0.8, 0.8, 0.8)
    });
  }
}

function drawCodeBlock(L, lines) {
  const size = 10;
  const lh = size * 1.4;
  const f = L.fonts.mono;
  const maxX = PAGE.w - MARGIN - 6;
  L.y -= 4;
  for (const line of lines) {
    // char-wrap long code lines
    let chunk = "";
    const flush = () => {
      L.ensure(lh);
      L.page.drawText(chunk, { x: MARGIN + 6, y: L.y - size, size, font: f, color: rgb(0.15, 0.15, 0.15) });
      L.y -= lh;
      chunk = "";
    };
    for (const c of sanitize(line)) {
      if (f.widthOfTextAtSize(chunk + c, size) > maxX - MARGIN && chunk) flush();
      chunk += c;
    }
    flush(); // emit (possibly empty) line
  }
  L.y -= 4;
}

// Core conversion, exported for testing. Returns a PDF Buffer.
// Throws Error("EMPTY") when the input has no content.
export async function markdownToPdf(buffer) {
  const raw = buffer.toString("utf8");
  if (!raw.trim()) throw new Error("EMPTY");

  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier)
  };
  const L = makeLayout(pdf, fonts);

  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let inCode = false;
  let codeBuf = [];

  for (const line of lines) {
    const fence = line.trim().startsWith("```") || line.trim().startsWith("~~~");
    if (fence) {
      if (inCode) {
        drawCodeBlock(L, codeBuf);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const t = line.trim();
    if (t === "") {
      L.y -= 6;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      drawHr(L);
      continue;
    }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      drawHeading(L, m[1].length, m[2]);
      continue;
    }
    if ((m = t.match(/^>\s?(.*)$/))) {
      drawQuote(L, m[1]);
      continue;
    }
    if ((m = t.match(/^[-*+]\s+(.*)$/))) {
      drawListItem(L, "-", m[1]);
      continue;
    }
    if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
      drawListItem(L, m[1] + ".", m[2]);
      continue;
    }
    drawFlow(L, parseInline(t), { size: 11, gapBelow: 6 });
  }
  if (inCode && codeBuf.length) drawCodeBlock(L, codeBuf);

  return Buffer.from(await pdf.save());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let buffer;
  try {
    buffer = await readBody(req);
  } catch (err) {
    const code = err.message === "FILE_TOO_LARGE" ? 413 : 400;
    res.status(code).json({ error: err.message });
    return;
  }
  if (!buffer || buffer.length === 0) {
    res.status(400).json({ error: "Empty body" });
    return;
  }

  try {
    const out = await markdownToPdf(buffer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="converted.pdf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "EMPTY") {
      res.status(400).json({ error: "The Markdown file is empty." });
      return;
    }
    console.error("Markdown→PDF failed:", err);
    res.status(500).json({ error: "Conversion failed." });
  }
}
