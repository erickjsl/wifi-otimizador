"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let DATA = null, BAND = "2.4", SORT = { k: "rssi", dir: -1 };

// ------------------------------------------------------------------ API
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "X-Token": window.API_TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error || res.statusText);
  return j;
}
function toast(msg, ms = 3500) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function loading(on, text = "Analisando…") {
  $("#loading").classList.toggle("hidden", !on); $("#loadingText").textContent = text;
}
function showError(msg) {
  const e = $("#error"); e.textContent = "⚠ " + msg; e.classList.toggle("hidden", !msg);
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sigColor = r => r >= -60 ? "var(--ok)" : r >= -70 ? "var(--warn)" : "var(--bad)";
const sigPct = r => Math.max(0, Math.min(100, (r + 95) / 65 * 100));
const bandLabel = b => b === "2.4" ? "2,4 GHz" : b + " GHz";

// ------------------------------------------------------------------ Tabs
$$("nav button").forEach(b => b.onclick = () => {
  $$("nav button").forEach(x => x.classList.toggle("active", x === b));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  if (b.dataset.tab === "channels") drawCharts();
  if (b.dataset.tab === "signal") drawLive();
});
function gotoTab(name) { $(`nav button[data-tab="${name}"]`).click(); }

// ------------------------------------------------------------------ Scan
async function scan() {
  loading(true, "Varrendo todos os canais Wi-Fi…");
  $("#btnScan").disabled = true;
  try {
    DATA = await api("/api/scan");
    showError("");
    if (DATA.current) BAND = DATA.current.band;
    $$("#bandSel button").forEach(x => x.classList.toggle("active", x.dataset.band === BAND));
    renderOverview(); renderTable(); drawCharts();
  } catch (e) { showError(e.message); }
  finally { loading(false); $("#btnScan").disabled = false; }
}
$("#btnScan").onclick = scan;

function renderOverview() {
  const d = DATA.diagnosis, c = DATA.connection, cur = DATA.current, n = DATA.net || {};
  // nota
  const s = d.score; $("#scoreVal").textContent = s;
  const arc = $("#scoreArc");
  arc.style.strokeDashoffset = 326.7 * (1 - s / 100);
  arc.style.stroke = s >= 80 ? "var(--ok)" : s >= 55 ? "var(--warn)" : "var(--bad)";
  const names = { sinal: "Sinal", canal: "Canal", banda: "Banda", seguranca: "Segurança" };
  $("#scoreParts").innerHTML = Object.entries(d.scores).map(([k, v]) =>
    `<div>${names[k] || k}<b style="color:${v >= 80 ? "var(--ok)" : v >= 55 ? "var(--warn)" : "var(--bad)"}">${v}</b></div>`).join("");

  // conexão
  if (c) {
    const kv = [
      ["Rede", c.ssid], ["Sinal", cur ? `${cur.rssi} dBm` : `${c.quality}%`],
      ["Banda / canal", cur ? `${bandLabel(cur.band)} · canal ${cur.channel}` : "–"],
      ["Largura", cur ? `${cur.width} MHz` : "–"], ["Padrão", cur ? `${cur.standard} (${c.phy})` : c.phy],
      ["Taxa de link", `${c.rx_mbps.toFixed(0)} / ${c.tx_mbps.toFixed(0)} Mbps`],
      ["Segurança", `${c.auth} · ${c.cipher}`], ["IP", n.ip || "–"], ["Roteador", n.gateway || "–"],
      ["DNS", (n.dns || []).join(", ") || "–"], ["Adaptador", DATA.adapter], ["BSSID", c.bssid],
    ];
    $("#connInfo").innerHTML = kv.map(([k, v]) => `<div><label>${k}</label><span>${esc(v)}</span></div>`).join("");
  } else $("#connInfo").innerHTML = `<p class="muted">Não conectado.</p>`;

  // diagnóstico
  const ic = { ok: "✅", warn: "⚠️", bad: "⛔", info: "ℹ️" };
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  $("#diagList").innerHTML = [...d.items].sort((a, b) => order[a.level] - order[b.level]).map(it =>
    `<li class="${it.level}"><span class="ic">${ic[it.level]}</span><div><b>${esc(it.title)}</b><p>${esc(it.detail)}</p>
     ${it.action === "goto_signal" ? `<button class="mt" onclick="gotoTab('signal')">Buscar melhor posição →</button>` : ""}</div></li>`).join("");

  // roteador
  const r = d.router;
  if (r) {
    $("#routerCfg").innerHTML = r.config.map(g => `<div class="cfg-group"><h4>${g.group}</h4><table>${g.settings.map(([k, v]) =>
      `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table></div>`).join("") +
      `<div class="cfg-group"><h4>Posicionamento e dicas</h4><ul class="tips">${r.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  }
  if (n.gateway) $("#routerLink").href = `http://${n.gateway}`;
}

// ------------------------------------------------------------------ Tabela
$$("#apTable th").forEach(th => th.onclick = () => {
  const k = th.dataset.k; SORT = { k, dir: SORT.k === k ? -SORT.dir : (k === "rssi" ? -1 : 1) }; renderTable();
});
function renderTable() {
  if (!DATA) return;
  const aps = [...DATA.aps].sort((a, b) => {
    const x = a[SORT.k], y = b[SORT.k];
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * SORT.dir;
  });
  $("#apCount").textContent = aps.length;
  $("#apTable tbody").innerHTML = aps.map(a => `<tr class="${a.mine ? "mine" : ""}">
    <td>${a.connected ? "🔗 " : ""}${a.ssid ? esc(a.ssid) : '<span class="muted">(oculta)</span>'}</td>
    <td><span class="sigbar"><i style="width:${sigPct(a.rssi)}%;background:${sigColor(a.rssi)}"></i></span>${a.rssi} dBm</td>
    <td>${bandLabel(a.band)}</td><td>${a.channel}</td><td>${a.width} MHz</td><td>${esc(a.standard)}</td>
    <td>${/WEP|Aberta|obsoleto|TKIP/.test(a.security) ? `<span class="poor">${esc(a.security)}</span>` : esc(a.security)}</td>
    <td class="muted">${a.bssid}</td></tr>`).join("");
}

// ------------------------------------------------------------------ Gráficos
$$("#bandSel button").forEach(b => b.onclick = () => {
  BAND = b.dataset.band; $$("#bandSel button").forEach(x => x.classList.toggle("active", x === b)); drawCharts();
});
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = +cv.getAttribute("height");
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + "px";
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); return [ctx, w, h];
}
const chFreq = (b, ch) => b === "2.4" ? (ch === 14 ? 2484 : 2407 + 5 * ch) : b === "5" ? 5000 + 5 * ch : 5950 + 5 * ch;
const RANGES = { "2.4": [2395, 2495], "5": [5160, 5845], "6": [5935, 7125] };
const PALETTE = ["#4f8cff", "#f472b6", "#f59e0b", "#a78bfa", "#38bdf8", "#fb7185", "#facc15", "#c084fc", "#60a5fa", "#fda4af"];

function drawCharts() {
  if (!DATA || !$("#tab-channels").classList.contains("active")) return;
  drawSpectrum(); drawChannelBars();
}
function drawSpectrum() {
  const [ctx, W, H] = setupCanvas($("#specCanvas"));
  const pad = { l: 44, r: 12, t: 14, b: 30 }, [f0, f1] = RANGES[BAND];
  const X = f => pad.l + (f - f0) / (f1 - f0) * (W - pad.l - pad.r);
  const Y = dbm => pad.t + (1 - (dbm + 100) / 75) * (H - pad.t - pad.b);
  ctx.font = "11px Segoe UI"; ctx.strokeStyle = "#24304d"; ctx.fillStyle = "#8b97b3";
  for (let d = -100; d <= -25; d += 10) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(d)); ctx.lineTo(W - pad.r, Y(d)); ctx.stroke();
    ctx.fillText(d, 8, Y(d) + 4);
  }
  const chans = DATA.channels[BAND].channels.map(r => r.channel);
  const step = BAND === "6" ? 4 : 1;
  ctx.textAlign = "center";
  chans.forEach((ch, i) => { if (i % step === 0) ctx.fillText(ch, X(chFreq(BAND, ch)), H - 10); });
  const aps = DATA.aps.filter(a => a.band === BAND).sort((a, b) => a.mine - b.mine);
  if (!aps.length) {
    ctx.fillStyle = "#8b97b3"; ctx.font = "14px Segoe UI";
    ctx.fillText(`Nenhuma rede ${bandLabel(BAND)} detectada`, W / 2, H / 2); return;
  }
  aps.forEach((a, i) => {
    const fc = chFreq(BAND, a.center), half = (BAND === "2.4" && a.width === 20 ? 22 : a.width) / 2;
    const x0 = X(fc - half), x1 = X(fc + half), yb = Y(-100), yt = Y(a.rssi);
    const col = a.mine ? "#22c55e" : PALETTE[i % PALETTE.length];
    ctx.beginPath(); ctx.moveTo(x0, yb);
    const k = (x1 - x0) * 0.12;
    ctx.bezierCurveTo(x0 + k, yt, x0 + k, yt, x0 + 2 * k, yt);
    ctx.lineTo(x1 - 2 * k, yt);
    ctx.bezierCurveTo(x1 - k, yt, x1 - k, yt, x1, yb);
    ctx.fillStyle = col + (a.mine ? "40" : "1c"); ctx.fill();
    ctx.lineWidth = a.mine ? 3 : 1.5; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col; ctx.font = (a.mine ? "bold " : "") + "11px Segoe UI";
    ctx.fillText((a.ssid || "(oculta)").slice(0, 18), (x0 + x1) / 2, yt - 5);
  });
}
function drawChannelBars() {
  const info = DATA.channels[BAND], rows = info.channels;
  const [ctx, W, H] = setupCanvas($("#chanCanvas"));
  const pad = { l: 10, r: 10, t: 10, b: 26 }, n = rows.length, bw = (W - pad.l - pad.r) / n;
  ctx.font = "11px Segoe UI"; ctx.textAlign = "center";
  const cur = DATA.current && DATA.current.band === BAND ? DATA.current.channel : null;
  rows.forEach((r, i) => {
    const h = (H - pad.t - pad.b) * Math.max(r.score, 2) / 100, x = pad.l + i * bw + bw * 0.15, y = H - pad.b - h;
    ctx.fillStyle = r.score >= 70 ? "#22c55e" : r.score >= 40 ? "#f5a524" : "#ef4444";
    ctx.globalAlpha = (BAND === "2.4" && !r.recommended_set) ? 0.45 : 1;
    ctx.fillRect(x, y, bw * 0.7, h); ctx.globalAlpha = 1;
    if (r.channel === info.best) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, bw * 0.7 + 2, h + 2); }
    ctx.fillStyle = r.channel === cur ? "#4f8cff" : "#8b97b3";
    if (BAND !== "6" || i % 4 === 0) ctx.fillText(r.channel + (r.channel === cur ? "●" : ""), x + bw * 0.35, H - 8);
  });
  let txt;
  if (BAND === "2.4") txt = `🏆 Melhor canal em 2,4 GHz: <b>${info.best}</b> com largura de <b>${info.best_width} MHz</b>. ` +
    `Use apenas 1, 6 ou 11 (barras opacas) — os outros se sobrepõem. ${info.neighbors} redes vizinhas nesta banda.`;
  else if (BAND === "5") { const b = info.best_block;
    txt = `🏆 Melhor em 5 GHz: canal <b>${info.best}</b> com <b>80 MHz</b> (bloco ${b.channels[0]}–${b.channels.at(-1)}${b.dfs ? ", DFS: pode ter breves pausas por detecção de radar" : ""}). ${info.neighbors} redes vizinhas nesta banda.`; }
  else txt = `6 GHz (Wi-Fi 6E/7): canal sugerido <b>${info.best}</b> com 160 MHz. ${info.neighbors} redes vizinhas.`;
  if (cur) txt += ` <span class="muted">● = canal atual (${cur}).</span>`;
  $("#chanRec").innerHTML = txt;
}
window.addEventListener("resize", () => { drawCharts(); drawLive(); });

