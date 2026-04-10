/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base, or `same-origin` when Netlify proxies /auth and /upload to EB (see netlify.toml). */
  readonly VITE_API_URL: string;
  readonly VITE_API_BEARER_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
