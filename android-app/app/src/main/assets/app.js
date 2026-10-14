"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let DATA = null, BAND = "2.4", SORT = { k: "rssi", dir: -1 };

// ------------------------------------------------------------------ Sistema de Licenciamento & Trava de Dispositivo Offline
const LICENSE_SALT = "CertiFi-Pro-2026-SecLock-MasterSalt#Offline!";

function sha256Sync(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  var words = [];
  var asciiBitLength = ascii.length * 8;
  for (var i = 0; i < ascii.length; i++) {
    words[i >> 2] |= (ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;
  var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  for (var i = 0; i < words.length; i += 16) {
    var w = words.slice(i, i + 16);
    while (w.length < 16) w.push(0);
    var oldHash = hash.slice(0);
    for (var j = 0; j < 64; j++) {
      var w15 = w[j - 15], w2 = w[j - 2];
      var a = hash[0], e = hash[4];
      var s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      var ch = (e & hash[5]) ^ ((~e) & hash[6]);
      var temp1 = (hash[7] + s1 + ch + k[j] + (w[j] = (j < 16) ? (w[j] || 0) : (
        ((w[j - 16] || 0) +
        (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
        (w[j - 7] || 0) +
        (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0
      ))) | 0;
      var s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      var maj = (a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]);
      var temp2 = (s0 + maj) | 0;
      hash = [(temp1 + temp2) | 0, hash[0], hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }
    for (var j = 0; j < 8; j++) hash[j] = (hash[j] + oldHash[j]) | 0;
  }
  var result = '';
  for (var i = 0; i < 8; i++) {
    for (var j = 3; j >= 0; j--) {
      var b = (hash[i] >> (8 * j)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

function getDeviceId() {
  if (window.AndroidWifi && typeof window.AndroidWifi.getDeviceId === "function") {
    try {
      const id = window.AndroidWifi.getDeviceId();
      if (id && id.trim()) return id.trim().toUpperCase();
    } catch (e) {}
  }
  let localId = localStorage.getItem("certifi_device_id");
  if (!localId) {
    try {
      const arr = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      localId = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    } catch (e) {
      localId = "DEV" + Math.random().toString(36).substring(2, 12).toUpperCase();
    }
    localStorage.setItem("certifi_device_id", localId);
  }
  return localId;
}

function computeLicenseKey(deviceId) {
  if (!deviceId) return "";
  const norm = String(deviceId).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!norm) return "";
  const hash = sha256Sync(norm + ":" + LICENSE_SALT).toUpperCase();
  return "CP-" + hash.substring(0, 4) + "-" + hash.substring(4, 8) + "-" + hash.substring(8, 12);
}

function isAppLicensed() {
  const devId = getDeviceId();
  const expectedKey = computeLicenseKey(devId);
  const storedKey = (localStorage.getItem("certifi_license_key") || "").trim().toUpperCase();
  return !!(storedKey && storedKey === expectedKey);
}

function fallbackCopyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}

function checkLicenseGate() {
  const modal = $("#licenseModal");
  if (!modal) return true;

  if (isAppLicensed()) {
    modal.classList.add("hidden");
    return true;
  }

  // Não licenciado: exibe modal bloqueante e prepara UI
  const devId = getDeviceId();
  const devIdEl = $("#displayDeviceId");
  if (devIdEl) devIdEl.textContent = devId;

  const btnCopy = $("#btnCopyDevId");
  if (btnCopy) {
    btnCopy.onclick = () => {
      const doSuccess = () => {
        btnCopy.textContent = "✔ ID Copiado!";
        setTimeout(() => { btnCopy.textContent = "📋 Copiar ID do Aparelho"; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(devId).then(doSuccess).catch(() => {
          fallbackCopyText(devId);
          doSuccess();
        });
      } else {
        fallbackCopyText(devId);
        doSuccess();
      }
    };
  }

  const waBtn = $("#btnWhatsappSupport");
  if (waBtn) {
    const msg = encodeURIComponent(`Olá! Gostaria de ativar meu aplicativo CertiFi Pro.\n\nMeu ID de aparelho é:\n${devId}`);
    waBtn.href = `https://wa.me/?text=${msg}`;
  }

  const btnActivate = $("#btnActivateLicense");
  const inputKey = $("#inputLicenseKey");
  const errDiv = $("#licenseError");

  if (btnActivate && inputKey) {
    btnActivate.onclick = () => {
      const enteredKey = inputKey.value.trim().toUpperCase();
      const expectedKey = computeLicenseKey(devId);
      if (enteredKey && enteredKey === expectedKey) {
        localStorage.setItem("certifi_license_key", enteredKey);
        if (errDiv) errDiv.style.display = "none";
        modal.classList.add("hidden");
        toast("🎉 Licença vitalícia ativada com sucesso!");
        scan();
      } else {
        if (errDiv) {
          errDiv.textContent = "❌ Chave inválida para este aparelho! Verifique os dígitos.";
          errDiv.style.display = "block";
        } else {
          alert("❌ Chave inválida para este aparelho!\n\nVerifique se digitou corretamente ou solicite a chave para o ID: " + devId);
        }
      }
    };
    inputKey.onkeyup = (e) => {
      if (e.key === "Enter") btnActivate.click();
    };
  }

  modal.classList.remove("hidden");
  return false;
}

// ------------------------------------------------------------------ API
function getApiBase() {
  let saved = localStorage.getItem("server_ip");
  if (saved) {
    saved = saved.trim();
    if (saved && !saved.startsWith("http://") && !saved.startsWith("https://")) {
      saved = "http://" + saved;
    }
    return saved ? saved.replace(/\/$/, "") : "";
  }
  if (window.location.protocol.startsWith("http")) {
    return "";
  }
  return null; // Nulo indica rodando via file:// no Android sem IP configurado
}

async function api(path, opts = {}) {
  if (!isAppLicensed()) {
    checkLicenseGate();
    throw new Error("Aplicativo bloqueado: licença individual não ativada.");
  }
  // Dentro do APK: mede direto no celular, sem PC
  if (window.NativeAPI && window.NativeAPI.active()) return window.NativeAPI.handle(path, opts);
  const base = getApiBase();
  if (base === null && window.location.protocol === "file:") {
    throw new Error("🔌 Conecte ao seu PC: Digite o IP do computador no campo acima e clique em 'Conectar' ou 'Detectar IP'.");
  }
  const url = base ? (base + path) : path;
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { "X-Token": window.API_TOKEN || "__TOKEN__", "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const j = await res.json();
    if (!res.ok || j.error) throw new Error(j.error || res.statusText);
    return j;
  } catch (e) {
    if (e.message.includes("Failed to fetch") || e.name === "TypeError") {
      throw new Error(`Não foi possível conectar em "${base || url}". Verifique se o 'python server.py' está rodando no PC e se ambos estão na mesma Wi-Fi.`);
    }
    throw e;
  }
}
function toast(msg, ms = 3500) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function loading(on, text = "Analisando…") {
  $("#loading").classList.toggle("hidden", !on); $("#loadingText").textContent = text;
}
function showError(msg, action) {
  const e = $("#error"); e.textContent = "⚠ " + msg; e.classList.toggle("hidden", !msg);
  e.style.cursor = action ? "pointer" : "";
  e.onclick = action ? () => { try { action(); } catch (x) { } } : null;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sigColor = r => r >= -60 ? "var(--ok)" : r >= -70 ? "var(--warn)" : "var(--bad)";
const sigPct = r => Math.max(0, Math.min(100, (r + 95) / 65 * 100));
const bandLabel = b => b === "2.4" ? "2,4 GHz" : b + " GHz";

// ------------------------------------------------------------------ Tabs & Menu Recolhível
const nav = $("#mainNav");
const btnToggleMenu = $("#btnToggleMenu");
if (btnToggleMenu && nav) {
  btnToggleMenu.onclick = () => {
    nav.classList.toggle("open");
    btnToggleMenu.textContent = nav.classList.contains("open") ? "✕" : "☰";
  };
}

$$("nav button").forEach(b => b.onclick = () => {
  $$("nav button").forEach(x => x.classList.toggle("active", x === b));
  $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  
  // No mobile, recolhe o menu após selecionar uma aba para deixar a tela expandida
  if (nav && nav.classList.contains("open")) {
    nav.classList.remove("open");
    if (btnToggleMenu) btnToggleMenu.textContent = "☰";
  }

  if (b.dataset.tab === "channels") {
    setTimeout(drawCharts, 50);
  }
  if (b.dataset.tab === "signal") {
    setTimeout(drawLive, 50);
    if (!liveTimer) {
      pollSignal();
      startLive();
    }
  }
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
  } catch (e) { showError(e.message, e.action); }
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
  if (!cv) return [null, 0, 0];
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // limita dpr para não estourar memória da GPU no Android
  const rect = cv.getBoundingClientRect();
  const parentWidth = cv.parentElement ? cv.parentElement.clientWidth - 20 : 300;
  const w = Math.max(100, Math.floor(cv.clientWidth || rect.width || parentWidth || 300));
  const h = +cv.getAttribute("height") || 200;
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);

  if (cv.width !== targetW || cv.height !== targetH) {
    cv.width = targetW;
    cv.height = targetH;
    cv.style.height = h + "px";
  }

  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return [ctx, w, h];
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
// ------------------------------------------------------------------ Notificações
function requestNotificationPermission() {
  if (window.AndroidWifi) return; // permissão já pedida pelo app nativo
  if ("Notification" in window && Notification.permission !== "granted") {
    Notification.requestPermission().then(perm => {
      if (perm === "granted") {
        toast("Notificações de auditoria ativadas ✔");
        sendNotification("CertiFi Pro", { body: "Notificações ativadas para auditoria de Wi-Fi!" });
      }
    });
  }
}

function sendNotification(title, options = {}) {
  if (window.AndroidWifi) { try { window.AndroidWifi.notify(title, options.body || ""); } catch (e) { } return; }
  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          icon: "/icon-192.svg",
          badge: "/icon-192.svg",
          vibrate: [200, 100, 200],
          ...options
        });
      });
    } else {
      new Notification(title, { icon: "/icon-192.svg", ...options });
    }
  }
}

$("#btnLive").onclick = () => {
  requestNotificationPermission();
  liveTimer ? stopLive() : startLive();
};
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
  try {
    const W = 600, H = 180;
    const pad = { l: 44, r: 16, t: 14, b: 24 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const Y = v => Math.round(pad.t + Math.max(0, Math.min(1, 1 - (v + 95) / 70)) * plotH);

    const lineEl = $("#svgSignalLine");
    const fillEl = $("#svgFillArea");
    const dotEl = $("#svgCurrentDot");
    const hintEl = $("#svgEmptyHint");

    if (!lineEl || !fillEl || !dotEl) return;

    if (!hist.length) {
      if (hintEl) hintEl.style.display = "block";
      lineEl.setAttribute("points", "");
      fillEl.setAttribute("points", "");
      dotEl.setAttribute("cx", "-20");
      dotEl.setAttribute("cy", "-20");
      return;
    }

    if (hintEl) hintEl.style.display = "none";

    const validHist = hist.filter(p => typeof p.v === "number" && !isNaN(p.v));
    if (!validHist.length) return;

    const maxPoints = Math.max(120, validHist.length);
    const X = i => Math.round(pad.l + (i / (maxPoints - 1)) * plotW);

    if (validHist.length === 1) {
      const px = X(0), py = Y(validHist[0].v);
      lineEl.setAttribute("points", `${px},${py}`);
      fillEl.setAttribute("points", "");
      dotEl.setAttribute("cx", px);
      dotEl.setAttribute("cy", py);
      return;
    }

    const pts = validHist.map((p, i) => `${X(i)},${Y(p.v)}`);
    lineEl.setAttribute("points", pts.join(" "));

    const firstX = X(0), lastX = X(validHist.length - 1);
    const bottomY = H - pad.b;
    const fillPts = [...pts, `${lastX},${bottomY}`, `${firstX},${bottomY}`];
    fillEl.setAttribute("points", fillPts.join(" "));

    const lastPt = validHist[validHist.length - 1];
    dotEl.setAttribute("cx", lastX);
    dotEl.setAttribute("cy", Y(lastPt.v));
  } catch (err) {
    console.warn("drawLive SVG error:", err);
  }
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
async function recordPoint(nameInputId) {
  const inputEl = $(nameInputId);
  const name = (inputEl ? inputEl.value.trim() : "") || `Ponto ${rooms.length + 1}`;
  let vals = hist.slice(-5).map(p => p.v).filter(x => typeof x === "number" && !isNaN(x));

  if (!vals.length) {
    try {
      const s = await api("/api/signal");
      if (s && typeof s.rssi === "number" && !isNaN(s.rssi)) {
        vals = [s.rssi];
      }
    } catch (e) {
      console.warn("api /api/signal error", e);
    }
  }

  // Fallback se ainda não houver RSSI (usa DATA.current.rssi ou padrão)
  if (!vals.length && DATA?.current?.rssi) {
    vals = [DATA.current.rssi];
  }
  if (!vals.length) {
    vals = [-65]; // Fallback seguro para nunca quebrar o registro
  }

  const v = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const room = { name, v, band: DATA?.current?.band || "2.4" };

  // No celular: mede latência e perda reais até o roteador neste ponto (se houver gateway)
  if (window.NativeAPI && window.NativeAPI.active() && DATA?.net?.gateway) {
    try {
      toast(`Medindo latência em "${name}"…`, 1500);
      await new Promise(r => setTimeout(r, 40));
      const p = window.NativeAPI.ping(DATA.net.gateway, 5);
      if (p && p.avg != null) room.lat = p.avg;
      if (p && p.loss != null) room.loss = p.loss;
    } catch (errPing) {
      console.warn("Ping gateway falhou, prosseguindo com registro:", errPing);
    }
  }

  rooms.push(room);
  localStorage.setItem("rooms", JSON.stringify(rooms));
  if (inputEl) inputEl.value = "";
  renderRooms();
  updateCertSummary();
  toast(`📍 ${name}: ${v} dBm${room.lat != null ? ` · ${room.lat} ms` : ""} registrado com sucesso!`);
}

$("#btnMark").onclick = () => recordPoint("#roomName");
$("#btnCertMarkPoint") && ($("#btnCertMarkPoint").onclick = () => recordPoint("#certRoomName"));
$("#btnClearRooms") && ($("#btnClearRooms").onclick = () => {
  if (!rooms.length) return toast("Nenhum ponto para remover.");
  if (confirm("Remover todos os pontos gravados?")) {
    rooms.length = 0;
    localStorage.setItem("rooms", JSON.stringify(rooms));
    renderRooms();
    updateCertSummary();
    toast("Lista de pontos limpa!");
  }
});
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
    latency_gw: r.lat ?? null,
    loss_gw: r.loss ?? 0.0,
    band: r.band || DATA?.current?.band || "2.4"
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
  
  sendNotification(`Laudo Wi-Fi: ${cert.status}`, {
    body: `Certificado ${cert.cert_id} gerado com nota ${cert.overall_score}/100.`
  });
}

$("#btnPrintCert")?.addEventListener("click", () => {
  if (window.AndroidWifi && typeof window.AndroidWifi.printDocument === "function") {
    const certCode = $("#certCode") ? $("#certCode").textContent : "Certificado_WiFi";
    window.AndroidWifi.printDocument(certCode || "Certificado_WiFi");
  } else {
    window.print();
  }
});

// ------------------------------------------------------------------ Server IP UI & Auto Detect
async function autoDetectServer() {
  const statusSpan = $("#serverStatus");
  if (statusSpan) statusSpan.textContent = "🔍 Procurando servidor Python na sua Wi-Fi...";
  toast("Varrendo rede local procurando o PC...");

  const candidateIPs = [];
  const prefixes = ["192.168.1.", "192.168.0.", "192.168.15.", "10.0.0.", "192.168.100."];
  for (const pref of prefixes) {
    for (let i = 2; i <= 254; i += (i < 20 ? 1 : 5)) {
      candidateIPs.push(`${pref}${i}:8765`);
    }
  }

  const checkIp = async (ip) => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`http://${ip}/api/signal`, {
        signal: controller.signal,
        headers: { "X-Token": "__TOKEN__" }
      });
      clearTimeout(tid);
      if (res.ok) return ip;
    } catch (e) {}
    return null;
  };

  const batchSize = 15;
  for (let i = 0; i < candidateIPs.length; i += batchSize) {
    const batch = candidateIPs.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(checkIp));
    const found = results.find(x => x !== null);
    if (found) {
      const formatted = "http://" + found;
      localStorage.setItem("server_ip", formatted);
      const input = $("#serverIpInput");
      if (input) input.value = found;
      if (statusSpan) statusSpan.textContent = "✔ Servidor PC localizado em: " + found;
      toast("Encontrado! Conectado a " + found);
      scan();
      return;
    }
  }

  if (statusSpan) statusSpan.textContent = "❌ Servidor não localizado na varredura. Digite o IP do PC acima e clique em Conectar.";
  toast("Servidor não localizado. Digite o IP do PC.");
}

