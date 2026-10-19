# PLUTUS — Stock Health Dashboard

A futuristic, dark-mode dashboard that turns Yahoo Finance data into plain-English, gamified insights so anyone can understand a company's financial health. **Facts only — it never says buy, sell, or hold.**

## Features
- **Search page:** a large centred search bar with fuzzy, typo-tolerant suggestions (Yahoo search + Fuse.js re-ranking). **Indian listings are favoured**: NSE first, then BSE, each marked with an `IN` tag. Also keyboard navigation and recent searches
- **Company strip:** price, day change, market cap, P/E, 1-year return, dividend yield, and a 52-week range slider
- **Health Scan (gamified):** an overall 0–100 score ring, six "power stats" (Growth, Profitability, Balance Sheet, Price Tag, Stability, Track Record), a radar chart, and 8 achievement badges
- **12 KPI cards:** each has a traffic-light dot and a plain-English ⓘ tooltip
- **7 charts:** price (1Y/5Y), P/E history vs 5-year median, revenue vs net profit, margins, EPS, cash flow, and debt vs equity. A **Yearly / Quarterly** toggle switches the five business charts (last 5 years or last 8 quarters). Each chart has a one-line factual takeaway
- **Peer Arena:** up to 5 similar companies (same market, same currency) from Yahoo's peer suggestions. Shows rank tiles with gold/silver/bronze medals for size, sales growth, profit margin, ROE, debt, P/E and 1-year return, a head-to-head bar chart, and a comparison table. Clear peer gaps are added to Strengths & Weaknesses with a "VS PEERS" tag. *Needs the Cloudflare Worker.*
- **Strengths & Weaknesses:** rule-based, jargon-free statements, each backed by a number
- Indian listings (`.NS` / `.BO`) display amounts in ₹ Crore / Lakh Crore. Banks and insurers are handled differently: debt-to-equity and current-ratio judgments are skipped because borrowing is part of how they operate

## Project structure
```
index.html
css/style.css
js/config.js      ← set WORKER_URL here
js/analysis.js    ← metrics, scores, badges, strengths/weaknesses (pure logic)
js/app.js         ← UI, search, routing, charts
worker/worker.js  ← Cloudflare Worker proxy (not served by GitHub Pages)
```

## Why a proxy is needed
Yahoo Finance has no official free API, and it blocks direct browser requests (CORS). GitHub Pages can only host static files. The free Cloudflare Worker in `worker/worker.js`:
- adds CORS headers
- handles Yahoo's cookie/crumb handshake, which the company profile and key statistics require
- accepts only Yahoo Finance hosts
- caches responses for 10 minutes

If you leave `WORKER_URL` empty, the app falls back to public CORS proxies. These are **unreliable and rate-limited**, so use them for demos only.

## Deploy in about 10 minutes

### 1. Cloudflare Worker (free)
1. Sign up at dash.cloudflare.com, then go to **Workers & Pages → Create → Create Worker**.
2. Name it (for example, `plutus-proxy`) and click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `worker/worker.js`, and click **Deploy**.
4. Copy the URL, for example `https://plutus-proxy.<you>.workers.dev`.
5. To test it, open `https://plutus-proxy.<you>.workers.dev/?url=https%3A%2F%2Fquery2.finance.yahoo.com%2Fv8%2Ffinance%2Fchart%2FAAPL` in a browser. You should see JSON.

### 2. GitHub Pages
1. Create a public repo (for example, `plutus`) and upload all the files.
2. In `js/config.js`, set `WORKER_URL: "https://plutus-proxy.<you>.workers.dev"`.
3. Go to **Settings → Pages → Source: Deploy from a branch → `main` / root**, then save.
4. The site goes live at `https://<user>.github.io/plutus/`.
5. *(Recommended)* In `worker.js`, set `ALLOWED_ORIGINS = ['https://<user>.github.io']` and redeploy, so only your site can use the worker.

### Run locally
```
python -m http.server 8080   # then open http://localhost:8080
```

## How the scores work (all 0–100, linear between thresholds)
| Stat | Inputs | 0 at → 100 at |
|---|---|---|
| Growth | Revenue CAGR; net-profit CAGR (or YoY) | −5% → 15%; −10% → 20% |
| Profitability | Net margin; ROE; operating margin | 0 → 20%; 0 → 22%; 0 → 25% |
| Balance Sheet | Debt/Equity; current ratio; FCF sign (financials: equity/assets) | 2.0× → 0×; 0.8× → 2.0× |
| Price Tag | P/E; P/E ÷ own 5-yr median | 60× → 8×; 1.5 → 0.7 |
| Stability | 1-yr volatility; 1-yr max drawdown | 60% → 15%; −50% → −8% |
| Track Record | % profitable years; % years revenue grew | — |

You can change these thresholds in `js/analysis.js` → `score()`.

## Notes and limitations
- Many Indian companies publish cash flow and balance sheets only half-yearly or yearly, so those quarterly charts may show "No quarterly data published".
- Yahoo's free data usually covers about 4–5 annual periods. Some small caps have gaps, and the UI shows "No data" for those charts instead of guessing.
- The P/E history is calculated as weekly price ÷ the latest reported annual diluted EPS. It is hidden when the statement currency differs from the trading currency (for example, ADRs).
- Yahoo's endpoints are unofficial and can change without notice.
- For educational use only. This is not investment advice.
