// Serverless conversion endpoint: PDF (raw request body) -> Excel (.xlsx).
//
// Deployed on Vercel as /api/convert. The browser POSTs the raw PDF bytes with
// Content-Type: application/pdf. We use PDF.js (pdfjs-dist) to read every text
// fragment WITH its position, then reconstruct rows (by Y) and columns (by X)
// into a real grid — one worksheet per page — and write it with ExcelJS.
//
// Handles digital/text-based PDFs. Scanned (image-only) PDFs have no text layer
// and return a clear error. TODO (later): pdfplumber service for ruled tables
// and OCR for scanned documents.

import { createRequire } from "node:module";
import ExcelJS from "exceljs";

// pdfjs-dist v3 legacy build is the CommonJS bundle that runs in Node without a
// DOM/worker. Load it via createRequire to avoid ESM/CJS interop pitfalls.
const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

export const config = {
  api: { bodyParser: false } // we read the raw stream ourselves
};

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

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

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Reconstruct a 2D grid (array of rows, each an array of cell strings) from
// positioned text items: [{ x, y, w, h, str }].
function buildGrid(items) {
  if (!items.length) return [];

  const medH = median(items.map((i) => i.h).filter((h) => h > 0)) || 10;
  const rowTol = Math.max(medH * 0.6, 3); // same-row Y tolerance
  const gapTol = Math.max(medH * 1.2, 6); // gap that separates columns
  const spaceTol = medH * 0.25; // gap that implies a space within a cell

  // 1) Group items into rows by Y (PDF origin is bottom-left, so larger Y = higher).
  const rows = [];
  let cur = null;
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    if (cur && Math.abs(it.y - cur.y) <= rowTol) {
      cur.items.push(it);
    } else {
      cur = { y: it.y, items: [it] };
      rows.push(cur);
    }
  }

  // 2) Within each row, merge fragments into cells separated by wide gaps.
  const rowCells = rows.map((r) => {
    const cells = [];
    let cell = null;
    for (const it of r.items.sort((a, b) => a.x - b.x)) {
      if (cell && it.x - cell.right <= gapTol) {
        cell.text += (it.x - cell.right > spaceTol ? " " : "") + it.str;
        cell.right = it.x + it.w;
      } else {
        cell = { x: it.x, right: it.x + it.w, text: it.str };
        cells.push(cell);
      }
    }
    return cells.map((c) => ({ x: c.x, text: c.text.trim() }));
  });

  // 3) Cluster all cell start-Xs into global column positions.
  const colTol = Math.max(medH * 1.2, 8);
  const cols = [];
  for (const x of rowCells.flatMap((cells) => cells.map((c) => c.x)).sort((a, b) => a - b)) {
    const last = cols[cols.length - 1];
    if (last && x - last.x <= colTol) {
      last.x = (last.x * last.n + x) / (last.n + 1);
      last.n += 1;
    } else {
      cols.push({ x, n: 1 });
    }
  }
  const colXs = cols.map((c) => c.x);
  const colIndex = (x) => {
    let best = 0;
    let bd = Infinity;
    colXs.forEach((cx, i) => {
      const d = Math.abs(cx - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  // 4) Place each cell into its column to build the matrix.
  return rowCells.map((cells) => {
    const arr = new Array(colXs.length).fill("");
    for (const c of cells) {
      const i = colIndex(c.x);
      arr[i] = arr[i] ? `${arr[i]} ${c.text}` : c.text;
    }
    return arr;
  });
}

// Convert a cell string to a number when it cleanly looks like one, so Excel
// treats numbers as numbers (right-aligned, summable) rather than text.
function cellValue(s) {
  const t = s.trim();
  if (t === "") return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    const n = Number(t.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

// Core conversion, exported for testing. Returns an XLSX Buffer.
// Throws Error("NO_TEXT") when the PDF has no extractable text layer.
export async function convertPdfToXlsx(buffer) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false, // hardening: never eval content from the PDF
    useSystemFonts: true
  }).promise;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PDFConvertMe";
  let totalCells = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str && it.str.trim().length)
      .map((it) => ({
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        h: it.height || Math.abs(it.transform[3]) || 10,
        str: it.str
      }));

    const grid = buildGrid(items);
    const sheet = workbook.addWorksheet(`Page ${p}`);
    const widths = [];

    for (const row of grid) {
      sheet.addRow(row.map(cellValue));
      row.forEach((v, i) => {
        widths[i] = Math.max(widths[i] || 10, Math.min(String(v ?? "").length + 2, 60));
        if (String(v ?? "").trim()) totalCells += 1;
      });
    }
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
  }

  if (totalCells === 0) throw new Error("NO_TEXT");
  return Buffer.from(await workbook.xlsx.writeBuffer());
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
    const out = await convertPdfToXlsx(buffer);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="converted.xlsx"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "NO_TEXT") {
      res.status(422).json({
        error: "No extractable text found. The PDF may be scanned or image-only."
      });
      return;
    }
    console.error("Conversion failed:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
}
