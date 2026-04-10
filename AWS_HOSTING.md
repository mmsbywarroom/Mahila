# AWS hosting (Elastic Beanstalk API + S3 frontend)

Render ki jagah yeh pattern use karo: **API = Elastic Beanstalk**, **React build = S3 (CloudFront optional)**. RDS tum pehle se use kar rahe ho.

## A) Backend — Elastic Beanstalk (Node.js)

1. **Application** banao (jaise `women-registration-program-api`).
2. **Create environment** → **Web server environment** → Platform: **Node.js** (20+).
3. **Application code:** Git se ya **local zip** — deploy **sirf `server/` folder** ka content (root me `package.json` ho).
4. **Environment properties** (Configuration → Software → Environment properties):
   - `DATABASE_URL` — RDS URL + `?sslmode=require`
   - `DATABASE_SSL` = `true`
   - `API_BEARER_TOKEN` — secret
   - `PORT` — **mat set karo**; EB khud deta hai (code me `process.env.PORT` use ho raha hai)
   - Optional: `AWS_*`, OCR keys

5. Repo me `server/.ebextensions/01_build.config` + `server/Procfile` se deploy par `npm run build` chalega, phir `npm start`.

6. **RDS security group:** Inbound **5432** allow karo EB instances ke liye (ya test ke liye `0.0.0.0/0` — production me tight karo).

7. Environment URL milega, jaise `xxx.elasticbeanstalk.com` — yeh tumhara **API base URL** hai.

## B) Frontend — S3 static hosting

1. Local: `VITE_API_URL=https://<eb-api-url>` aur `VITE_API_BEARER_TOKEN=...` set karke `npm run build` (repo **root** se).
2. **S3** bucket → **Static website hosting** enable → `index.html`, error doc `index.html` (SPA ke liye).
3. `dist/` ka content bucket me upload karo.
4. **Bucket policy** se public read (sirf `dist` assets) — ya **CloudFront** + OAC (recommended).

## C) Custom domain

- **API:** Route 53 / registrar → EB environment ke **CNAME** / load balancer pe point karo (EB docs).
- **Frontend:** CloudFront ya S3 website endpoint par domain (CNAME).

## Elastic Beanstalk vs simple EC2

- **EB** = load balancer + scaling + deploy rollouts — thoda setup, zyada “managed”.
- **EC2 + PM2 + nginx** = ek VM par `server` chalao — seedha, tum khud maintain karoge.

Agar sirf **ek chhoti team** hai, **Lightsail** (Node blueprint) bhi option hai.
