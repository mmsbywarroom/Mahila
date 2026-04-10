# GitHub + Render + custom domain

## 1. Push code to GitHub

From the **`project`** folder (this repo root):

```bash
cd project
git init
git add .
git commit -m "Initial commit: Sakhi web + API"
git branch -M main
git remote add origin https://github.com/mmsbywarroom/sakhi-mahila.git
git push -u origin main
```

If `remote` already exists: `git remote set-url origin https://github.com/mmsbywarroom/sakhi-mahila.git`

GitHub login: browser (HTTPS) or SSH key. `.env` is **not** pushed (gitignored).

---

## 2. Render — Blueprint (recommended)

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect **`mmsbywarroom/sakhi-mahila`**, branch `main`.
3. Render reads **`render.yaml`** and creates:
   - **sakhi-api** (Node API from `server/`)
   - **sakhi-web** (static Vite build from repo root)

---

## 3. Environment variables (important)

### sakhi-api (Web Service)

| Key | Value |
|-----|--------|
| `DATABASE_URL` | `postgresql://...?sslmode=require` |
| `DATABASE_SSL` | `true` |
| `API_BEARER_TOKEN` | Long random secret (same as below) |

Optional: `AWS_*`, `GOOGLE_SERVICE_ACCOUNT_KEY`, OCR vars.

**RDS:** Security group must allow **PostgreSQL 5432** from the internet (quick test) or from [Render outbound IPs](https://render.com/docs/outbound-ip-addresses) for production.

### sakhi-web (Static Site)

Vite bakes env at **build time**. Set these **before** the static site build succeeds:

| Key | Value |
|-----|--------|
| `VITE_API_URL` | `https://sakhi-api.onrender.com` (your real API URL from Render) |
| `VITE_API_BEARER_TOKEN` | **Exactly** the same as `API_BEARER_TOKEN` on sakhi-api |

**Order:** Deploy **sakhi-api** first → copy its URL → set **sakhi-web** env → **Manual Deploy** on sakhi-web (or push a commit) so it rebuilds with the correct API URL.

---

## 4. Preview URL (application)

- **Frontend:** `https://sakhi-web.onrender.com` (name may match what you set in `render.yaml`).
- **API:** `https://sakhi-api.onrender.com` — health: `GET /health`.

Open the **static site** URL in the browser; the UI calls `VITE_API_URL` from the build.

---

## 5. Custom domain

For **each** service (API + static site) you want on your domain:

1. Render → service → **Settings** → **Custom Domains** → **Add** → enter e.g. `app.yourdomain.com` (frontend) and optionally `api.yourdomain.com` (API).
2. Render shows **DNS records** (usually **CNAME** to `xxx.onrender.com`).
3. At your domain registrar (GoDaddy, Cloudflare, etc.) add those records.
4. After SSL verifies, update **`VITE_API_URL`** on **sakhi-web** to your API public URL (e.g. `https://api.yourdomain.com`), then **redeploy** sakhi-web so the build embeds the new API URL.

**Tip:** Apex domain (`yourdomain.com`) often needs **ALIAS/ANAME** at DNS provider; `www` is easier with CNAME.

---

## 6. Troubleshooting

- **401 / Unauthorized:** `VITE_API_BEARER_TOKEN` and `API_BEARER_TOKEN` must match; rebuild static site after changing.
- **CORS / blocked:** API uses permissive CORS; if issues persist, check browser console and API URL (https, no typo).
- **DB connection failed on Render:** RDS security group + `sslmode=require` + `DATABASE_SSL=true`.
