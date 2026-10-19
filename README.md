# PLUTUS — Your AI Stock Analysis Companion

A futuristic, dark-mode dashboard that turns Yahoo Finance data into plain-English, gamified insights. **Facts only — no buy/sell/hold calls.** Fully responsive for desktop, tablet and mobile.

## Dashboard sections (in order)
1. **About the Company** — business summary (with Read more), sector, industry, HQ, employees, website
2. **Health Scan** — 0–100 score ring, six power stats, radar, 8 achievement badges
3. **Key Numbers** — 12 KPI cards with tap/hover explanations
4. **Trajectory** — price (1Y/5Y), P/E history, and Yearly/Quarterly business charts
5. **Peer Arena** — medals, head-to-head chart and comparison table vs similar companies
6. **Strengths & Weaknesses** — plain-English facts, including "VS PEERS" items

Search favours Indian listings (NSE, then BSE), marked with an `IN` tag.

## Structure
```
index.html
css/style.css
js/config.js      ← WORKER_URL
js/analysis.js    ← metrics, scores, badges, peers, strengths/weaknesses
js/app.js         ← UI, search, routing, charts
worker/worker.js  ← Cloudflare Worker (deploy on Cloudflare, not GitHub)
```

## Deploy
1. **Worker:** Cloudflare → Workers → Create → Hello World → Edit code → paste `worker/worker.js` → Deploy.
2. Put the Worker URL in `js/config.js` (`WORKER_URL`).
3. **GitHub Pages:** upload the folder contents (with `index.html` at the top level) → Settings → Pages → Deploy from branch `main` / root.
4. *(Recommended)* Set `ALLOWED_ORIGINS = ['https://<user>.github.io']` in the Worker and redeploy.

Run locally: `python -m http.server 8080`.

## Notes
- Yahoo's free data covers about 4–5 annual periods and up to 8 quarters. Many Indian companies publish cash flow and balance sheets only half-yearly or yearly, so those quarterly charts may say "No quarterly data published".
- Yahoo's endpoints are unofficial and can change without notice.
- Educational use only. Not investment advice.
