// Serverless endpoint: PDF (raw request body) -> AutoCAD DXF (.dxf).
//
// Deployed on Vercel as /api/pdf-to-autocad. The browser POSTs the raw PDF
// bytes. We use PDF.js (pdfjs-dist) to read the page operator list, tracking
// the current transformation matrix (CTM) so every path is mapped into page
// coordinates, then emit the vector geometry as DXF POLYLINE/LINE entities and
// the text as DXF TEXT entities.
//
// Output is DXF (the open ASCII CAD format AutoCAD opens natively) rather than
// DWG, which is a proprietary binary format. Works on vector/line-art PDFs;
// scanned/raster PDFs have no vector layer and return a clear error.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const OPS = pdfjsLib.OPS;

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_POINTS = 400000; // safety cap on emitted geometry
const BEZIER_STEPS = 8; // segments per flattened cubic curve

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

// --- 2D affine matrix helpers (PDF convention: x'=a*x+c*y+e, y'=b*x+d*y+f) ---
const IDENTITY = [1, 0, 0, 1, 0, 0];
// Compose A∘B: apply B first, then A.
function mul(A, B) {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ];
}
function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const round = (n) => Math.round(n * 10000) / 10000;

// Flatten a cubic Bézier (p0..p3) into BEZIER_STEPS line points (excludes p0).
function bezier(p0, p1, p2, p3, out) {
  for (let i = 1; i <= BEZIER_STEPS; i++) {
    const t = i / BEZIER_STEPS;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]
    ]);
  }
}

// Walk one constructPath op into subpaths of page-space points, applying ctm.
// Each subpath: { pts: [[x,y]...], closed: bool }. Appends to `subpaths`.
function constructPath(ops, coords, ctm, subpaths, counter) {
  let ci = 0;
  let cur = null; // current subpath
  let pt = [0, 0]; // current point (page space)
  const start = () => {
    cur = { pts: [], closed: false };
    subpaths.push(cur);
  };
  for (const op of ops) {
    switch (op) {
      case OPS.moveTo: {
        pt = apply(ctm, coords[ci], coords[ci + 1]);
        ci += 2;
        start();
        cur.pts.push(pt);
        break;
      }
      case OPS.lineTo: {
        pt = apply(ctm, coords[ci], coords[ci + 1]);
        ci += 2;
        if (!cur) start();
        cur.pts.push(pt);
        break;
      }
      case OPS.curveTo: {
        const p1 = apply(ctm, coords[ci], coords[ci + 1]);
        const p2 = apply(ctm, coords[ci + 2], coords[ci + 3]);
        const p3 = apply(ctm, coords[ci + 4], coords[ci + 5]);
        ci += 6;
        if (!cur) start(), cur.pts.push(pt);
        bezier(pt, p1, p2, p3, cur.pts);
        pt = p3;
        break;
      }
      case OPS.curveTo2: {
        // "v": first control point = current point
        const p2 = apply(ctm, coords[ci], coords[ci + 1]);
        const p3 = apply(ctm, coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (!cur) start(), cur.pts.push(pt);
        bezier(pt, pt, p2, p3, cur.pts);
        pt = p3;
        break;
      }
      case OPS.curveTo3: {
        // "y": second control point = end point
        const p1 = apply(ctm, coords[ci], coords[ci + 1]);
        const p3 = apply(ctm, coords[ci + 2], coords[ci + 3]);
        ci += 4;
        if (!cur) start(), cur.pts.push(pt);
        bezier(pt, p1, p3, p3, cur.pts);
        pt = p3;
        break;
      }
      case OPS.rectangle: {
        const x = coords[ci];
        const y = coords[ci + 1];
        const w = coords[ci + 2];
        const h = coords[ci + 3];
        ci += 4;
        const r = { pts: [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)], closed: true };
        subpaths.push(r);
        cur = null;
        break;
      }
      case OPS.closePath: {
        if (cur) cur.closed = true;
        break;
      }
      default:
        break;
    }
    if (counter.n > MAX_POINTS) break;
  }
}

