// Global "files downloaded" counter, backed by Upstash Redis / Vercel KV (REST).
//
//   GET  /api/counter  -> { count }            current total
//   POST /api/counter  -> { count }            after an atomic increment
//
// Configure via env vars (either naming works):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (Upstash)
//   KV_REST_API_URL        / KV_REST_API_TOKEN          (Vercel KV)
//
// If no store is configured (or it errors), responds { count: null } so the
// front-end simply hides the counter instead of breaking.

const KEY = "pdfconvertme:downloads";
const BASE = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(command) {
  const res = await fetch(`${BASE}/${command}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!BASE || !TOKEN) {
    res.status(200).json({ count: null, configured: false });
    return;
  }

  try {
    let count;
    if (req.method === "POST") {
      count = await redis(`incr/${KEY}`);
    } else {
      const v = await redis(`get/${KEY}`);
      count = v == null ? 0 : Number(v);
    }
    res.status(200).json({ count: Number(count) || 0, configured: true });
  } catch (err) {
    console.error("counter error:", err);
    res.status(200).json({ count: null, configured: false });
  }
}
