// Serverless endpoint: PDF (raw request body) -> plain text (.txt).
//
// Deployed on Vercel as /api/pdf-to-text. The browser POSTs the raw PDF bytes.
// We use PDF.js (pdfjs-dist) to read every text fragment WITH its position,
// then reconstruct reading order line by line (group by Y, sort by X).
//
// Works on digital/text-based PDFs. Scanned (image-only) PDFs have no text
// layer and return a clear error.

import { createRequire } from "node:module";

// pdfjs-dist v3 legacy build is the CommonJS bundle that runs in Node without a
// DOM/worker. Load it via createRequire to avoid ESM/CJS interop pitfalls.
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

// Core extraction, exported for testing. Returns a UTF-8 text Buffer.
// Throws Error("NO_TEXT") when the PDF has no extractable text layer.
export async function pdfToText(buffer) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false, // hardening: never eval content from the PDF
    useSystemFonts: true
  }).promise;

  const pages = [];
  let totalChars = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str != null)
      .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str }));

    // Group fragments into lines by Y (PDF origin is bottom-left, larger Y = higher).
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let cur = null;
    const tol = 3;
    for (const it of sorted) {
      if (cur && Math.abs(it.y - cur.y) <= tol) {
        cur.items.push(it);
      } else {
        cur = { y: it.y, items: [it] };
        lines.push(cur);
      }
    }

    const text = lines
      .map((l) =>
        l.items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join("")
          .replace(/\s+$/, "")
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");

    if (text.trim()) totalChars += text.trim().length;
    pages.push(text);
  }

  if (totalChars === 0) throw new Error("NO_TEXT");
  // Separate pages with a blank line; trim leading/trailing whitespace.
  const out = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return Buffer.from(out, "utf8");
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
    const out = await pdfToText(buffer);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="converted.txt"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "NO_TEXT") {
      res.status(422).json({
        error: "No extractable text found. The PDF may be scanned or image-only."
      });
      return;
    }
    console.error("PDF→text failed:", err);
    res.status(500).json({ error: "Conversion failed. Make sure the file is a valid PDF." });
  }
}