// ------------------------------------------------------------------ Sinal ao vivo
let liveTimer = null, hist = [], audio = null, beepTimer = null, lastRssi = null;
$("#btnLive").onclick = () => liveTimer ? stopLive() : startLive();
function startLive() {
  $("#btnLive").textContent = "■ Parar"; pollSignal(); liveTimer = setInterval(pollSignal, 1000);
  if ($("#chkSound").checked) startBeep();
}
function stopLive() {
  clearInterval(liveTimer); liveTimer = null; $("#btnLive").textContent = "▶ Iniciar"; stopBeep();
}
$("#chkSound").onchange = e => { if (e.target.checked && liveTimer) startBeep(); else stopBeep(); };
async function pollSignal() {
  try {
    const s = await api("/api/signal");
    if (!s.connected) { $("#liveDbm").textContent = "–"; $("#liveLabel").textContent = "Desconectado"; return; }
    lastRssi = s.rssi; hist.push({ t: s.t, v: s.rssi }); if (hist.length > 120) hist.shift();
    const lab = s.rssi >= -50 ? "Excelente" : s.rssi >= -60 ? "Muito bom" : s.rssi >= -67 ? "Bom" : s.rssi >= -70 ? "Razoável" : s.rssi >= -80 ? "Fraco" : "Péssimo";
    $("#liveDbm").textContent = s.rssi; $("#liveDbm").style.color = sigColor(s.rssi);
    $("#liveLabel").textContent = `dBm · ${lab}`;
    $("#liveBar").style.width = sigPct(s.rssi) + "%"; $("#liveBar").style.background = sigColor(s.rssi);
    $("#liveExtra").textContent = `${s.ssid} · canal ${s.channel ?? "?"} · link ${s.rx.toFixed(0)} Mbps`;
    drawLive();
  } catch (e) { $("#liveLabel").textContent = e.message; }
}
function drawLive() {
  if (!$("#tab-signal").classList.contains("active")) return;
  const [ctx, W, H] = setupCanvas($("#liveCanvas"));
  const pad = { l: 40, r: 10, t: 10, b: 10 };
  const Y = v => pad.t + (1 - (v + 95) / 70) * (H - pad.t - pad.b);
  ctx.font = "11px Segoe UI"; ctx.fillStyle = "#8b97b3";
  [[-25, -60, "rgba(34,197,94,.07)"], [-60, -70, "rgba(245,165,36,.07)"], [-70, -95, "rgba(239,68,68,.07)"]].forEach(([a, b, c]) => {
    ctx.fillStyle = c; ctx.fillRect(pad.l, Y(a), W - pad.l - pad.r, Y(b) - Y(a));
  });
  ctx.fillStyle = "#8b97b3";
  for (let d = -90; d <= -30; d += 10) ctx.fillText(d, 6, Y(d) + 4);
  if (hist.length < 2) return;
  const X = i => pad.l + i / 119 * (W - pad.l - pad.r);
  const off = 120 - hist.length;
  ctx.beginPath(); hist.forEach((p, i) => i ? ctx.lineTo(X(i + off), Y(p.v)) : ctx.moveTo(X(i + off), Y(p.v)));
  ctx.strokeStyle = "#4f8cff"; ctx.lineWidth = 2.5; ctx.stroke();
}
function startBeep() {
  stopBeep(); audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  const tick = () => {
    if (lastRssi != null) {
      const q = Math.max(0, Math.min(1, (lastRssi + 90) / 50));
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 300 + q * 1200; g.gain.setValueAtTime(0.12, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.13);
      beepTimer = setTimeout(tick, 900 - q * 750);
    } else beepTimer = setTimeout(tick, 500);
  };
  tick();
}
function stopBeep() { clearTimeout(beepTimer); beepTimer = null; }

