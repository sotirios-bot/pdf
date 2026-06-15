// Serverless endpoint: delete pages from a PDF -> PDF.
// The browser POSTs the raw PDF bytes; the pages to remove come as a query
// param, e.g. /api/delete-pdf-pages?pages=2,5-7 (1-based).

import { PDFDocument } from "pdf-lib";

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

// Parse "2, 5-7, 10" into a Set of 1-based page numbers.
export function parsePages(spec) {
  const set = new Set();
  for (const part of String(spec || "").split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(t)) {
      set.add(parseInt(t, 10));
    }
  }
  return set;
}

// Core delete, exported for testing. Returns a PDF Buffer.
// Throws Error("NO_PAGES") if the spec is empty/invalid, or
// Error("ALL_PAGES") if it would remove every page.
export async function deletePages(buffer, spec) {
  const toRemove = parsePages(spec);
  if (toRemove.size === 0) throw new Error("NO_PAGES");
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const count = doc.getPageCount();
  const remaining = [];
  for (let i = 1; i <= count; i++) if (!toRemove.has(i)) remaining.push(i);
  if (remaining.length === 0) throw new Error("ALL_PAGES");
  // Remove from the end so indices stay valid.
  for (let i = count; i >= 1; i--) if (toRemove.has(i)) doc.removePage(i - 1);
  return Buffer.from(await doc.save());
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

  const spec = new URL(req.url, "http://x").searchParams.get("pages") || "";

  try {
    const out = await deletePages(buffer, spec);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="edited.pdf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "NO_PAGES") {
      res.status(400).json({ error: "Enter which pages to delete, e.g. 2, 5-7." });
      return;
    }
    if (err.message === "ALL_PAGES") {
      res.status(400).json({ error: "That would delete every page. Keep at least one." });
      return;
    }
    console.error("Delete pages failed:", err);
    res.status(500).json({ error: "Failed. Make sure the file is a valid PDF." });
  }
}
