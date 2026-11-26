// Serverless endpoint: rotate every page of a PDF -> PDF.
// The browser POSTs the raw PDF bytes; the angle comes as a query param,
// e.g. /api/rotate-pdf?angle=90 (90, 180, or 270 degrees clockwise).

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

// Core rotate, exported for testing. Returns a PDF Buffer.
// Throws Error("BAD_ANGLE") if angle is not 90, 180, or 270.
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

  const angle = new URL(req.url, "http://x").searchParams.get("angle") || "";

  try {
    const out = await rotatePdf(buffer, angle);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="rotated.pdf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "BAD_ANGLE") {
      res.status(400).json({ error: "Enter a rotation of 90, 180, or 270 degrees." });
      return;
    }
    console.error("Rotate PDF failed:", err);
    res.status(500).json({ error: "Failed. Make sure the file is a valid PDF." });
  }
}