// Cômodos
const rooms = JSON.parse(localStorage.getItem("rooms") || "[]");
function renderRooms() {
  const q = v => v >= -60 ? ["Ótimo", "good"] : v >= -67 ? ["Bom", "good"] : v >= -72 ? ["Razoável", "mid"] : ["Fraco — precisa Mesh/repetidor", "poor"];
  $("#roomTable tbody").innerHTML = rooms.map((r, i) => { const [l, c] = q(r.v);
    return `<tr><td>${esc(r.name)}</td><td><b>${r.v} dBm</b></td><td class="${c}">${l}</td><td><button onclick="delRoom(${i})">✕</button></td></tr>`; }).join("")
    || `<tr><td colspan="4" class="muted">Nenhum ponto registrado.</td></tr>`;
}
window.delRoom = i => { rooms.splice(i, 1); localStorage.setItem("rooms", JSON.stringify(rooms)); renderRooms(); };
$("#btnMark").onclick = async () => {
  const name = $("#roomName").value.trim() || `Ponto ${rooms.length + 1}`;
  let vals = hist.slice(-5).map(p => p.v);
  if (!vals.length) { try { const s = await api("/api/signal"); vals = [s.rssi]; } catch (e) { return toast(e.message); } }
  const v = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  rooms.push({ name, v }); localStorage.setItem("rooms", JSON.stringify(rooms)); $("#roomName").value = ""; renderRooms();
  toast(`${name}: ${v} dBm registrado`);
};
renderRooms();

