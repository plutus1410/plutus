/* ============================================================
   PLUTUS — UI, data fetching, routing, charts
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const A = window.Analysis;
  const { fmtMoney, fmtPrice, fmtPct, fmtX, isNum } = A;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;

  const state = { charts: [], lastHits: {}, model: null };

  /* ====================== DATA LAYER ====================== */
  const YH = 'https://query2.finance.yahoo.com';
  const ttl = (CFG.CACHE_MINUTES || 15) * 60e3;

  function cacheGet(k) {
    try { const x = JSON.parse(sessionStorage.getItem(k)); if (x && Date.now() - x.t < ttl) return x.d; } catch (e) { /* ignore */ }
    return null;
  }
  function cacheSet(k, d) { try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* quota */ } }

  async function yfetch(url) {
    const key = 'yf:' + url;
    const hit = cacheGet(key); if (hit) return hit;
    const routes = CFG.WORKER_URL
      ? [CFG.WORKER_URL.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url)]
      : (CFG.PUBLIC_PROXIES || []).map((p) => p + encodeURIComponent(url));
    let lastErr = new Error('No proxy configured');
    for (const r of routes) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CFG.REQUEST_TIMEOUT_MS || 15000);
      try {
        const res = await fetch(r, { signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cacheSet(key, data);
        return data;
      } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }

  const Yahoo = {
    search: (q) => yfetch(`${YH}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=true&region=IN&lang=en-IN`),
    recs: (s) => yfetch(`${YH}/v6/finance/recommendationsbysymbol/${encodeURIComponent(s)}`),
    chart: (s, range, interval) => yfetch(`${YH}/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`),
    timeseries: (s) => {
      const day = 86400;
      const p2 = Math.floor(Date.now() / 1000 / day) * day + day;
      const p1 = p2 - 10 * 365 * day;
      return yfetch(`${YH}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(s)}?symbol=${encodeURIComponent(s)}&type=${A.TIMESERIES_TYPES.join(',')}&period1=${p1}&period2=${p2}&merge=false`);
    },
    summary: (s) => yfetch(`${YH}/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=price,summaryDetail,defaultKeyStatistics,financialData,assetProfile`)
  };

  /* ====================== FUZZY SEARCH ====================== */
  const RECENT_KEY = 'plutus:recent';
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } };
  const pushRecent = (it) => {
    const r = getRecent().filter((x) => x.symbol !== it.symbol); r.unshift(it);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 6))); } catch (e) { /* ignore */ }
  };
  const isIndian = (sym) => /\.(NS|BO)$/.test(sym || '');

  function highlight(text, q) {
    const t = esc(text); if (!q) return t;
    const words = q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return t;
    return t.replace(new RegExp('(' + words.join('|') + ')', 'ig'), '<mark>$1</mark>');
  }

  function attachSearch(input, list) {
    let items = [], active = -1, timer = null, seq = 0, header = '';

    const open = () => list.classList.add('open');
    const close = () => { list.classList.remove('open'); active = -1; };

    function renderItems(q) {
      if (!items.length) { list.innerHTML = `<li class="s-info">No listed companies match “${esc(q)}”. Check the spelling or try the ticker.</li>`; open(); return; }
      list.innerHTML = (header ? `<li class="s-head">${header}</li>` : '') + items.map((it, i) =>
        `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">
           <span class="s-sym">${esc(it.symbol)}</span>
           <span class="s-name">${highlight(it.name, q)}</span>
           <span class="s-ex">${isIndian(it.symbol) ? '<b class="in-tag">IN</b>' : ''}${esc(it.exch)}</span>
         </li>`).join('');
      open();
      const a = list.querySelector('li.active'); if (a) a.scrollIntoView({ block: 'nearest' });
    }

    function showRecent() {
      const r = getRecent();
      if (!r.length) return close();
      items = r; active = -1; header = 'RECENT'; renderItems('');
    }

    async function run(q) {
      const my = ++seq;
      header = '';
      list.innerHTML = '<li class="s-info">Scanning markets…</li>'; open();
      try {
        const data = await Yahoo.search(q);
        if (my !== seq) return;
        const quotes = (data.quotes || [])
          .filter((x) => x.symbol && x.quoteType === 'EQUITY')
          .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, short: x.shortname || '', exch: x.exchDisp || x.exchange || '', sector: x.sectorDisp || x.sector || '', industry: x.industryDisp || x.industry || '' }));
        let ranked = quotes;
        if (window.Fuse && quotes.length) {
          const fuse = new Fuse(quotes, { keys: [{ name: 'name', weight: 0.5 }, { name: 'short', weight: 0.2 }, { name: 'symbol', weight: 0.3 }], threshold: 0.6, ignoreLocation: true, includeScore: true });
          // Favour Indian listings: NSE first, then BSE
          const bonus = (x) => (/\.NS$/.test(x.symbol) ? 0.35 : /\.BO$/.test(x.symbol) ? 0.3 : 0);
          const hits = fuse.search(q).map((h) => ({ item: h.item, s: h.score - bonus(h.item) })).sort((a, b) => a.s - b.s).map((h) => h.item);
          const seen = new Set(hits.map((h) => h.symbol));
          ranked = [...hits, ...quotes.filter((x) => !seen.has(x.symbol)).sort((a, b) => bonus(b) - bonus(a))];
        }
        items = ranked.slice(0, 10); active = items.length ? 0 : -1;
        renderItems(q);
      } catch (e) {
        if (my !== seq) return;
        list.innerHTML = `<li class="s-info">Can’t reach the data service right now (${esc(e.message)}).</li>`; open();
      }
    }

    function choose(i) {
      const it = items[i]; if (!it) return;
      state.lastHits[it.symbol] = it; pushRecent(it);
      input.value = ''; close(); input.blur();
      location.hash = '#/s/' + encodeURIComponent(it.symbol);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { seq++; return showRecent(); }
      timer = setTimeout(() => run(q), 230);
    });
    input.addEventListener('focus', () => { if (!input.value.trim()) showRecent(); });
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      const q = input.value.trim();
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); renderItems(q); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); renderItems(q); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active >= 0 ? active : 0); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(+li.dataset.i); } });
    document.addEventListener('click', (e) => { if (!list.contains(e.target) && e.target !== input) close(); });
  }

  /* ====================== ROUTING ====================== */
  function route() {
    const m = location.hash.match(/^#\/s\/(.+)$/);
    if (m) { showView('dash'); loadDashboard(decodeURIComponent(m[1]).toUpperCase()); }
    else { showView('search'); if (!isMobile()) setTimeout(() => $('#mainSearch').focus(), 50); }
  }
  function showView(v) {
    $('#viewSearch').classList.toggle('hidden', v !== 'search');
    $('#viewDash').classList.toggle('hidden', v !== 'dash');
    $('#miniSearchWrap').classList.toggle('hidden', v !== 'dash');
    window.scrollTo(0, 0);
  }

  /* ====================== DASHBOARD ====================== */
  let loadSeq = 0;
  async function loadDashboard(symbol) {
    const my = ++loadSeq;
    destroyCharts();
    $('#dashContent').classList.add('hidden'); $('#dashError').classList.add('hidden');
    $('#dashLoading').classList.remove('hidden'); $('#loadingSym').textContent = '· ' + symbol;
    document.title = symbol + ' — PLUTUS';

    const [c5, c1, ts, sum] = await Promise.allSettled([
      Yahoo.chart(symbol, '5y', '1wk'), Yahoo.chart(symbol, '1y', '1d'), Yahoo.timeseries(symbol), Yahoo.summary(symbol)
    ]);
    if (my !== loadSeq) return;
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    $('#dashLoading').classList.add('hidden');

    const chartOk = (r) => { const v = val(r); return v && v.chart && v.chart.result && v.chart.result[0]; };
    if (!chartOk(c5) && !chartOk(c1)) {
      const reason = c1.status === 'rejected' ? c1.reason.message : 'Symbol not found';
      return showError(symbol, reason);
    }
    let model;
    try { model = A.buildModel(symbol, val(c5), val(c1), val(ts), val(sum), state.lastHits[symbol]); }
    catch (e) { console.error(e); return showError(symbol, 'Could not process the data for this company.'); }
    state.model = model;
    document.title = model.name + ' (' + symbol + ') — PLUTUS';
    render(model, { summaryOk: !!val(sum) && model.hasProfile });
    loadPeers(model, val(sum), my);
  }

  function showError(symbol, reason) {
    const el = $('#dashError');
    el.innerHTML = `<h2>Signal lost</h2><p>We couldn’t load data for <b>${esc(symbol)}</b>.<br>${esc(reason)}</p>
      <button onclick="location.hash='#/'">← New search</button>`;
    el.classList.remove('hidden');
  }

  const colorFor = (s) => (s == null ? 'var(--dim)' : s >= 70 ? 'var(--good)' : s >= 45 ? 'var(--warn)' : 'var(--bad)');
  const hexFor = (s) => (s == null ? '#4b515b' : s >= 70 ? '#2ee6a6' : s >= 45 ? '#ffc857' : '#ff5a6e');
  const signCls = (v) => (!isNum(v) ? 'muted' : v > 0 ? 'good' : v < 0 ? 'bad' : 'muted');

  function aboutSection(m, idx) {
    const facts = [
      m.sector ? `<span>Sector <b>${esc(m.sector)}</b></span>` : '',
      m.industry ? `<span>Industry <b>${esc(m.industry)}</b></span>` : '',
      m.city || m.country ? `<span>HQ <b>${esc([m.city, m.country].filter(Boolean).join(', '))}</b></span>` : '',
      m.employees ? `<span>Employees <b>${Number(m.employees).toLocaleString(m.currency === 'INR' ? 'en-IN' : 'en-US')}</b></span>` : '',
      isNum(m.beta) ? `<span>Beta <b>${m.beta.toFixed(2)}</b></span>` : '',
      m.website ? `<span><a href="${esc(m.website)}" target="_blank" rel="noopener">Website ↗</a></span>` : ''
    ].join('');
    if (!m.summary && !facts) return '';
    return `<section class="section about reveal">
      <div class="section-head"><span class="idx">${idx}</span><h2>About the Company</h2><p>What the business does</p></div>
      ${m.summary ? `<p class="about-text clamp" id="aboutText">${esc(m.summary)}</p><button class="more-btn hidden" id="aboutMore">Read more ↓</button>` : ''}
      ${facts ? `<div class="facts">${facts}</div>` : ''}
    </section>`;
  }

  function render(m, opts) {
    const c = m.finCurrency, pc = m.currency;
    const S = m.scores;
    const posPct = isNum(m.pos52) ? (m.pos52 * 100).toFixed(1) : null;
    let n = 0; const idx = () => String(++n).padStart(2, '0');

    const notices = [];
    if (!opts.summaryOk) notices.push('Company profile & key statistics are temporarily unavailable — some figures are computed from statements instead.');
    if (!m.hasFundamentals) notices.push('Yahoo Finance has no annual financial statements for this listing, so growth, profit and balance-sheet metrics can’t be shown.');
    if (!m.sameCur && m.hasFundamentals) notices.push(`Financial statements are reported in ${c} while the share trades in ${pc}; the P/E history chart is hidden to avoid mixing currencies.`);

    const about = aboutSection(m, '01');
    if (about) n = 1;

    const html = `
    <section class="identity reveal">
      <div style="min-width:0">
        <div class="meta"><b>${esc(m.symbol)}</b> · ${esc(m.exchange)}</div>
        <h1>${esc(m.name)}</h1>
      </div>
      <div class="price-block">
        <div class="price">${fmtPrice(m.price, pc)}</div>
        <div class="chg ${signCls(m.changePct)}">${isNum(m.change) ? (m.change > 0 ? '▲ ' : m.change < 0 ? '▼ ' : '') + Math.abs(m.change).toFixed(2) : ''} ${isNum(m.changePct) ? '(' + fmtPct(m.changePct, 2, true) + ')' : ''} <span class="muted">today</span></div>
      </div>
    </section>
    ${notices.map((x) => `<div class="notice">${esc(x)}</div>`).join('')}
    <div class="strip reveal">
      <div><div class="k">Market Cap</div><div class="v">${fmtMoney(m.marketCap, pc)}</div></div>
      <div><div class="k">P/E Ratio</div><div class="v">${m.negEarnings ? 'n/a <span class="muted" style="font-size:12px">(loss)</span>' : fmtX(m.pe, 1)}</div></div>
      <div><div class="k">1-Year Return</div><div class="v ${signCls(m.ret1y)}">${fmtPct(m.ret1y, 1, true)}</div></div>
      <div><div class="k">Dividend Yield</div><div class="v">${isNum(m.divYield) ? fmtPct(m.divYield, 2) : '—'}</div></div>
      <div><div class="k">52-Week Range</div>
        ${posPct != null ? `<div class="range"><span style="left:${posPct}%"></span></div>
        <div class="range-lbl"><span>${fmtPrice(m.low52, pc)}</span><span>${fmtPrice(m.high52, pc)}</span></div>` : '<div class="v">—</div>'}
      </div>
    </div>

    ${about}

    <section class="section reveal">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Health Scan</h2><p>Six power stats, scored 0–100 from reported numbers</p></div>
      <div class="health">
        <div class="panel ring-wrap">
          <div class="panel-title">Overall Health Score</div>
          <div class="ring">
            <svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="88"/><circle class="bar" id="ringBar" cx="100" cy="100" r="88"
              stroke="${hexFor(S.overall)}" stroke-dasharray="${2 * Math.PI * 88}" stroke-dashoffset="${2 * Math.PI * 88}"/></svg>
            <div class="center"><div class="num" id="ringNum">0</div><div class="of">OF 100</div></div>
          </div>
          <div class="tier ${S.tier.cls}">${S.tier.label}</div>
          <div class="ring-note">Average of the six stats. Describes financial health — not whether the share is a good buy.</div>
        </div>
        <div class="panel">
          <div class="panel-title">Power Stats</div>
          ${S.pillars.map((p) => {
            const lit = p.score == null ? 0 : Math.round(p.score / 10);
            return `<div class="pillar">
              <div class="pillar-top"><span class="pillar-name">${p.name}</span><span class="pillar-score" style="color:${colorFor(p.score)}">${p.score == null ? 'N/A' : p.score}</span></div>
              <div class="pillar-hint">${p.hint}</div>
              <div class="segs">${Array.from({ length: 10 }, (_, i) => `<i style="${i < lit ? 'background:' + hexFor(p.score) : ''}"></i>`).join('')}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="panel badges-panel">
          <div class="panel-title">Achievements · ${m.badges.filter((b) => b.earned).length}/${m.badges.length} unlocked</div>
          <div>
            <div class="badges">
              ${m.badges.map((b) => `<div class="badge ${b.earned ? 'on' : 'off'}" title="${esc(b.rule)}"><span class="ico">${b.icon}</span><span class="bn">${b.name}</span></div>`).join('')}
            </div>
            <div class="badges-note">${isMobile() ? 'Tap and hold' : 'Hover'} a badge to see what unlocks it.</div>
          </div>
          <div class="radar-box"><canvas id="chRadar"></canvas></div>
        </div>
      </div>
    </section>

    <section class="section reveal">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Key Numbers</h2><p>Latest financial year · tap ⓘ for a plain-English meaning</p></div>
      <div class="kpis">${kpiCards(m).join('')}</div>
    </section>

    <section class="section reveal">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Trajectory</h2><p>How the business and the share price have moved over time</p></div>
      <div class="charts">
        ${chartCard('chPrice', 'Share Price', 'What one share has cost in the market over time.', m.takeaways.price, true,
          '<div class="toggle" id="priceToggle"><button data-r="1y">1Y</button><button data-r="5y" class="on">5Y</button></div>')}
        ${chartCard('chPE', 'P/E Ratio History', 'How many years of profit investors pay for in the share price (price ÷ latest annual earnings per share). Dashed line = 5-year median.', m.takeaways.pe, true)}
        <div class="period-bar">
          <div><span class="pb-title">Business Results</span><span class="pb-sub" id="periodNote"></span></div>
          <div class="toggle big" id="periodToggle"><button data-p="annual" class="on">YEARLY</button><button data-p="quarterly">QUARTERLY</button></div>
        </div>
        ${chartCard('chRev', 'Revenue vs Net Profit', 'Sales (everything customers paid) vs. what was left after all costs and taxes.', m.takeaways.revenue)}
        ${chartCard('chMargin', 'Profit Margins', 'Out of every 100 of sales, how much remains as profit at each stage.', m.takeaways.margins)}
        ${chartCard('chEPS', 'Earnings per Share', 'Profit belonging to each single share.', m.takeaways.eps)}
        ${chartCard('chCash', 'Cash Flow', 'Cash generated by operations, and what is left after investing in the business (free cash flow).', m.takeaways.cash)}
        ${chartCard('chDebt', 'Debt vs Shareholders’ Equity', 'Money borrowed vs. money that belongs to the owners.', m.takeaways.debt, true)}
      </div>
    </section>

    <section class="section reveal">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Peer Arena</h2><p>How it stacks up against similar companies</p></div>
      <div id="peerWrap"><div class="peer-loading"><div class="orbit sm"><span></span></div><span>Finding similar companies…</span></div></div>
    </section>

    <section class="section reveal">
      <div class="section-head"><span class="idx">${idx()}</span><h2>Strengths &amp; Weaknesses</h2><p>Facts that stand out — you decide what matters to you</p></div>
      <div class="sw" id="swWrap">
        ${swCol('s', 'Strengths', m.strengths, 'good')}
        ${swCol('w', 'Weaknesses', m.weaknesses, 'bad')}
      </div>
      <div class="verdict-note">PLUTUS does not tell you to buy, sell or hold. Every investor has different goals, time horizons and risk tolerance. Use these facts as a starting point, compare with similar companies, and read the company’s official reports before deciding.</div>
    </section>`;

    const root = $('#dashContent');
    root.innerHTML = html;
    root.classList.remove('hidden');

    // About: show "Read more" only if text is actually clamped
    const at = $('#aboutText'), mb = $('#aboutMore');
    if (at && mb) {
      requestAnimationFrame(() => { if (at.scrollHeight > at.clientHeight + 4) mb.classList.remove('hidden'); });
      mb.addEventListener('click', () => { const c2 = at.classList.toggle('clamp'); mb.textContent = c2 ? 'Read more ↓' : 'Show less ↑'; });
    }

    // KPI tooltips: tap-to-toggle for touch screens
    root.querySelectorAll('.kpi .info').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = b.closest('.kpi'); const was = card.classList.contains('tip-open');
      root.querySelectorAll('.kpi.tip-open').forEach((k) => k.classList.remove('tip-open'));
      if (!was) card.classList.add('tip-open');
    }));
    document.addEventListener('click', () => root.querySelectorAll('.kpi.tip-open').forEach((k) => k.classList.remove('tip-open')));

    requestAnimationFrame(() => {
      const C = 2 * Math.PI * 88, bar = $('#ringBar');
      if (bar && isNum(S.overall)) bar.style.strokeDashoffset = C * (1 - S.overall / 100);
      countUp($('#ringNum'), S.overall);
    });
    observeReveal();
    drawCharts(m);
  }

  function countUp(el, target) {
    if (!el) return;
    if (!isNum(target)) { el.textContent = '—'; return; }
    const t0 = performance.now(), dur = 1300;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function observeReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.05 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- KPI cards ---------- */
  function kpiCards(m) {
    const c = m.finCurrency;
    const lvl = (v, good, bad, higherBetter = true) => (!isNum(v) ? '' : higherBetter ? (v >= good ? 'good' : v <= bad ? 'bad' : 'warn') : (v <= good ? 'good' : v >= bad ? 'bad' : 'warn'));
    const card = (k, v, sub, dot, tip) => `<div class="kpi"><div class="k"><span class="dot ${dot}"></span><span class="k-label">${k}</span><button class="info" aria-label="What is ${k}?">i</button><div class="tip">${tip}</div></div><div class="v">${v}</div><div class="sub">${sub}</div></div>`;
    const yoy = (g) => (isNum(g) ? `<span class="${signCls(g)}">${fmtPct(g, 1, true)}</span> vs last year` : 'vs last year: —');
    const fin = m.isFinancial;
    return [
      card('Revenue', fmtMoney(m.revLast, c), yoy(m.revYoY), lvl(m.revYoY, 0.08, 0), 'Total money the company earned from selling its products or services in the year. Growing revenue means more customers or higher prices.'),
      card('Net Profit', fmtMoney(m.niLast, c), isNum(m.niYoY) ? yoy(m.niYoY) : (isNum(m.niLast) && m.niLast < 0 ? '<span class="bad">Net loss</span>' : '—'), isNum(m.niLast) && m.niLast < 0 ? 'bad' : lvl(m.niYoY, 0.08, 0), 'What is left after paying every cost, interest and tax. This is the company’s “take-home pay”.'),
      card('Net Margin', fmtPct(m.netMargin), isNum(m.netMarginPrev) ? `prev. year ${fmtPct(m.netMarginPrev)}` : '—', lvl(m.netMargin, 0.12, 0.04), 'Profit kept from every 100 of sales. 20% means 20 of every 100 is profit. Higher = more efficient business.'),
      card('P/E Ratio', m.negEarnings ? 'n/a' : fmtX(m.pe, 1), isNum(m.peMedian) && isNum(m.pe) ? `5-yr median ${fmtX(m.peMedian, 1)}` : isNum(m.fwdPe) ? `forward ${fmtX(m.fwdPe, 1)}` : '—', m.negEarnings ? 'bad' : lvl(m.pe, 18, 40, false), 'Share price ÷ profit per share. A P/E of 20 means you pay 20 years of today’s profit. Higher = more expensive (often because growth is expected).'),
      card('ROE', fmtPct(m.roe), 'profit ÷ shareholders’ money', lvl(m.roe, 0.15, 0.06), 'Return on Equity: how much profit the company makes with the money its owners have put in. 20% means 20 of profit for every 100 of owners’ money.'),
      card(fin ? 'Equity / Assets' : 'Debt / Equity', fin ? fmtPct(m.equityToAssets) : fmtX(m.de, 2), fin ? 'capital cushion (financial co.)' : 'borrowed per 1 of owners’ money', fin ? lvl(m.equityToAssets, 0.12, 0.06) : lvl(m.de, 0.5, 1.5, false), fin ? 'For banks and insurers, borrowing is the business. This shows what share of assets is funded by owners — a bigger cushion absorbs losses better.' : 'How much the company has borrowed compared with what its owners have put in. 0.5× means 50 of debt for every 100 of equity. Lower = less risk from lenders.'),
      card('Free Cash Flow', fmtMoney(m.fcfLast, c), isNum(m.fcfMargin) ? `${fmtPct(m.fcfMargin)} of revenue` : '—', isNum(m.fcfLast) ? (m.fcfLast > 0 ? 'good' : 'bad') : '', 'Cash left over after running the business and paying for new equipment. It can fund dividends, buybacks or growth without borrowing.'),
      card('Current Ratio', fin ? 'n/a' : fmtX(m.currentRatio, 2), fin ? 'not meaningful for financials' : 'short-term assets ÷ bills', fin ? '' : lvl(m.currentRatio, 1.5, 1), 'Can the company pay bills due within a year? Above 1× means it has more near-cash assets than short-term bills.'),
      card('EPS (TTM)', isNum(m.ttmEps) ? m.ttmEps.toFixed(2) : '—', `${esc(c)} per share · last 12 months`, isNum(m.ttmEps) ? (m.ttmEps > 0 ? 'good' : 'bad') : '', 'Earnings per share: total profit divided by the number of shares. Your “slice” of profit for each share you own.'),
      card('Dividend Yield', isNum(m.divYield) ? fmtPct(m.divYield, 2) : '—', isNum(m.divYield) && m.divYield > 0 ? 'cash paid yearly ÷ price' : 'no regular dividend', isNum(m.divYield) && m.divYield >= 0.015 ? 'good' : '', 'Cash the company pays shareholders each year as a % of the share price. 2% means about 2 per year for every 100 invested.'),
      card('1-Year Return', fmtPct(m.ret1y, 1, true), isNum(m.ret5y) ? `5-yr ${fmtPct(m.ret5y, 0, true)}` : 'price change', lvl(m.ret1y, 0.1, -0.1), 'How much the share price changed over the past 12 months (excluding dividends). Past moves do not predict future ones.'),
      card('Volatility', fmtPct(m.vol, 0), isNum(m.maxDD) ? `worst dip ${fmtPct(m.maxDD, 0)}` : '—', lvl(m.vol, 0.25, 0.45, false), 'How wildly the price moved over the last year. 30% means it typically swings about ±30% in a year. Higher = bumpier ride.')
    ];
  }

  function chartCard(id, title, what, takeaway, wide, extra) {
    return `<div class="chart-card ${wide ? 'wide' : ''}">
      <h3>${title}${extra || ''}</h3>
      <p class="what">${what}</p>
      <div class="chart-box" id="box-${id}"><canvas id="${id}"></canvas></div>
      <div class="takeaway ${takeaway ? '' : 'hidden'}" id="tk-${id}">${esc(takeaway || '')}</div>
    </div>`;
  }

  function swCol(cls, title, items, color) {
    return `<div class="sw-col ${cls}">
      <h3 class="${color}">${title} <span class="count">${items.length}</span></h3>
      ${items.length ? items.map((x) => `<div class="sw-item"><span class="bar"></span><div><div class="t">${esc(x.title)}${x.peer ? '<span class="peer-chip">VS PEERS</span>' : ''}</div><div class="d">${esc(x.text)}</div></div><span class="m">${esc(x.metric)}</span></div>`).join('')
        : `<div class="sw-empty">Nothing stands out ${cls === 's' ? 'strongly on the positive side' : 'as a clear weak spot'} based on the available data.</div>`}
    </div>`;
  }

  /* ---------- Peer Arena ---------- */
  async function loadPeers(m, sumRes, my) {
    const fail = (msg) => { if (my === loadSeq && $('#peerWrap')) $('#peerWrap').innerHTML = `<div class="nodata">${esc(msg)}</div>`; };
    try {
      const rec = await Yahoo.recs(m.symbol);
      const list = ((rec.finance && rec.finance.result && rec.finance.result[0] && rec.finance.result[0].recommendedSymbols) || []).map((x) => x.symbol).filter((x) => x && x !== m.symbol);
      if (!list.length) return fail('Yahoo Finance has no peer group for this company.');
      const sameMkt = (x) => (isIndian(m.symbol) ? isIndian(x) : !isIndian(x));
      const cands = [...list.filter(sameMkt), ...list.filter((x) => !sameMkt(x))].slice(0, 7);
      const res = await Promise.allSettled(cands.map((x) => Yahoo.summary(x)));
      if (my !== loadSeq) return;
      const peers = res.map((r, i) => (r.status === 'fulfilled' ? A.peerRow(cands[i], r.value) : null))
        .filter((r) => r && r.currency === m.currency && ['pe', 'netMargin', 'roe', 'marketCap'].some((k) => isNum(r[k])))
        .slice(0, 5);
      if (!peers.length) return fail('Peer data is unavailable for this company right now.');
      const main = A.peerRow(m.symbol, sumRes, m);
      main.name = m.name;
      const cmp = A.peerCompare(main, peers, m.isFinancial);
      renderPeers(m, cmp);
      const sw = $('#swWrap');
      if (sw && (cmp.strengths.length || cmp.weaknesses.length)) {
        const tag = (arr) => arr.map((x) => ({ ...x, peer: true }));
        sw.innerHTML = swCol('s', 'Strengths', [...m.strengths, ...tag(cmp.strengths)], 'good') + swCol('w', 'Weaknesses', [...m.weaknesses, ...tag(cmp.weaknesses)], 'bad');
      }
    } catch (e) { fail('Couldn’t load peers (' + e.message + ').'); }
  }

  const fmtMetric = (mt, v, cur) => (!isNum(v) ? '—' : mt.fmt === 'pct' ? fmtPct(v, 1) : mt.fmt === 'x' ? fmtX(v, 1) : fmtMoney(v, cur));
  const shortSym = (s) => s.replace(/\.(NS|BO)$/, '');

  function renderPeers(m, cmp) {
    const cur = m.currency;
    const medal = (r) => (r == null ? '' : r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : '');
    const tiles = cmp.ranks.map((r) => `
      <div class="rank-tile ${medal(r.rank)}">
        <div class="rt-name">${r.name}</div>
        <div class="rt-rank">${r.rank == null ? '—' : '#' + r.rank}<span>${r.rank == null ? 'no data' : 'of ' + r.of}</span></div>
        <div class="rt-val">${fmtMetric(r, r.value, cur)} <span class="muted">peer median ${fmtMetric(r, r.median, cur)}</span></div>
        <div class="rt-best">${r.best}: <b>${r.leader ? esc(r.leader.isMain ? 'This company' : shortSym(r.leader.symbol)) : '—'}</b></div>
      </div>`).join('');
    const cols = A.PEER_METRICS.filter((mt) => !(m.isFinancial && mt.key === 'de'));
    const table = `<div class="peer-table-wrap"><table class="peer-table">
      <thead><tr><th>Company</th>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${cmp.rows.map((r) => `<tr class="${r.isMain ? 'main' : ''}">
        <td>${r.isMain ? '<span class="you">◉</span>' : `<a href="#/s/${encodeURIComponent(r.symbol)}">`}<b>${esc(shortSym(r.symbol))}</b><span class="pname">${esc(r.name)}</span>${r.isMain ? '' : '</a>'}</td>
        ${cols.map((c) => `<td>${fmtMetric(c, r[c.key], cur)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="scroll-hint">← Swipe the table to see all columns →</div>`;
    const btns = cols.filter((c) => c.key !== 'marketCap').map((c, i) => `<button data-k="${c.key}" class="${i === 0 ? 'on' : ''}">${c.name.toUpperCase()}</button>`).join('');
    $('#peerWrap').innerHTML = `
      <p class="peer-intro">Compared with ${cmp.rows.length - 1} similar companies suggested by Yahoo Finance. <b>#1</b> means best in the group on that measure (for Debt and P/E, lowest counts as #1). Medals are facts, not recommendations.</p>
      <div class="rank-grid">${tiles}</div>
      <div class="chart-card wide peer-chart">
        <h3>Head to Head<div class="toggle" id="peerToggle">${btns}</div></h3>
        <div class="chart-box" id="box-chPeer"><canvas id="chPeer"></canvas></div>
      </div>
      ${table}`;
    const draw = (key) => {
      resetBox('chPeer');
      const mt = A.PEER_METRICS.find((x) => x.key === key);
      const rows = cmp.rows.filter((r) => isNum(r[key])).sort((a, b) => (mt.better === 'high' ? b[key] - a[key] : a[key] - b[key]));
      if (!rows.length) return noData('chPeer');
      const val = (v) => (mt.fmt === 'pct' ? +(v * 100).toFixed(2) : +v.toFixed(2));
      const unit = mt.fmt === 'pct' ? '%' : '×';
      mk('chPeer', { type: 'bar',
        data: { labels: rows.map((r) => shortSym(r.symbol)), datasets: [{ label: mt.label, data: rows.map((r) => val(r[key])),
          backgroundColor: rows.map((r) => (r.isMain ? '#3ea6ff' : '#262b34')), borderColor: rows.map((r) => (r.isMain ? '#3ea6ff' : '#3a404b')), borderWidth: 1, borderRadius: 2, maxBarThickness: 26 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${mt.label}: ${x.parsed.x}${unit}` } } },
          scales: { x: { ticks: { maxTicksLimit: isMobile() ? 4 : 8, callback: (v) => v + unit } }, y: { grid: { display: false }, ticks: { color: '#eef0f3', autoSkip: false } } } } });
    };
    draw(cols.find((c) => c.key !== 'marketCap').key);
    window.__plutusPeerRedraw = () => { const on = $('#peerToggle button.on'); if (on && $('#box-chPeer')) draw(on.dataset.k); };
    $('#peerToggle').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('#peerToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.k); });
  }

  /* ---------- charts ---------- */
  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }

  function setupChartDefaults() {
    if (!window.Chart) return;
    const mob = isMobile();
    Chart.defaults.color = '#7f8692';
    Chart.defaults.font.family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    Chart.defaults.font.size = mob ? 10 : 11;
    Chart.defaults.borderColor = '#14171d';
    Chart.defaults.plugins.legend.position = 'top';
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.padding = mob ? 8 : 12;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0b0e13';
    Chart.defaults.plugins.tooltip.borderColor = '#3ea6ff';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.responsive = true;
  }

  const grad = (hex, a1 = 0.35) => (ctx) => {
    const { chart } = ctx; const { ctx: g, chartArea } = chart;
    if (!chartArea) return 'transparent';
    const gr = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gr.addColorStop(0, hex + Math.round(a1 * 255).toString(16).padStart(2, '0')); gr.addColorStop(1, hex + '00');
    return gr;
  };
  const dLabel = (t, withDay) => new Date(t).toLocaleDateString('en-GB', withDay ? { day: '2-digit', month: 'short', year: '2-digit' } : { month: 'short', year: '2-digit' });

  function resetBox(id) {
    const old = state.charts.find((x) => x.canvas && x.canvas.id === id);
    if (old) { old.destroy(); state.charts = state.charts.filter((x) => x !== old); }
    const box = document.getElementById('box-' + id); if (box) box.innerHTML = `<canvas id="${id}"></canvas>`;
  }
  function setTake(id, text) { const el = document.getElementById('tk-' + id); if (!el) return; el.textContent = text || ''; el.classList.toggle('hidden', !text); }
  function noData(id, msg) {
    const cv = document.getElementById(id); if (!cv) return;
    cv.parentElement.innerHTML = `<div class="nodata">${esc(msg || 'No data available')}</div>`;
  }
  function mk(id, cfg) {
    const cv = document.getElementById(id); if (!cv || !window.Chart) return null;
    const ch = new Chart(cv, cfg); state.charts.push(ch); return ch;
  }
  const anyNum = (arr) => (arr || []).some(isNum);

  function drawCharts(m) {
    setupChartDefaults();
    const pc = m.currency, mob = isMobile();

    // Radar
    const P = m.scores.pillars;
    mk('chRadar', {
      type: 'radar',
      data: { labels: P.map((p) => p.name.toUpperCase()), datasets: [{ data: P.map((p) => p.score ?? 0), borderColor: '#3ea6ff', backgroundColor: 'rgba(62,166,255,.18)', pointBackgroundColor: P.map((p) => hexFor(p.score)), pointRadius: 3, borderWidth: 1.5 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: '#1a1e25' }, angleLines: { color: '#1a1e25' }, pointLabels: { font: { size: mob ? 8 : 9 }, color: '#7f8692' } } } }
    });

    // Price
    const drawPrice = (range) => {
      resetBox('chPrice');
      const pts = range === '1y' ? m.priceDaily : m.priceWeekly;
      if (!pts.length) return noData('chPrice');
      const up = pts[pts.length - 1].v >= pts[0].v, col = up ? '#2ee6a6' : '#ff5a6e';
      mk('chPrice', {
        type: 'line',
        data: { labels: pts.map((p) => dLabel(p.t, range === '1y')), datasets: [{ label: 'Price', data: pts.map((p) => p.v), borderColor: col, backgroundColor: grad(col, 0.28), fill: true, borderWidth: 1.6, pointRadius: 0, tension: 0.15 }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => fmtPrice(x.parsed.y, pc) } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: mob ? 4 : 8, maxRotation: 0 } }, y: { position: 'right', ticks: { maxTicksLimit: mob ? 5 : 8, callback: (v) => fmtPrice(v, pc).replace(/\.00$/, '') } } } }
      });
    };
    drawPrice('5y');
    const tg = $('#priceToggle');
    if (tg) tg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; tg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); drawPrice(b.dataset.r); });

    // P/E history
    if (m.peHistory.length > 5) {
      const ph = m.peHistory;
      mk('chPE', { type: 'line',
        data: { labels: ph.map((p) => dLabel(p.t)), datasets: [
          { label: 'P/E', data: ph.map((p) => +p.v.toFixed(2)), borderColor: '#9d8cff', backgroundColor: grad('#9d8cff', 0.22), fill: true, borderWidth: 1.6, pointRadius: 0, tension: 0.15 },
          { label: '5-yr median', data: ph.map(() => +m.peMedian.toFixed(2)), borderColor: '#ffc857', borderDash: [6, 6], borderWidth: 1, pointRadius: 0 }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}×` } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: mob ? 4 : 8, maxRotation: 0 } }, y: { position: 'right', ticks: { maxTicksLimit: mob ? 5 : 8, callback: (v) => v + '×' } } } } });
    } else noData('chPE', m.negEarnings ? 'Not meaningful — company has losses' : !m.sameCur ? 'Hidden — currency mismatch' : 'Not enough earnings history');

    drawBusiness(m, 'annual');
    const pt = $('#periodToggle');
    if (pt) pt.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pt.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      drawBusiness(m, b.dataset.p);
    });
  }

  function quarterTakeaways(m) {
    const q = m.quarterly, t = {}, c = m.finCurrency, n = q.revenue.length;
    const yoy = (arr) => (n >= 5 && isNum(arr[n - 1]) && isNum(arr[n - 5]) && arr[n - 5] > 0 ? arr[n - 1] / arr[n - 5] - 1 : null);
    if (n) {
      const rg = yoy(q.revenue), ng = yoy(q.netIncome);
      t.revenue = `Latest quarter (${q.labels[n - 1]}): revenue ${fmtMoney(q.revenue[n - 1], c)}, net profit ${fmtMoney(q.netIncome[n - 1], c)}` +
        (isNum(rg) ? ` · revenue ${fmtPct(rg, 1, true)} vs same quarter last year` : '') + (isNum(ng) ? `, profit ${fmtPct(ng, 1, true)}` : '') + '.';
      if (isNum(q.netMarginS[n - 1])) t.margins = `Net margin in the latest quarter: ${fmtPct(q.netMarginS[n - 1])}${n >= 5 && isNum(q.netMarginS[n - 5]) ? ` (same quarter last year ${fmtPct(q.netMarginS[n - 5])})` : ''}.`;
      if (isNum(q.eps[n - 1])) t.eps = `Latest quarterly EPS: ${q.eps[n - 1].toFixed(2)} ${c}${n >= 5 && isNum(q.eps[n - 5]) ? ` vs ${q.eps[n - 5].toFixed(2)} a year earlier` : ''}.`;
    }
    t.cash = anyNum(q.ocf) ? '' : 'Many companies (including most Indian listings) publish cash flow only half-yearly or yearly — switch to Yearly.';
    t.debt = anyNum(q.debt) ? '' : 'Quarterly balance-sheet data isn’t published for this company — switch to Yearly.';
    return t;
  }

  function drawBusiness(m, period) {
    const c = m.finCurrency, mob = isMobile();
    const D = period === 'quarterly' ? m.quarterly : m.annual, L = D.labels;
    const moneyTick = { maxTicksLimit: mob ? 5 : 7, callback: (v) => fmtMoney(v, c) };
    const moneyTip = { callbacks: { label: (x) => `${x.dataset.label}: ${fmtMoney(x.parsed.y, c)}` } };
    const xs = { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } };
    const bar = mob ? 18 : 34;
    ['chRev', 'chMargin', 'chEPS', 'chCash', 'chDebt'].forEach(resetBox);
    const note = $('#periodNote');
    if (note) note.textContent = period === 'quarterly' ? `Quarterly · last ${L.length} reported quarters` : `Yearly · last ${L.length} financial years`;
    const T = period === 'quarterly' ? quarterTakeaways(m) : m.takeaways;
    setTake('chRev', T.revenue); setTake('chMargin', T.margins); setTake('chEPS', T.eps); setTake('chCash', T.cash); setTake('chDebt', T.debt);
    const nd = period === 'quarterly' ? 'No quarterly data published' : 'No data available';
    const negCol = (arr, pos) => arr.map((v) => (isNum(v) && v < 0 ? '#ff5a6e' : pos));

    if (anyNum(D.revenue) || anyNum(D.netIncome)) mk('chRev', { type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Revenue', data: D.revenue, backgroundColor: '#3ea6ff', borderRadius: 2, maxBarThickness: bar },
        { label: 'Net Profit', data: D.netIncome, backgroundColor: negCol(D.netIncome, '#2ee6a6'), borderRadius: 2, maxBarThickness: bar }] },
      options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    else noData('chRev', nd);

    const pctData = (arr) => arr.map((v) => (isNum(v) ? +(v * 100).toFixed(2) : null));
    const mSets = [['Gross', D.grossMarginS, '#9d8cff'], ['Operating', D.opMarginS, '#3ea6ff'], ['Net', D.netMarginS, '#2ee6a6']]
      .filter(([, a]) => anyNum(a)).map(([l, a, col]) => ({ label: l, data: pctData(a), borderColor: col, backgroundColor: col, borderWidth: 2, pointRadius: mob ? 2 : 3, tension: 0.25, spanGaps: true }));
    if (mSets.length) mk('chMargin', { type: 'line', data: { labels: L, datasets: mSets },
      options: { plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y.toFixed(1)}%` } } }, scales: { x: xs, y: { ticks: { maxTicksLimit: 6, callback: (v) => v + '%' } } } } });
    else noData('chMargin', nd);

    if (anyNum(D.eps)) mk('chEPS', { type: 'bar',
      data: { labels: L, datasets: [{ label: 'EPS (' + c + ')', data: D.eps, backgroundColor: negCol(D.eps, '#9d8cff'), borderRadius: 2, maxBarThickness: mob ? 24 : 40 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: xs, y: { ticks: { maxTicksLimit: 6 } } } } });
    else noData('chEPS', nd);

    if (anyNum(D.ocf) || anyNum(D.fcf)) mk('chCash', { type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Operating Cash Flow', data: D.ocf, backgroundColor: '#3ea6ff', borderRadius: 2, maxBarThickness: bar },
        { label: 'Free Cash Flow', data: D.fcf, backgroundColor: negCol(D.fcf, '#2ee6a6'), borderRadius: 2, maxBarThickness: bar }] },
      options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    else noData('chCash', nd);

    if (anyNum(D.debt) || anyNum(D.equity)) mk('chDebt', { type: 'bar',
      data: { labels: L, datasets: [
        { label: 'Total Debt', data: D.debt, backgroundColor: '#ff5a6e', borderRadius: 2, maxBarThickness: bar },
        { label: 'Shareholders’ Equity', data: D.equity, backgroundColor: '#2ee6a6', borderRadius: 2, maxBarThickness: bar }] },
      options: { plugins: { tooltip: moneyTip }, scales: { x: xs, y: { ticks: moneyTick } } } });
    else noData('chDebt', nd);
  }

  // Redraw charts when crossing the mobile/desktop breakpoint (rotation, window resize)
  let lastMob = null, rT = null;
  window.addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      const mob = isMobile();
      if (lastMob !== null && mob !== lastMob && state.model && !$('#dashContent').classList.contains('hidden')) {
        destroyCharts(); drawCharts(state.model);
        const pt = $('#periodToggle'); if (pt) pt.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0));
        const tg = $('#priceToggle'); if (tg) tg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.r === '5y'));
        if (window.__plutusPeerRedraw) window.__plutusPeerRedraw();
      }
      lastMob = mob;
    }, 200);
  });

  /* ====================== INIT ====================== */
  function init() {
    lastMob = isMobile();
    attachSearch($('#mainSearch'), $('#mainSuggest'));
    attachSearch($('#miniSearch'), $('#miniSuggest'));
    $('#quickChips').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (b) location.hash = '#/s/' + encodeURIComponent(b.dataset.s); });
    window.addEventListener('hashchange', route);
    route();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
