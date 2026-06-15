// Serverless endpoint: compress a PDF (raw request body) -> smaller PDF.
// Uses pdf-lib to re-serialize the document with object streams and without
// re-adding metadata, which shrinks PDFs that aren't already optimized.
// (Image-heavy or already-optimized PDFs shrink less — TODO: add image
// downsampling / a Ghostscript service for stronger compression.)

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

// Core compression, exported for testing. Returns a PDF Buffer — never larger
// than the input (falls back to the original if re-saving doesn't help).
export async function compressPdf(buffer) {
  const doc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false
  });
  const out = await doc.save({ useObjectStreams: true });
  return Buffer.from(out.length < buffer.length ? out : buffer);
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
    const out = await compressPdf(buffer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="compressed.pdf"');
    res.status(200).send(out);
  } catch (err) {
    console.error("Compress failed:", err);
    res.status(500).json({ error: "Compression failed. Make sure the file is a valid PDF." });
  }
}
