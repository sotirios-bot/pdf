// Serverless conversion endpoint: PDF (raw request body) -> Excel (.xlsx).
//
// Deployed on Vercel as /api/convert. The browser POSTs the raw PDF bytes with
// Content-Type: application/pdf. We extract text with pdf-parse and write each
// detected row/column into an XLSX worksheet using exceljs.
//
// NOTE (v1): This uses a simple whitespace-based column heuristic. It handles
// straightforward, text-based table layouts. TODO: improve table detection
// (e.g. position-based clustering, or a Python service using camelot/pdfplumber)
// and handle scanned/image PDFs via OCR.

import pdf from "pdf-parse";
import ExcelJS from "exceljs";

export const config = {
  api: {
    bodyParser: false // we read the raw stream ourselves
  }
};

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

// Split a text line into columns. Two-or-more spaces (or a tab) separate cells.
function splitRow(line) {
  return line.trim().split(/\t|\s{2,}/).filter((c) => c.length > 0);
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
    const parsed = await pdf(buffer);
    const lines = parsed.text
      .split("\n")
      .map((l) => l.replace(/\s+$/g, ""))
      .filter((l) => l.trim().length > 0);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PDFConvertMe";
    const sheet = workbook.addWorksheet("Sheet1");

    for (const line of lines) {
      sheet.addRow(splitRow(line));
    }

    const out = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="converted.xlsx"');
    res.status(200).send(Buffer.from(out));
  } catch (err) {
    console.error("Conversion failed:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
}