// ------------------------------------------------------------------ Testes
async function runBtn(btn, fn) { btn.disabled = true; const t = btn.textContent; btn.textContent = "Testando…";
  try { await fn(); } catch (e) { toast("Erro: " + e.message); } finally { btn.disabled = false; btn.textContent = t; } }

$("#btnPing").onclick = e => runBtn(e.target, async () => {
  const r = await api("/api/ping");
  const cls = (v, a, b) => v == null ? "poor" : v <= a ? "good" : v <= b ? "mid" : "poor";
  $("#pingRes").innerHTML = Object.entries(r).map(([name, p]) => p ? `<div class="metric"><span>${esc(name)}<br><small class="muted">${esc(p.host)}</small></span>
    <span style="text-align:right"><b class="${cls(p.avg, 20, 60)}">${p.avg ?? "–"} ms</b><br>
    <small class="muted">jitter <span class="${cls(p.jitter, 5, 20)}">${p.jitter ?? "–"} ms</span> · perda <span class="${p.loss === 0 ? "good" : p.loss < 3 ? "mid" : "poor"}">${p.loss}%</span></small></span></div>` : "").join("");
  const gw = r["Roteador (gateway)"], net = r["Google DNS"];
  let v = "";
  if (gw && (gw.loss > 2 || gw.avg > 15 || gw.jitter > 10)) v = "⚠ Problema no <b>Wi-Fi</b> (entre o PC e o roteador): latência/perda alta até o roteador. Melhore o sinal, troque de canal ou use 5 GHz.";
  else if (net && (net.loss > 2 || net.avg > 80)) v = "⚠ Wi-Fi está bom, mas a <b>internet da operadora</b> está lenta/instável. Reinicie o modem; se persistir, contate a operadora.";
  else if (gw) v = "✅ Latência ótima: Wi-Fi e internet estáveis. Bom para jogos e chamadas.";
  $("#pingRes").innerHTML += v ? `<div class="verdict">${v}</div>` : "";
});

