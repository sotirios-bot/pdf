// Serverless endpoint: split a PDF (raw request body) -> ZIP of single pages.
// The browser POSTs the raw PDF bytes; we produce one PDF per page with
// pdf-lib and bundle them into a ZIP with jszip.

import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

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

// Core split, exported for testing. Returns a ZIP Buffer.
export async function splitPdf(buffer) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const count = src.getPageCount();
  const zip = new JSZip();
  const pad = String(count).length;
  for (let i = 0; i < count; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    const bytes = await doc.save();
    zip.file(`page-${String(i + 1).padStart(pad, "0")}.pdf`, bytes);
  }
  return zip.generateAsync({ type: "nodebuffer" });
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
    const out = await splitPdf(buffer);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="split-pages.zip"');
    res.status(200).send(out);
  } catch (err) {
    console.error("Split failed:", err);
    res.status(500).json({ error: "Split failed. Make sure the file is a valid PDF." });
  }
}
