/* ============================================================
   PLUTUS — configuration
   ------------------------------------------------------------
   Yahoo Finance blocks direct browser calls (CORS), so requests
   go through your Cloudflare Worker (see /worker/worker.js).
   If WORKER_URL is empty, the app falls back to public CORS
   proxies — unreliable, demo only.
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
