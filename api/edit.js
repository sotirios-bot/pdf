// Consolidated serverless endpoint for single-file PDF edit operations, so the
// deployment stays under the platform's per-deployment function limit.
// Dispatches on ?op=  — rotate | flatten | delete | compress.
// The browser POSTs the raw PDF bytes; op-specific params come as query params:
//   /api/edit?op=rotate&angle=90
//   /api/edit?op=delete&pages=2,5-7
//   /api/edit?op=flatten
//   /api/edit?op=compress

import { PDFDocument, degrees } from "pdf-lib";

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

// ----- rotate -----
export async function rotatePdf(buffer, angleRaw) {
  const angle = parseInt(String(angleRaw), 10);
  if (![90, 180, 270].includes(angle)) throw new Error("BAD_ANGLE");
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + angle) % 360));
  }
  return Buffer.from(await doc.save());
}

// ----- flatten -----
export async function flattenPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  try {
    const form = doc.getForm();
    try {
      form.updateFieldAppearances();
    } catch (_) {
      /* some fonts can't be refreshed; flatten with existing appearances */
    }
    form.flatten();
  } catch (_) {
    /* no AcroForm (or an unflattenable one) — return the document re-saved */
  }
  return Buffer.from(await doc.save());
}

// ----- compress -----
export async function compressPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const out = await doc.save({ useObjectStreams: true });
  return Buffer.from(out.length < buffer.length ? out : buffer);
}

// ----- delete pages -----
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
export async function deletePages(buffer, spec) {
  const toRemove = parsePages(spec);
  if (toRemove.size === 0) throw new Error("NO_PAGES");
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const count = doc.getPageCount();
  const remaining = [];
  for (let i = 1; i <= count; i++) if (!toRemove.has(i)) remaining.push(i);
  if (remaining.length === 0) throw new Error("ALL_PAGES");
  for (let i = count; i >= 1; i--) if (toRemove.has(i)) doc.removePage(i - 1);
  return Buffer.from(await doc.save());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const params = new URL(req.url, "http://x").searchParams;
  const op = params.get("op") || "";
  if (!["rotate", "flatten", "compress", "delete"].includes(op)) {
    res.status(400).json({ error: "Unknown operation" });
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
    let out;
    if (op === "rotate") out = await rotatePdf(buffer, params.get("angle") || "");
    else if (op === "flatten") out = await flattenPdf(buffer);
    else if (op === "compress") out = await compressPdf(buffer);
    else out = await deletePages(buffer, params.get("pages") || "");

    const name = { rotate: "rotated", flatten: "flattened", compress: "compressed", delete: "edited" }[op];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "BAD_ANGLE") {
      res.status(400).json({ error: "Enter a rotation of 90, 180, or 270 degrees." });
      return;
    }
    if (err.message === "NO_PAGES") {
      res.status(400).json({ error: "Enter which pages to delete, e.g. 2, 5-7." });
      return;
    }
    if (err.message === "ALL_PAGES") {
      res.status(400).json({ error: "That would delete every page. Keep at least one." });
      return;
    }
    console.error(`Edit op '${op}' failed:`, err);
    res.status(500).json({ error: "Failed. Make sure the file is a valid PDF." });
  }
}