document.addEventListener("DOMContentLoaded", () => {
  const ipInput = $("#serverIpInput");
  const saveBtn = $("#btnSaveServerIp");
  const autoBtn = $("#btnAutoDetect");
  const statusSpan = $("#serverStatus");

  if (ipInput) {
    ipInput.value = localStorage.getItem("server_ip") || "";
    if (saveBtn) {
      saveBtn.onclick = () => {
        let val = ipInput.value.trim();
        if (val) {
          if (!val.startsWith("http://") && !val.startsWith("https://")) {
            val = "http://" + val;
          }
          localStorage.setItem("server_ip", val);
          if (statusSpan) statusSpan.textContent = "✔ Conectado a " + val;
          toast("Conectando ao servidor: " + val);
        } else {
          localStorage.removeItem("server_ip");
          if (statusSpan) statusSpan.textContent = "";
          toast("IP removido");
        }
        scan();
      };
    }
    if (autoBtn) {
      autoBtn.onclick = autoDetectServer;
    }
  }
});

// ------------------------------------------------------------------ Modo celular (APK)
if (window.NativeAPI && window.NativeAPI.active()) {
  const bar = $("#serverConfigBar");
  if (bar) bar.innerHTML = `<span>📱 <b>Medindo direto neste celular</b> — não precisa de computador</span>`;
  window.onNativePermission = () => {
    if (checkLicenseGate()) scan();
  };
}

// ------------------------------------------------------------------ Início
if (checkLicenseGate()) {
  scan();
}
