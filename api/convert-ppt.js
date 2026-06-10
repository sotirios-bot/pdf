// Serverless conversion endpoint: PDF (raw request body) -> PowerPoint (.pptx).
//
// Uses PDF.js to extract text with positions, rebuilds reading-order lines per
// page, and writes one slide per PDF page with pptxgenjs. Handles digital/
// text-based PDFs; scanned (image-only) PDFs return a clear error.
// TODO (later): preserve layout/images per slide.

import { createRequire } from "node:module";
import pptxgen from "pptxgenjs";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

export const config = { api: { bodyParser: false } };

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

// Rebuild reading-order text lines from positioned items.
function toLines(items) {
  if (!items.length) return [];
  const medH = median(items.map((i) => i.h).filter((h) => h > 0)) || 10;
  const rowTol = Math.max(medH * 0.6, 3);
  const spaceTol = medH * 0.25;

  const rows = [];
  let cur = null;
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    if (cur && Math.abs(it.y - cur.y) <= rowTol) cur.items.push(it);
    else {
      cur = { y: it.y, items: [it] };
      rows.push(cur);
    }
  }
  return rows.map((r) => {
    let line = "";
    let right = null;
    for (const it of r.items.sort((a, b) => a.x - b.x)) {
      if (right !== null) line += it.x - right > spaceTol ? " " : "";
      line += it.str;
      right = it.x + it.w;
    }
    return line.trim();
  });
}

// Core conversion, exported for testing. Returns a .pptx Buffer.
// Throws Error("NO_TEXT") when the PDF has no extractable text layer.
export async function convertPdfToPptx(buffer) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  const pptx = new pptxgen();
  pptx.author = "PDFConvertMe";
  pptx.layout = "LAYOUT_WIDE";
  let totalChars = 0;

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

    const text = toLines(items).join("\n");
    totalChars += text.replace(/\s/g, "").length;

    const slide = pptx.addSlide();
    slide.addText(text || " ", {
      x: 0.5,
      y: 0.3,
      w: 12.33,
      h: 7.0,
      fontSize: 12,
      align: "left",
      valign: "top"
    });
  }

  if (totalChars === 0) throw new Error("NO_TEXT");
  return pptx.write({ outputType: "nodebuffer" });
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
    const out = await convertPdfToPptx(buffer);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="converted.pptx"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "NO_TEXT") {
      res.status(422).json({
        error: "No extractable text found. The PDF may be scanned or image-only."
      });
      return;
    }
    console.error("PDF→PPTX failed:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
}