// Core conversion, exported for testing. Returns a DXF text Buffer.
// Throws Error("NO_CONTENT") when the PDF has no vector geometry or text.
export async function pdfToDxf(buffer) {
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  const entities = []; // DXF entity strings
  const counter = { n: 0 };
  let yCursor = 0; // stack multipage drawings downward to avoid overlap

  const addPolyline = (pts, closed) => {
    if (pts.length < 2) return;
    counter.n += pts.length;
    if (pts.length === 2) {
      entities.push(
        `0\nLINE\n8\n0\n10\n${round(pts[0][0])}\n20\n${round(pts[0][1])}\n30\n0.0\n` +
          `11\n${round(pts[1][0])}\n21\n${round(pts[1][1])}\n31\n0.0`
      );
      return;
    }
    let s = `0\nPOLYLINE\n8\n0\n66\n1\n70\n${closed ? 1 : 0}\n10\n0.0\n20\n0.0\n30\n0.0`;
    for (const [x, y] of pts) {
      s += `\n0\nVERTEX\n8\n0\n10\n${round(x)}\n20\n${round(y)}\n30\n0.0`;
    }
    s += `\n0\nSEQEND\n8\n0`;
    entities.push(s);
  };

  const addText = (str, x, y, height) => {
    const clean = String(str).replace(/[\r\n]+/g, " ").replace(/[\x00-\x1f]/g, "").trim();
    if (!clean) return;
    counter.n += 1;
    entities.push(
      `0\nTEXT\n8\n0\n10\n${round(x)}\n20\n${round(y)}\n30\n0.0\n40\n${round(Math.max(height, 1))}\n1\n${clean}`
    );
  };

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vb = page.getViewport({ scale: 1 }).viewBox; // [x0,y0,x1,y1]
    const pageHeight = vb[3] - vb[1];
    const yOff = -yCursor; // shift this page down
    const base = [1, 0, 0, 1, 0, yOff]; // page-space -> stacked-space

    // ----- vector geometry from the operator list -----
    const opList = await page.getOperatorList();
    const ctmStack = [];
    let ctm = mul(base, IDENTITY);
    for (let i = 0; i < opList.fnArray.length && counter.n <= MAX_POINTS; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.save) {
        ctmStack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        if (ctmStack.length) ctm = ctmStack.pop();
      } else if (fn === OPS.transform) {
        ctm = mul(ctm, args);
      } else if (fn === OPS.constructPath) {
        const subpaths = [];
        constructPath(args[0], args[1], ctm, subpaths, counter);
        for (const sp of subpaths) {
          const pts = sp.pts.slice();
          if (sp.closed && pts.length > 2) pts.push(pts[0]);
          addPolyline(pts, sp.closed);
        }
      }
    }

    // ----- text from the text-content layer (already in page space) -----
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5] + yOff;
      const h = it.height || Math.abs(it.transform[3]) || 10;
      addText(it.str, x, y, h);
    }

    yCursor += pageHeight + 40; // gap between stacked pages
  }

  if (!entities.length) throw new Error("NO_CONTENT");

  const dxf =
    "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n" +
    "0\nSECTION\n2\nENTITIES\n" +
    entities.join("\n") +
    "\n0\nENDSEC\n0\nEOF\n";
  return Buffer.from(dxf, "utf8");
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
    const out = await pdfToDxf(buffer);
    res.setHeader("Content-Type", "image/vnd.dxf");
    res.setHeader("Content-Disposition", 'attachment; filename="converted.dxf"');
    res.status(200).send(out);
  } catch (err) {
    if (err.message === "NO_CONTENT") {
      res.status(422).json({
        error: "No vector content found. The PDF may be scanned or image-only, which can't be converted to CAD."
      });
      return;
    }
    console.error("PDF→DXF failed:", err);
    res.status(500).json({ error: "Conversion failed. Make sure the file is a valid PDF." });
  }
}
