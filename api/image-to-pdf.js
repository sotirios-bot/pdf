// Serverless conversion endpoint: image (raw request body) -> PDF.
// Used by /jpg-to-pdf and /png-to-pdf. The browser POSTs the raw image bytes.
// We detect JPEG vs PNG from the magic bytes, embed the image with pdf-lib,
// and fit it onto an A4 page (portrait), preserving aspect ratio.

import { PDFDocument } from "pdf-lib";

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const A4 = { w: 595.28, h: 841.89 }; // points
const MARGIN = 24;

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

function detectType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  )
    return "png";
  return null;
}

// Core conversion, exported for testing. Returns a PDF Buffer.
// Throws Error("BAD_IMAGE") if the bytes aren't a supported JPG/PNG.
export async function imageToPdf(buffer) {
  const type = detectType(buffer);
  if (!type) throw new Error("BAD_IMAGE");

  const pdf = await PDFDocument.create();
  const img =
    type === "jpg" ? await pdf.embedJpg(buffer) : await pdf.embedPng(buffer);

  const page = pdf.addPage([A4.w, A4.h]);
  const maxW = A4.w - MARGIN * 2;
  const maxH = A4.h - MARGIN * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: (A4.w - w) / 2,
    y: (A4.h - h) / 2,
    width: w,
    height: h
  });

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
    const out = await imageToPdf(buffer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="converted.pdf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "BAD_IMAGE") {
      res.status(422).json({ error: "Unsupported or corrupt image. Please upload a JPG or PNG." });
      return;
    }
    console.error("Image→PDF failed:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
}
