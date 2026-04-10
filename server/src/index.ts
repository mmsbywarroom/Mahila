import "dotenv/config";
import { Buffer } from "node:buffer";
import cors from "cors";
import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { handleAuthRequest } from "./authHandler.js";

if (typeof globalThis.btoa === "undefined") {
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = (s: string) =>
    Buffer.from(s, "binary").toString("base64");
}

const PORT = Number(process.env.PORT) || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const API_BEARER_TOKEN = process.env.API_BEARER_TOKEN;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

/** Avoid sslmode in URL + ssl object together (can still trigger "self signed certificate in certificate chain" with pg). */
function stripSslQueryParams(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("sslrootcert");
    u.searchParams.delete("sslcert");
    u.searchParams.delete("sslkey");
    let s = u.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s;
  } catch {
    return connectionString
      .replace(/[?&]sslmode=[^&]*/gi, "")
      .replace(/[?&]sslrootcert=[^&]*/gi, "")
      .replace(/\?&/g, "?");
  }
}

// RDS: TLS required; relax verification unless you bundle RDS CA (rejectUnauthorized: false).
const useSsl =
  process.env.DATABASE_SSL === "true" ||
  /\.rds\.amazonaws\.com/i.test(DATABASE_URL) ||
  /sslmode=(require|verify-full|verify-ca)/i.test(DATABASE_URL);

const pool = new Pool({
  connectionString: useSsl ? stripSslQueryParams(DATABASE_URL) : DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

function requireBearer(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!API_BEARER_TOKEN) {
    return next();
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== API_BEARER_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  return next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/** Browser opens / — this service is API-only; React app is a separate Render Static Site. */
app.get("/", (_req, res) => {
  res.type("text/html; charset=utf-8").send(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Women Registration Program API</title></head><body>
<h1>Women Registration Program API</h1>
<p>Yeh sirf <strong>backend</strong> hai. React website alag <strong>Static Site</strong> par deploy karo.</p>
<p><a href="/health">GET /health</a> — API check</p>
</body></html>`
  );
});

async function toWebRequest(req: express.Request): Promise<Request> {
  const host = req.get("host") || "localhost";
  const proto = req.protocol || "http";
  const url = new URL(req.originalUrl, `${proto}://${host}`);
  const body =
    req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS"
      ? undefined
      : JSON.stringify(req.body ?? {});
  return new Request(url.toString(), {
    method: req.method,
    headers: new Headers(req.headers as HeadersInit),
    body,
  });
}

app.all("/auth", requireBearer, async (req, res) => {
  try {
    const webReq = await toWebRequest(req);
    const out = await handleAuthRequest(webReq, pool);
    res.status(out.status);
    out.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = Buffer.from(await out.arrayBuffer());
    res.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ success: false, message: msg });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const s3Bucket = process.env.AWS_S3_BUCKET;
const s3Region = process.env.AWS_REGION || "ap-south-1";
const s3PublicBase = process.env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/$/, "");

const s3 =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? new S3Client({
        region: s3Region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      })
    : null;

app.post("/upload", requireBearer, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "file required" });
    }
    const prefix = typeof req.body?.path === "string" ? req.body.path.replace(/^\//, "").replace(/\.\./g, "") : "uploads";
    const ext = req.file.originalname.split(".").pop() || "bin";
    const key = `${prefix}/${randomUUID()}.${ext}`;

    if (s3 && s3Bucket) {
      await s3.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype || "application/octet-stream",
        })
      );
      const url = s3PublicBase
        ? `${s3PublicBase}/${key}`
        : `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`;
      return res.json({ success: true, url });
    }

    return res.status(503).json({
      success: false,
      message:
        "S3 not configured: set AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (and optional AWS_S3_PUBLIC_BASE_URL for CloudFront).",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ success: false, message: msg });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
