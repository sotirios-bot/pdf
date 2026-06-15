// Serverless endpoint: merge several PDFs (multipart upload) -> one PDF.
// The browser POSTs a multipart/form-data body with multiple "files" fields,
// in the order selected. We parse with busboy and concatenate with pdf-lib.

import busboy from "busboy";
import { PDFDocument } from "pdf-lib";

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 40 * 1024 * 1024; // 40 MB total (merging multiple files)

function readFiles(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES } });
    const files = [];
    let total = 0;
    let tooBig = false;
    bb.on("file", (_name, stream) => {
      const chunks = [];
      stream.on("data", (c) => {
        total += c.length;
        if (total > MAX_BYTES) tooBig = true;
        chunks.push(c);
      });
      stream.on("limit", () => {
        tooBig = true;
      });
      stream.on("end", () => files.push(Buffer.concat(chunks)));
    });
    bb.on("close", () => (tooBig ? reject(new Error("FILE_TOO_LARGE")) : resolve(files)));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

// Core merge, exported for testing. Returns a PDF Buffer.
export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return Buffer.from(await out.save());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let files;
  try {
    files = await readFiles(req);
  } catch (err) {
    const code = err.message === "FILE_TOO_LARGE" ? 413 : 400;
    res.status(code).json({ error: err.message });
    return;
  }
  if (!files || files.length < 2) {
    res.status(400).json({ error: "Please upload at least two PDF files." });
    return;
  }

  try {
    const out = await mergePdfs(files);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="merged.pdf"');
    res.status(200).send(out);
  } catch (err) {
    console.error("Merge failed:", err);
    res.status(500).json({ error: "Merge failed. Make sure every file is a valid PDF." });
  }
}
