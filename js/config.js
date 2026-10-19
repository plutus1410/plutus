/* ============================================================
   PLUTUS — configuration
   ------------------------------------------------------------
   Yahoo Finance has no official public API and blocks direct
   browser calls (CORS). GitHub Pages can only host static files,
   so requests are routed through a proxy.

   RECOMMENDED: deploy /worker/worker.js to Cloudflare Workers
   (free tier, ~2 minutes — see README) and paste its URL below.
   The worker handles CORS + Yahoo's cookie/crumb handshake, which
   is required for the company-profile & key-statistics data.

   If WORKER_URL is empty, the app falls back to public CORS
   proxies. Those are rate-limited and unreliable, so treat them
   as a demo mode only.
   ============================================================ */
window.APP_CONFIG = {
 WORKER_URL: "https://plutus-proxy.plutus1410.workers.dev",

  PUBLIC_PROXIES: [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?url="
  ],

  CACHE_MINUTES: 15,      // browser-side cache per Yahoo response
  REQUEST_TIMEOUT_MS: 15000
};
