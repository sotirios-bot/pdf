// Serverless endpoint: flatten a PDF's interactive form fields -> PDF.
// The browser POSTs the raw PDF bytes. We merge the current appearances of
// AcroForm fields into the page content so the PDF looks the same everywhere
// and the fields can no longer be edited or filled in. PDFs without a form are
// returned re-saved and unchanged.

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

// Core flatten, exported for testing. Returns a PDF Buffer.
export async function flattenPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  try {
    const form = doc.getForm();
    // updateFieldAppearances keeps filled-in values visible before flattening.
    try {
      form.updateFieldAppearances();
    } catch (_) {
      /* some fonts can't be refreshed; flatten with existing appearances */
    }
    form.flatten();
  } catch (_) {
    // No AcroForm (or an unflattenable one) — return the document re-saved.
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

  try {
    const out = await flattenPdf(buffer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="flattened.pdf"');
    res.status(200).send(out);
  } catch (err) {
    console.error("Flatten PDF failed:", err);
    res.status(500).json({ error: "Failed. Make sure the file is a valid PDF." });
  }
}
