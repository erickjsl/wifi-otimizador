/* CertiFi Pro — backend nativo Android.
 * Quando o app roda dentro do APK (window.AndroidWifi existe), todas as chamadas /api/* são
 * respondidas aqui, usando o Wi-Fi do próprio celular. Não precisa de PC nem de servidor.
 * Port de analysis.py e certify.py.
 */
"use strict";
(function () {
  const A = window.AndroidWifi;

  // ---------------------------------------------------------------- Constantes
  const CH_24 = Array.from({ length: 13 }, (_, i) => i + 1);
  const NON_OVERLAP_24 = [1, 6, 11];
  const CH_5_20 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
  const isDfs = ch => ch >= 52 && ch <= 144;
  const BLOCKS_5_80 = { 42: [36, 40, 44, 48], 58: [52, 56, 60, 64], 106: [100, 104, 108, 112], 122: [116, 120, 124, 128], 138: [132, 136, 140, 144], 155: [149, 153, 157, 161] };
  const CH_6_20 = []; for (let c = 1; c < 234; c += 4) CH_6_20.push(c);

  const chFreq = (band, ch) => band === "2.4" ? (ch === 14 ? 2484 : 2407 + 5 * ch) : band === "5" ? 5000 + 5 * ch : 5950 + 5 * ch;
  const bandOf = f => f < 2500 ? "2.4" : f < 5925 ? "5" : "6";
  const chOf = f => f === 2484 ? 14 : f < 2500 ? Math.round((f - 2407) / 5) : f < 5925 ? Math.round((f - 5000) / 5) : Math.round((f - 5950) / 5);
  const minBy = (arr, key) => arr.reduce((b, x) => (b === null || cmp(key(x), key(b)) < 0 ? x : b), null);
  const cmp = (a, b) => Array.isArray(a) ? (a[0] - b[0] || a[1] - b[1]) : a - b;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const J = s => { try { return JSON.parse(s); } catch (e) { return null; } };

  // ---------------------------------------------------------------- Conversão dos dados do Android
  function stdName(code, band) {
    switch (code) {
      case 8: return ["Wi-Fi 7", "802.11be"];
      case 6: return band === "6" ? ["Wi-Fi 6E", "802.11ax"] : ["Wi-Fi 6", "802.11ax"];
      case 5: return ["Wi-Fi 5", "802.11ac"];
      case 4: return ["Wi-Fi 4", "802.11n"];
      case 1: return ["Legado", "802.11a/b/g"];
      default: return band === "2.4" ? ["Wi-Fi 4", "802.11n"] : band === "6" ? ["Wi-Fi 6E", "802.11ax"] : ["Wi-Fi 5", "802.11ac"];
    }
  }
  function security(caps) {
    caps = caps || "";
    const tkipOnly = /TKIP/.test(caps) && !/CCMP/.test(caps);
    if (/WEP/.test(caps)) return "WEP (obsoleto)";
    if (/EAP/.test(caps)) return /SAE|EAP_SUITE_B/.test(caps) ? "WPA3-Enterprise" : "WPA2-Enterprise";
    if (/SAE/.test(caps) && /PSK/.test(caps)) return "WPA2/WPA3-Personal";
    if (/SAE/.test(caps)) return "WPA3-Personal";
    if (/OWE/.test(caps)) return "OWE (Aberta criptografada)";
    if (/RSN-PSK|WPA2-PSK/.test(caps)) return tkipOnly ? "WPA2 TKIP" : "WPA2-Personal";
    if (/WPA-PSK/.test(caps)) return "WPA (obsoleto)";
    return "Aberta";
  }
  function toAp(r) {
    const band = bandOf(r.freq);
    const channel = chOf(r.freq);
    const center = r.center0 > 0 && r.width > 20 ? chOf(r.center0) : channel;
    const [standard, phy] = stdName(r.std, band);
    return { ssid: r.ssid || "", bssid: r.bssid, rssi: r.rssi, band, channel, center, width: r.width || 20, standard, phy, security: security(r.caps) };
  }

  function sameDevice(a, b) {
    try {
      const x = a.split(":").map(h => parseInt(h, 16)), y = b.split(":").map(h => parseInt(h, 16));
      if ((x[0] & 0xFD) !== (y[0] & 0xFD) || x[1] !== y[1] || x[2] !== y[2]) return false;
      if (x[4] === y[4] && x[5] === y[5]) return true;
      return x[3] === y[3] && x[4] === y[4] && Math.abs(x[5] - y[5]) <= 16;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- Análise de canais
  function apSpan(ap) {
    const fc = chFreq(ap.band, ap.center);
    let w = ap.width; if (ap.band === "2.4" && w === 20) w = 22;
    return [fc - w / 2, fc + w / 2];
  }
  function interference(band, lo, hi, aps) {
    let mw = 0, count = 0;
    for (const ap of aps) {
      if (ap.band !== band) continue;
      const [a0, a1] = apSpan(ap);
      const ov = Math.max(0, Math.min(hi, a1) - Math.max(lo, a0));
      if (ov <= 0) continue;
      mw += Math.pow(10, ap.rssi / 10) * (ov / (a1 - a0)); count++;
    }
    return [mw > 0 ? Math.round(10 * Math.log10(mw) * 10) / 10 : -100, count];
  }
  const channelScore = dbm => Math.trunc(Math.max(0, Math.min(100, (-40 - dbm) / 55 * 100)));

  function analyzeChannels(aps, mine) {
    const others = aps.filter(a => !mine.has(a.bssid));
    const res = {};
    const rows = CH_24.map(ch => { const f = chFreq("2.4", ch); const [dbm, n] = interference("2.4", f - 11, f + 11, others);
      return { channel: ch, dbm, aps: n, score: channelScore(dbm), recommended_set: NON_OVERLAP_24.includes(ch) }; });
    const best = minBy(rows.filter(r => r.recommended_set), r => [r.dbm, r.aps]);
    const strong = others.filter(a => a.band === "2.4" && a.rssi > -82);
    res["2.4"] = { channels: rows, best: best.channel, best_width: strong.length >= 2 ? 20 : 40, neighbors: others.filter(a => a.band === "2.4").length };

    const rows5 = CH_5_20.map(ch => { const f = chFreq("5", ch); const [dbm, n] = interference("5", f - 10, f + 10, others);
      return { channel: ch, dbm, aps: n, score: channelScore(dbm), dfs: isDfs(ch) }; });
    const blocks = Object.entries(BLOCKS_5_80).map(([c, chans]) => {
      const center = +c, f = chFreq("5", center); const [dbm, n] = interference("5", f - 40, f + 40, others);
      const prim = minBy(rows5.filter(r => chans.includes(r.channel)), r => r.dbm);
      return { center, channels: chans, dbm, aps: n, dfs: isDfs(center), primary: prim.channel, score: channelScore(dbm) };
    });
    const bestNd = minBy(blocks.filter(b => !b.dfs), b => [b.dbm, b.aps]);
    const bestAny = minBy(blocks, b => [b.dbm, b.aps]);
    const best5 = bestAny.dbm < bestNd.dbm - 6 ? bestAny : bestNd;
    res["5"] = { channels: rows5, blocks, best: best5.primary, best_block: best5, best_width: 80, neighbors: others.filter(a => a.band === "5").length };

    const rows6 = CH_6_20.map(ch => { const f = chFreq("6", ch); const [dbm, n] = interference("6", f - 10, f + 10, others);
      return { channel: ch, dbm, aps: n, score: channelScore(dbm) }; });
    res["6"] = { channels: rows6, best: minBy(rows6, r => r.dbm).channel, best_width: 160, neighbors: others.filter(a => a.band === "6").length };
    return res;
  }

  // ---------------------------------------------------------------- Diagnóstico
  function signalLevel(rssi) {
    if (rssi == null) return ["desconhecido", 0];
    const label = rssi >= -50 ? "Excelente" : rssi >= -60 ? "Muito bom" : rssi >= -67 ? "Bom" : rssi >= -70 ? "Razoável" : rssi >= -80 ? "Fraco" : "Péssimo";
    return [label, Math.trunc(Math.max(0, Math.min(100, (rssi + 90) / 40 * 100)))];
  }

  function diagnose(conn, cur, channels, mine) {
    const items = [], scores = {};
    if (!conn) {
      items.push({ level: "bad", title: "Sem conexão Wi-Fi", detail: "O celular não está conectado a nenhuma rede Wi-Fi. Conecte-se à rede que deseja analisar." });
      return { items, score: 0, scores: {}, router: recommendRouter(channels, new Set(), null) };
    }
    const rssi = cur ? cur.rssi : conn.rssi;
    const [label, sSig] = signalLevel(rssi); scores.sinal = sSig;
    const band = cur ? cur.band : "?", ch = cur ? cur.channel : null;

    if (rssi >= -60) items.push({ level: "ok", title: `Sinal ${label} (${rssi} dBm)`, detail: "Intensidade ótima para streaming 4K, chamadas e jogos." });
    else if (rssi >= -70) items.push({ level: "warn", title: `Sinal ${label} (${rssi} dBm)`, detail: "Funciona, mas perde velocidade. Use a aba 'Buscar sinal' para achar uma posição melhor, ou aproxime o roteador. Ideal: acima de -60 dBm." });
    else items.push({ level: "bad", title: `Sinal ${label} (${rssi} dBm)`, detail: "Sinal fraco causa lentidão, quedas e alta latência. Soluções: 1) reposicionar o roteador (centro da casa, alto, longe de paredes/espelhos/micro-ondas); 2) usar a aba 'Buscar sinal' para achar o melhor ponto; 3) instalar Mesh ou ponto de acesso cabeado.", action: "goto_signal" });

    const myBands = new Set(mine.map(a => a.band));
    const my5 = mine.filter(a => a.band === "5" || a.band === "6");
    if (band === "2.4") {
      if (my5.length) {
        const b5 = my5.reduce((a, b) => a.rssi > b.rssi ? a : b);
        if (b5.rssi >= -72) items.push({ level: "warn", title: "Conectado em 2,4 GHz, mas há 5 GHz disponível", detail: `Seu roteador também transmite em ${b5.band} GHz ('${b5.ssid || "oculta"}', ${b5.rssi} dBm). 5 GHz é até 5x mais rápido e sofre muito menos interferência. Conecte-se a ela.` });
        else items.push({ level: "info", title: "5 GHz existe, mas está fraco aqui", detail: `A rede 5 GHz chega com ${b5.rssi} dBm neste ponto. 2,4 GHz é a melhor escolha aqui, a menos que você se aproxime do roteador.` });
        scores.banda = 60;
      } else {
        items.push({ level: "warn", title: "Seu roteador parece transmitir só em 2,4 GHz", detail: "Nenhuma rede 5 GHz do seu roteador foi detectada. 2,4 GHz é lenta e congestionada. Ative a rede 5 GHz no painel do roteador ou troque por um roteador Wi-Fi 6." });
        scores.banda = 40;
      }
    } else if (band === "5" || band === "6") {
      items.push({ level: "ok", title: `Conectado em ${band} GHz`, detail: "Banda rápida e com pouca interferência." });
      scores.banda = 100;
    }

    if (cur) {
      const std = cur.standard;
      if (["Wi-Fi 6", "Wi-Fi 6E", "Wi-Fi 7"].includes(std)) items.push({ level: "ok", title: `Roteador ${std}`, detail: "Padrão moderno." });
      else if (std === "Wi-Fi 5") items.push({ level: "info", title: "Roteador Wi-Fi 5 (802.11ac)", detail: "Bom padrão. Wi-Fi 6 traria melhor desempenho com muitos dispositivos." });
      else items.push({ level: "warn", title: `Roteador ${std} (${cur.phy})`, detail: "Padrão antigo: limita velocidade e lida mal com vários aparelhos. Considere um roteador Wi-Fi 6." });
    }

    if (cur && channels[band]) {
      const info = channels[band];
      const rowsBy = {}; info.channels.forEach(r => rowsBy[r.channel] = r);
      const curRow = rowsBy[ch], bst = rowsBy[info.best];
      let curDbm, bestDbm;
      if (band === "5") {
        const blk = info.blocks.find(b => b.channels.includes(ch));
        curDbm = blk ? blk.dbm : (curRow ? curRow.dbm : -100); bestDbm = info.best_block.dbm;
      } else { curDbm = curRow ? curRow.dbm : -100; bestDbm = bst ? bst.dbm : -100; }
      scores.canal = channelScore(curDbm);
      if (band === "2.4" && !NON_OVERLAP_24.includes(ch)) items.push({ level: "bad", title: `Canal ${ch} sobreposto`, detail: `Em 2,4 GHz só os canais 1, 6 e 11 não se sobrepõem. O canal ${ch} sofre interferência de dois grupos de vizinhos. Mude para o canal ${info.best} no painel do roteador.` });
      else if (curDbm - bestDbm > 6 && ch !== info.best) items.push({ level: "warn", title: `Canal ${ch} congestionado`, detail: `O canal ${info.best} tem bem menos interferência (${bestDbm} dBm vs ${curDbm} dBm). Altere no roteador.` });
      else items.push({ level: "ok", title: `Canal ${ch} adequado`, detail: "Não há canal significativamente melhor no momento." });
      if (band === "2.4" && cur.width === 40 && info.best_width === 20) items.push({ level: "warn", title: "Largura de 40 MHz em 2,4 GHz com vizinhos", detail: "Com muitas redes vizinhas, 40 MHz em 2,4 GHz causa colisões. Configure 20 MHz no roteador." });
    }

    const sec = (cur && cur.security) || "";
    if (/WEP|Aberta|obsoleto|TKIP/.test(sec)) { items.push({ level: "bad", title: `Segurança fraca: ${sec}`, detail: "Qualquer vizinho pode invadir ou usar sua rede. Configure WPA2-AES ou WPA3 no roteador." }); scores.seguranca = 10; }
    else if (/WPA3/.test(sec)) { items.push({ level: "ok", title: `Segurança ${sec}`, detail: "Proteção moderna." }); scores.seguranca = 100; }
    else if (sec) { items.push({ level: "info", title: `Segurança ${sec} (AES)`, detail: "Segura. Se todos os aparelhos suportarem, use WPA2/WPA3 (transição) e desative o WPS no roteador." }); scores.seguranca = 80; }

    const rate = Math.max(conn.rx_mbps || 0, conn.tx_mbps || 0);
    if (rate > 0) items.push({ level: rate >= 300 ? "ok" : rate >= 100 ? "warn" : "bad", title: `Taxa de link: ${rate.toFixed(0)} Mbps`, detail: "Velocidade negociada entre o celular e o roteador (a internet real será menor). " + (rate < 100 ? "Abaixo de 100 Mbps limita planos de fibra mais rápidos." : "") });

    const W = { sinal: 0.4, canal: 0.2, banda: 0.2, seguranca: 0.2 };
    const tw = Object.keys(scores).reduce((s, k) => s + W[k], 0);
    const score = tw ? Math.trunc(Object.keys(scores).reduce((s, k) => s + scores[k] * W[k], 0) / tw) : 0;
    return { items, score, scores, router: recommendRouter(channels, myBands, band) };
  }

  function recommendRouter(channels, myBands, curBand) {
    const c24 = channels["2.4"], c5 = channels["5"], b = c5.best_block;
    const config = [
      { group: "Rede 2,4 GHz", settings: [["Canal", `${c24.best} (fixo, não use 'Auto')`], ["Largura de banda", `${c24.best_width} MHz`], ["Modo", "802.11b/g/n/ax (ou g/n/ax)"], ["Potência de transmissão", "Alta / 100%"]] },
      { group: "Rede 5 GHz", settings: [["Canal", `${c5.best} (bloco ${b.channels[0]}-${b.channels[b.channels.length - 1]}${b.dfs ? ", DFS" : ""})`], ["Largura de banda", "80 MHz (160 MHz só se o bloco estiver livre)"], ["Modo", "802.11a/n/ac/ax"], ["Potência de transmissão", "Alta / 100%"]] },
      { group: "Segurança e recursos", settings: [["Segurança", "WPA2/WPA3-Personal (transição) com AES — nunca TKIP/WEP"], ["Senha", "12+ caracteres, misturando letras, números e símbolos"], ["WPS", "Desativado"], ["Band steering / Smart Connect", "Ativado com mesmo nome nas duas bandas"], ["Wi-Fi 6: OFDMA / MU-MIMO / TWT", "Ativados"], ["Firmware", "Sempre atualizado"], ["QoS / WMM", "Ativado"]] },
    ];
    const tips = [
      "Posicione o roteador no centro da casa, elevado (1,5 m+), com antenas na vertical.",
      "Evite: dentro de armários, atrás da TV, perto de espelhos, aquários, micro-ondas e telefones sem fio.",
      "Cada parede de tijolo/concreto custa de 6 a 15 dB. Para casas grandes ou com 2 andares, use Mesh ou AP cabeado.",
      "Aparelhos fixos (TV, videogame, PC) ficam melhores no cabo de rede.",
      "Reinicie o roteador semanalmente se ele for da operadora e travar com frequência.",
    ];
    if (!myBands.has("5")) tips.unshift("Ative a rede 5 GHz do roteador (ou troque por um dual-band Wi-Fi 6): é o maior upgrade possível.");
    return { config, tips };
  }

  // ---------------------------------------------------------------- Pré-requisitos (permissão / GPS)
  function NativeError(msg, action) { const e = new Error(msg); e.action = action; return e; }
  function checkReady() {
    const st = J(A.status()) || {};
    if (!st.permission) {
      A.requestPermission();
      throw NativeError("📍 Permita o acesso à Localização: o Android exige essa permissão para ler as redes Wi-Fi. Toque aqui para permitir.", () => A.requestPermission());
    }
    if (!st.location) throw NativeError("📍 Ative a Localização (GPS) do celular: sem ela o Android não mostra as redes Wi-Fi. Toque aqui para abrir as configurações.", () => A.openLocationSettings());
    if (!st.wifi) throw NativeError("📶 O Wi-Fi do celular está desligado. Toque aqui para ligar.", () => A.openWifiSettings());
    return st;
  }

  // ---------------------------------------------------------------- Rotas
  async function doScan() {
    const st = checkReady();
    A.startScan();
    await sleep(3500); // tempo para o Android varrer todos os canais
    const raw = J(A.scan()) || [];
    const c = J(A.connection()) || {};
    const aps = raw.filter(r => r.bssid).map(toAp);
    let conn = null, current = null;
    if (c.connected) {
      current = aps.find(a => a.bssid === c.bssid) || null;
      const ssid = c.ssid || (current && current.ssid) || "";
      if (!current && c.freq) {
        // rede conectada não apareceu na varredura (Android limita varreduras): monta a partir da conexão
        const band = bandOf(c.freq), [standard, phy] = stdName(c.std, band);
        current = { ssid, bssid: c.bssid, rssi: c.rssi, band, channel: chOf(c.freq), center: chOf(c.freq), width: 20, standard, phy, security: "WPA2-Personal" };
        aps.push(current);
      }
      if (current) current.rssi = c.rssi; // valor instantâneo é mais preciso
      conn = {
        ssid, bssid: c.bssid, rssi: c.rssi, quality: Math.max(0, Math.min(100, 2 * (c.rssi + 100))),
        rx_mbps: c.rx > 0 ? c.rx : c.link || 0, tx_mbps: c.tx > 0 ? c.tx : c.link || 0,
        phy: current ? current.phy : "", auth: current ? current.security : "", cipher: current && /TKIP/.test(current.security) ? "TKIP" : "AES", profile: ssid,
      };
    }
    const mine = conn ? aps.filter(a => (conn.ssid && a.ssid === conn.ssid) || sameDevice(a.bssid, conn.bssid)) : [];
    const mineSet = new Set(mine.map(a => a.bssid));
    aps.forEach(a => { a.mine = mineSet.has(a.bssid); a.connected = !!conn && a.bssid === conn.bssid; });
    const channels = analyzeChannels(aps, mineSet);
    const diagnosis = diagnose(conn, current, channels, mine);
    return {
      adapter: `${st.model || "Android"} (Wi-Fi${st.support5 ? " · 5 GHz" : ""}${st.support6 ? " · 6 GHz" : ""})`,
      connection: conn, current, aps: aps.sort((a, b) => b.rssi - a.rssi), channels, diagnosis,
      net: { ip: c.ip, gateway: c.gateway, dns: c.dns || [] }, time: Date.now() / 1000,
    };
  }

  function doSignal() {
    let c = {};
    try {
      c = J(A.connection()) || {};
    } catch (e) {
      c = {};
    }
    if (!c.connected) {
      return { connected: false, message: "Wi-Fi não conectado no aparelho." };
    }
    const rssi = (typeof c.rssi === "number" && c.rssi > -127 && c.rssi <= 0) ? c.rssi : -65;
    return {
      connected: true,
      rssi: rssi,
      quality: Math.max(0, Math.min(100, 2 * (rssi + 100))),
      ssid: c.ssid || "Wi-Fi",
      bssid: c.bssid || "",
      rx: c.rx > 0 ? c.rx : c.link || 0,
      tx: c.tx > 0 ? c.tx : c.link || 0,
      channel: c.freq ? chOf(c.freq) : null,
      t: Date.now() / 1000
    };
  }

  const ping = (host, n) => J(A.ping(host, n)) || { host, loss: 100 };

  async function doPing() {
    const c = J(A.connection()) || {};
    const out = {};
    if (c.gateway && c.gateway !== "0.0.0.0") out["Roteador (gateway)"] = ping(c.gateway, 10);
    await sleep(10);
    out["Google DNS"] = ping("8.8.8.8", 10);
    await sleep(10);
    out["Cloudflare"] = ping("1.1.1.1", 10);
    return out;
  }

  async function doDns() {
    const c = J(A.connection()) || {};
    const list = [["Google", "8.8.8.8", "dns.google"], ["Cloudflare", "1.1.1.1", "one.one.one.one"], ["Quad9", "9.9.9.9", "dns.quad9.net"], ["AdGuard (bloqueia anúncios)", "94.140.14.14", "dns.adguard-dns.com"]];
    (c.dns || []).forEach(ip => { if (!list.some(l => l[1] === ip)) list.unshift(["DNS atual da rede", ip, null]); });
    const res = [];
    for (const [name, ip, host] of list) {
      const p = ping(ip, 5);
      res.push({ name, ip, median: p.avg ?? null, fails: p.avg == null ? 1 : 0, current: (c.dns || []).includes(ip), servers: host ? [host] : null });
      await sleep(10);
    }
    return res.sort((a, b) => (a.median ?? 9999) - (b.median ?? 9999));
  }

  async function doSpeed() {
    const lat = ping("1.1.1.1", 4);
    // Download: lê o fluxo por até ~8 s
    let bytes = 0; const t0 = performance.now();
    const ctl = new AbortController(); const stopAt = t0 + 8000;
    try {
      const r = await fetch("https://speed.cloudflare.com/__down?bytes=100000000", { signal: ctl.signal, cache: "no-store" });
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (performance.now() > stopAt) { ctl.abort(); break; }
      }
    } catch (e) { if (!bytes) throw new Error("Sem acesso à internet para o teste de velocidade."); }
    const dl = bytes * 8 / ((performance.now() - t0) / 1000) / 1e6;
    // Upload: envia blocos de 2 MB por até ~6 s
    const chunk = new Uint8Array(2 * 1024 * 1024); let up = 0; const u0 = performance.now();
    try {
      while (performance.now() - u0 < 6000) {
        await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: chunk, cache: "no-store" });
        up += chunk.length;
      }
    } catch (e) { /* mantém o que mediu */ }
    const ul = up ? up * 8 / ((performance.now() - u0) / 1000) / 1e6 : 0;
    return { download: +dl.toFixed(1), upload: +ul.toFixed(1), latency: lat.avg ?? null };
  }

  function doAdapter() {
    const st = J(A.status()) || {}, c = J(A.connection()) || {};
    return { net: { driver: st.model, name: "wlan0", speed: c.link ? `${c.link} Mbps` : "–", mac: "(protegido pelo Android)" }, props: [] };
  }

  // ---------------- Certificação (port de certify.py)
  const SLA = {
    residencial_padrao: { name: "Residencial Padrão", min_rssi: -67, max_latency: 45, max_loss: 1.0, min_speed_pct: 40, allowed_bands: ["2.4", "5", "6"] },
    residencial_premium: { name: "Residencial High-End / Home Office", min_rssi: -60, max_latency: 20, max_loss: 0, min_speed_pct: 60, allowed_bands: ["5", "6"] },
    corporativo: { name: "Corporativo / Comercial", min_rssi: -65, max_latency: 15, max_loss: 0, min_speed_pct: 70, allowed_bands: ["5", "6"] },
  };
  function evaluatePoint(p, sla) {
    const issues = [];
    if (p.rssi == null || p.rssi < sla.min_rssi) issues.push(`Sinal fraco: ${p.rssi} dBm (mínimo exigido: ${sla.min_rssi} dBm)`);
    if (p.latency_gw != null && p.latency_gw > sla.max_latency) issues.push(`Latência alta até o roteador: ${(+p.latency_gw).toFixed(1)} ms (máximo: ${sla.max_latency} ms)`);
    if ((p.loss_gw || 0) > sla.max_loss) issues.push(`Perda de pacotes: ${(+p.loss_gw).toFixed(1)}% (máximo tolerado: ${sla.max_loss}%)`);
    if (p.band && !sla.allowed_bands.includes(p.band)) issues.push(`Banda ${p.band} GHz não recomendada para este perfil de certificação`);
    return { passed: issues.length === 0, issues, score: Math.max(0, 100 - issues.length * 25) };
  }
  function doCertify(body) {
    const sla = SLA[body.sla_profile] || SLA.residencial_padrao;
    const now = new Date(), pad = n => String(n).padStart(2, "0");
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const points = (body.points || []).map(p => ({ ...p, eval: evaluatePoint(p, sla) }));
    const avg = points.length ? Math.trunc(points.reduce((s, p) => s + p.eval.score, 0) / points.length) : 0;
    const ok = points.length > 0 && points.every(p => p.eval.passed);
    const ci = body.client_info || {};
    return {
      cert_id: `CERT-WIFI-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${hex}`,
      date: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      client: { name: ci.name || "Cliente não identificado", address: ci.address || "Endereço não informado", technician: ci.technician || "Técnico Responsável", ssid: ci.ssid || "Rede Wi-Fi", contracted_speed: ci.contracted_speed || "Não informado" },
      sla, status: ok ? "APROVADO" : "REPROVADO", overall_score: avg, total_points: points.length, passed_points: points.filter(p => p.eval.passed).length, points,
    };
  }

  function doAction(body) {
    const a = body.action;
    if (a === "set_dns") {
      const host = (body.params && body.params.servers && body.params.servers[0]) || "dns.google";
      try { A.openWifiSettings(); } catch (e) { }
      return { ok: false, output: `No Android o DNS é configurado pelo sistema:\nConfigurações → Rede e Internet → DNS privado → "Nome do host do provedor" → digite:\n\n   ${host}\n\nIsso vale para todas as redes e é criptografado (DNS-over-TLS).` };
    }
    return { ok: false, output: "Esta otimização altera o adaptador Wi-Fi do Windows e só funciona na versão para PC (python server.py).\nNo celular, use as recomendações da Visão geral para configurar o roteador (canal, largura, banda 5 GHz e segurança)." };
  }

  // ---------------------------------------------------------------- Roteador
  async function handle(path, opts = {}) {
    const body = opts.body ? (J(opts.body) || {}) : {};
    switch (path) {
      case "/api/scan": return doScan();
      case "/api/signal": return doSignal();
      case "/api/ping": return doPing();
      case "/api/dns": return doDns();
      case "/api/speed": return doSpeed();
      case "/api/adapter": return doAdapter();
      case "/api/certify": return doCertify(body);
      case "/api/action": return doAction(body);
      default: throw new Error("Rota inexistente: " + path);
    }
  }

  window.NativeAPI = { active: () => !!A, handle, ping };
})();
