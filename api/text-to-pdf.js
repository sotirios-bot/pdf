// Serverless endpoint: plain text (raw request body) -> PDF.
//
// Deployed on Vercel as /api/text-to-pdf. The browser POSTs the raw .txt bytes
// (UTF-8). We lay the text onto A4 pages with pdf-lib, word-wrapping each line
// to the page width and paginating as needed.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const PAGE = { w: 595.28, h: 841.89 }; // A4 points
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = FONT_SIZE * 1.45;

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

// The standard fonts use WinAnsi (CP1252) encoding, which can't draw arbitrary
// Unicode. Map common "smart" punctuation to ASCII and replace anything else
// outside the encodable range so drawText never throws.
const CHAR_MAP = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", "•": "-",
  " ": " ", "\t": "    "
};
export function sanitize(s) {
  let out = "";
  for (const ch of String(s)) {
    if (CHAR_MAP[ch] != null) {
      out += CHAR_MAP[ch];
      continue;
    }
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else out += "?";
  }
  return out;
}

// Wrap a single logical line to fit `maxWidth` at the given font/size.
function wrapLine(line, font, size, maxWidth) {
  if (line === "") return [""];
  const words = line.split(/ /);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur === "" ? word : cur + " " + word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || cur === "") {
      // If a single word is too wide, hard-break it by character.
      if (cur === "" && font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const c of word) {
          if (font.widthOfTextAtSize(chunk + c, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = c;
          } else {
            chunk += c;
          }
        }
        cur = chunk;
      } else {
        cur = candidate;
      }
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  lines.push(cur);
  return lines;
}

// Core conversion, exported for testing. Returns a PDF Buffer.
// Throws Error("EMPTY") when the input has no text.
export async function textToPdf(buffer) {
  const raw = buffer.toString("utf8");
  if (!raw.trim()) throw new Error("EMPTY");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const maxWidth = PAGE.w - MARGIN * 2;

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;

  const inputLines = raw.replace(/\r\n?/g, "\n").split("\n");
  for (const inputLine of inputLines) {
    const wrapped = wrapLine(sanitize(inputLine), font, FONT_SIZE, maxWidth);
    for (const wl of wrapped) {
      if (y - LINE_HEIGHT < MARGIN) {
        page = pdf.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - MARGIN;
      }
      if (wl) {
        page.drawText(wl, { x: MARGIN, y: y - FONT_SIZE, size: FONT_SIZE, font, color: rgb(0.1, 0.1, 0.1) });
      }
      y -= LINE_HEIGHT;
    }
  }

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
    const out = await textToPdf(buffer);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="converted.pdf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "EMPTY") {
      res.status(400).json({ error: "The text file is empty." });
      return;
    }
    console.error("Text→PDF failed:", err);
    res.status(500).json({ error: "Conversion failed." });
  }
}