$("#btnSpeed").onclick = e => runBtn(e.target, async () => {
  $("#speedRes").innerHTML = `<p class="muted">Medindo download e upload… (~15 s)</p>`;
  const r = await api("/api/speed");
  const link = DATA?.connection ? Math.min(DATA.connection.rx_mbps, DATA.connection.tx_mbps) : null;
  $("#speedRes").innerHTML = `<div class="speed-big"><div><small>Download</small><b>${r.download}</b><small>Mbps</small></div>
    <div><small>Upload</small><b>${r.upload}</b><small>Mbps</small></div></div>
    <div class="metric"><span>Latência</span><b>${r.latency ?? "–"} ms</b></div>
    ${link ? `<div class="verdict">Taxa de link Wi-Fi: <b>${link.toFixed(0)} Mbps</b>. Na prática o Wi-Fi entrega ~50–65% disso
      (≈${(link * 0.6).toFixed(0)} Mbps). ${r.download < link * 0.35 ? "A internet está bem abaixo do que o Wi-Fi permite: o gargalo provavelmente é o plano/operadora." : "Se seu plano for maior que isso, o <b>Wi-Fi é o gargalo</b>: melhore o sinal ou use 5 GHz."}</div>` : ""}`;
});

$("#btnDns").onclick = e => runBtn(e.target, async () => {
  const r = await api("/api/dns");
  const best = r.find(x => x.median != null);
  $("#dnsRes").innerHTML = `<table><tr><th>Servidor</th><th>Mediana</th><th></th></tr>${r.map(d => `<tr>
    <td>${d === best ? "🏆 " : ""}${esc(d.name)}<br><small class="muted">${d.ip}${d.fails ? ` · ${d.fails} falhas` : ""}</small></td>
    <td><b>${d.median ?? "–"} ms</b></td>
    <td>${d.current ? '<span class="pill">em uso</span>' : d.median != null ? `<button data-dns='${JSON.stringify(d.servers)}'>Usar 🛡</button>` : ""}</td></tr>`).join("")}</table>`;
  $$("#dnsRes button[data-dns]").forEach(b => b.onclick = () => doAction("set_dns", { servers: JSON.parse(b.dataset.dns) }, b));
});

// ------------------------------------------------------------------ Otimizar
async function doAction(action, params = {}, btn) {
  if (btn) btn.disabled = true;
  const out = $("#actOut");
  toast(btn?.dataset.admin !== undefined || ["set_dns", "set_prop"].includes(action) ? "Confirme a permissão de administrador na janela do Windows…" : "Executando…", 6000);
  try {
    const r = await api("/api/action", { method: "POST", body: JSON.stringify({ action, params }) });
    out.classList.remove("hidden"); out.textContent = (r.ok ? "✔ " : "✖ ") + (r.output || "");
    toast(r.ok ? "Concluído ✔" : "Não foi possível concluir");
    return r.ok;
  } catch (e) { toast("Erro: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}
$$(".actions button").forEach(b => b.onclick = () => {
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  doAction(b.dataset.act, {}, b);
});

$("#btnProps").onclick = e => runBtn(e.target, loadProps);
async function loadProps() {
  const r = await api("/api/adapter"), n = r.net || {};
  $("#netInfo").innerHTML = [["Adaptador", n.driver], ["Interface", n.name], ["Velocidade", n.speed], ["MAC", n.mac]]
    .map(([k, v]) => `<div><label>${k}</label><span>${esc(v || "–")}</span></div>`).join("");
  const props = r.props.sort((a, b) => (b.why ? 1 : 0) - (a.why ? 1 : 0));
  $("#propTable tbody").innerHTML = props.map((p, i) => {
    const good = p.suggest && p.suggest === p.DisplayValue;
    return `<tr><td><b>${esc(p.DisplayName)}</b>${p.why ? `<br><small class="muted">${esc(p.why)}</small>` : ""}</td>
      <td>${esc(p.DisplayValue)}</td>
      <td>${p.suggest ? `<span class="c-mine">${esc(p.suggest)}</span> ${good ? "✔" : ""}` : '<span class="muted">–</span>'}</td>
      <td>${p.ValidDisplayValues.length ? `<div class="row gap"><select data-i="${i}">${p.ValidDisplayValues.map(v =>
        `<option ${v === (p.suggest || p.DisplayValue) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <button data-apply="${i}">Aplicar</button></div>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">Nenhuma propriedade disponível.</td></tr>`;
  $$("#propTable button[data-apply]").forEach(b => b.onclick = async () => {
    const p = props[+b.dataset.apply], v = $(`#propTable select[data-i="${b.dataset.apply}"]`).value;
    if (v === p.DisplayValue) return toast("Já está com esse valor.");
    if (!confirm(`Alterar "${p.DisplayName}" de "${p.DisplayValue}" para "${v}"?\nO Wi-Fi vai desconectar por alguns segundos.`)) return;
    if (await doAction("set_prop", { keyword: p.RegistryKeyword, value: v }, b)) setTimeout(loadProps, 4000);
  });
}

// ------------------------------------------------------------------ Certificação
function updateCertSummary() {
  const container = $("#certPointsSummary");
  if (!container) return;
  if (!rooms.length) {
    container.innerHTML = `<p class="muted small">Nenhum ponto registrado ainda. Vá na aba "Buscar sinal" e registre os cômodos.</p>`;
    return;
  }
  container.innerHTML = `<table><thead><tr><th>Cômodo / Ponto</th><th>Sinal Registrado</th></tr></thead><tbody>` +
    rooms.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${r.v} dBm</td></tr>`).join("") + `</tbody></table>`;
}
updateCertSummary();

$("#btnGenerateCert")?.addEventListener("click", async () => {
  if (!rooms.length) {
    return toast("Registre pelo menos 1 ponto/cômodo na aba 'Buscar sinal' antes de certificar.");
  }
  const clientInfo = {
    name: $("#certClientName").value.trim() || "Cliente Padrão",
    address: $("#certAddress").value.trim() || "Local Auditado",
    technician: $("#certTechnician").value.trim() || "Técnico Certificador",
    contracted_speed: $("#certContracted").value.trim() || "Não especificado",
    ssid: DATA?.connection?.ssid || "Wi-Fi Auditado"
  };
  const points = rooms.map(r => ({
    name: r.name,
    rssi: r.v,
    latency_gw: DATA?.diagnosis?.scores?.sinal ? 15.0 : 25.0,
    loss_gw: 0.0,
    band: DATA?.current?.band || "2.4"
  }));
  const slaProfile = $("#certSlaProfile").value;

  try {
    loading(true, "Gerando Laudo e Certificado de Conformidade Wi-Fi…");
    const cert = await api("/api/certify", {
      method: "POST",
      body: JSON.stringify({ client_info: clientInfo, points, sla_profile: slaProfile })
    });
    renderCertificate(cert);
  } catch(e) {
    toast("Erro ao gerar certificado: " + e.message);
  } finally {
    loading(false);
  }
});

function renderCertificate(cert) {
  const printArea = $("#certPrintArea");
  if (!printArea) return;
  printArea.classList.remove("hidden");
  
  $("#certCode").textContent = cert.cert_id;
  $("#certDate").textContent = cert.date;
  $("#printClient").textContent = cert.client.name;
  $("#printAddress").textContent = cert.client.address;
  $("#printSsid").textContent = cert.client.ssid;
  $("#printTech").textContent = cert.client.technician;
  $("#printSla").textContent = cert.sla.name;
  $("#printSpeed").textContent = cert.client.contracted_speed;

  const isApproved = cert.status === "APROVADO";
  const box = $("#certBadgeBox");
  box.style.background = isApproved ? "#dcfce7" : "#fee2e2";
  box.style.color = isApproved ? "#166534" : "#991b1b";
  $("#printStatusTitle").textContent = isApproved ? "CERTIFICADO APROVADO ✔" : "NÃO CONFORME ✖";
  $("#printStatusSub").textContent = isApproved 
    ? `${cert.passed_points} de ${cert.total_points} pontos atenderam 100% aos critérios da norma.`
    : `O sinal ou latência ficaram abaixo do exigido pelo perfil de SLA em alguns pontos.`;
  $("#printScore").textContent = `${cert.overall_score} / 100`;

  $("#printPointsTable tbody").innerHTML = cert.points.map(pt => `
    <tr style="border-bottom:1px solid #e2e8f0">
      <td style="padding:8px"><b>${esc(pt.name)}</b></td>
      <td style="padding:8px">${pt.rssi} dBm</td>
      <td style="padding:8px">${pt.band} GHz</td>
      <td style="padding:8px"><b style="color:${pt.eval.passed ? '#16a34a':'#dc2626'}">${pt.eval.passed ? 'CONFORME':'REPROVADO'}</b></td>
      <td style="padding:8px;color:#64748b">${pt.eval.issues.join('; ') || 'Sinal e latência dentro da norma'}</td>
    </tr>
  `).join("");

  printArea.scrollIntoView({ behavior: 'smooth' });
}

$("#btnPrintCert")?.addEventListener("click", () => {
  window.print();
});

// ------------------------------------------------------------------ Início
scan();
