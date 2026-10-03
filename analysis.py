"""Análise de espectro, escolha de canal e diagnóstico da conexão."""
import math

CH_24 = list(range(1, 14))                     # Brasil/Europa: 1-13
NON_OVERLAP_24 = [1, 6, 11]
CH_5_20 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128,
           132, 136, 140, 144, 149, 153, 157, 161, 165]
DFS_5 = set(range(52, 145))
# Blocos de 80 MHz: canal central -> canais de 20 MHz
BLOCKS_5_80 = {42: [36, 40, 44, 48], 58: [52, 56, 60, 64], 106: [100, 104, 108, 112],
               122: [116, 120, 124, 128], 138: [132, 136, 140, 144], 155: [149, 153, 157, 161]}
CH_6_20 = list(range(1, 234, 4))


def ch_freq(band, ch):
    if band == "2.4":
        return 2484 if ch == 14 else 2407 + 5 * ch
    if band == "5":
        return 5000 + 5 * ch
    return 5950 + 5 * ch


def ap_span(ap):
    """Faixa de frequência ocupada (MHz) pelo AP."""
    fc = ch_freq(ap["band"], ap["center"])
    w = ap["width"]
    if ap["band"] == "2.4" and w == 20:
        w = 22  # máscara espectral real dos canais de 2,4 GHz
    return fc - w / 2, fc + w / 2


def _overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def same_device(mac_a, mac_b):
    """Heurística: BSSIDs do mesmo roteador (rede principal, convidados, 5 GHz...)."""
    a = [int(x, 16) for x in mac_a.split(":")]
    b = [int(x, 16) for x in mac_b.split(":")]
    if (a[0] & 0xFD) != (b[0] & 0xFD) or a[1:3] != b[1:3]:
        return False
    if a[4:6] == b[4:6]:
        return True
    return a[3:5] == b[3:5] and abs(a[5] - b[5]) <= 16


def interference(band, lo, hi, aps):
    """Interferência (dBm equivalente) e nº de APs que caem na faixa [lo, hi]."""
    total_mw, count = 0.0, 0
    for ap in aps:
        if ap["band"] != band:
            continue
        a0, a1 = ap_span(ap)
        ov = _overlap(lo, hi, a0, a1)
        if ov <= 0:
            continue
        frac = ov / (a1 - a0)
        total_mw += (10 ** (ap["rssi"] / 10)) * frac
        count += 1
    dbm = 10 * math.log10(total_mw) if total_mw > 0 else -100.0
    return round(dbm, 1), count


def channel_score(dbm):
    """0 (péssimo) a 100 (livre)."""
    return int(max(0, min(100, (-40 - dbm) / 55 * 100)))


def analyze_channels(aps, mine):
    others = [a for a in aps if a["bssid"] not in mine]
    res = {}

    # ---------------- 2,4 GHz ----------------
    rows = []
    for ch in CH_24:
        f = ch_freq("2.4", ch)
        dbm, n = interference("2.4", f - 11, f + 11, others)
        rows.append({"channel": ch, "dbm": dbm, "aps": n, "score": channel_score(dbm),
                     "recommended_set": ch in NON_OVERLAP_24})
    best = min((r for r in rows if r["recommended_set"]), key=lambda r: (r["dbm"], r["aps"]))
    strong_neighbors = [a for a in others if a["band"] == "2.4" and a["rssi"] > -82]
    res["2.4"] = {
        "channels": rows,
        "best": best["channel"],
        "best_width": 20 if len(strong_neighbors) >= 2 else 40,
        "neighbors": len([a for a in others if a["band"] == "2.4"]),
    }

    # ---------------- 5 GHz ----------------
    rows5 = []
    for ch in CH_5_20:
        f = ch_freq("5", ch)
        dbm, n = interference("5", f - 10, f + 10, others)
        rows5.append({"channel": ch, "dbm": dbm, "aps": n, "score": channel_score(dbm),
                      "dfs": ch in DFS_5})
    blocks = []
    for center, chans in BLOCKS_5_80.items():
        f = ch_freq("5", center)
        dbm, n = interference("5", f - 40, f + 40, others)
        # canal primário: o de menor interferência dentro do bloco
        prim = min((r for r in rows5 if r["channel"] in chans), key=lambda r: r["dbm"])
        blocks.append({"center": center, "channels": chans, "dbm": dbm, "aps": n,
                       "dfs": center in DFS_5, "primary": prim["channel"],
                       "score": channel_score(dbm)})
    nondfs = [b for b in blocks if not b["dfs"]]
    best_nd = min(nondfs, key=lambda b: (b["dbm"], b["aps"]))
    best_any = min(blocks, key=lambda b: (b["dbm"], b["aps"]))
    # Prefere não-DFS (sem quedas por radar) a menos que o DFS seja bem melhor
    best5 = best_any if best_any["dbm"] < best_nd["dbm"] - 6 else best_nd
    res["5"] = {"channels": rows5, "blocks": blocks, "best": best5["primary"],
                "best_block": best5, "best_width": 80,
                "neighbors": len([a for a in others if a["band"] == "5"])}

    # ---------------- 6 GHz ----------------
    rows6 = []
    for ch in CH_6_20:
        f = ch_freq("6", ch)
        dbm, n = interference("6", f - 10, f + 10, others)
        rows6.append({"channel": ch, "dbm": dbm, "aps": n, "score": channel_score(dbm)})
    res["6"] = {"channels": rows6, "best": min(rows6, key=lambda r: r["dbm"])["channel"],
                "best_width": 160,
                "neighbors": len([a for a in others if a["band"] == "6"])}
    return res


def signal_level(rssi):
    if rssi is None:
        return "desconhecido", 0
    for limit, label in ((-50, "Excelente"), (-60, "Muito bom"), (-67, "Bom"),
                         (-70, "Razoável"), (-80, "Fraco")):
        if rssi >= limit:
            break
    else:
        label = "Péssimo"
    score = int(max(0, min(100, (rssi + 90) / 40 * 100)))
    return label, score


def diagnose(aps, conn, current_bss, channels, mine_bss):
    """Gera lista de achados + nota geral + configuração recomendada para o roteador."""
    items = []
    scores = {}

    if not conn:
        items.append({"level": "bad", "title": "Sem conexão Wi-Fi",
                      "detail": "O adaptador não está conectado a nenhuma rede."})
        return {"items": items, "score": 0, "scores": {}, "router": None}

    rssi = current_bss["rssi"] if current_bss else None
    label, s_sig = signal_level(rssi)
    scores["sinal"] = s_sig
    band = current_bss["band"] if current_bss else "?"
    ch = current_bss["channel"] if current_bss else None

    # ---- Sinal
    if rssi is not None:
        if rssi >= -60:
            items.append({"level": "ok", "title": f"Sinal {label} ({rssi} dBm)",
                          "detail": "Intensidade ótima para streaming 4K, chamadas e jogos."})
        elif rssi >= -70:
            items.append({"level": "warn", "title": f"Sinal {label} ({rssi} dBm)",
                          "detail": "Funciona, mas perde velocidade. Use a aba 'Buscar sinal' para achar "
                                    "uma posição melhor, ou aproxime o roteador. Ideal: acima de -60 dBm."})
        else:
            items.append({"level": "bad", "title": f"Sinal {label} ({rssi} dBm)",
                          "detail": "Sinal fraco causa lentidão, quedas e alta latência. Soluções em ordem: "
                                    "1) reposicionar o roteador (centro da casa, alto, longe de paredes/espelhos/"
                                    "micro-ondas); 2) usar a aba 'Buscar sinal' para achar o melhor ponto; "
                                    "3) instalar um sistema Mesh ou ponto de acesso cabeado.",
                          "action": "goto_signal"})

    # ---- Banda
    my_bands = {a["band"] for a in mine_bss}
    my5 = [a for a in mine_bss if a["band"] in ("5", "6")]
    if band == "2.4":
        if my5:
            best5 = max(my5, key=lambda a: a["rssi"])
            if best5["rssi"] >= -72:
                items.append({"level": "warn", "title": "Conectado em 2,4 GHz, mas há 5 GHz disponível",
                              "detail": f"Seu roteador também transmite em {best5['band']} GHz "
                                        f"('{best5['ssid'] or 'oculta'}', {best5['rssi']} dBm). 5 GHz é até 5x "
                                        "mais rápido e sofre muito menos interferência. Conecte-se a ela ou defina "
                                        "a 'Banda preferencial' do adaptador para 5 GHz (aba Otimizar)."})
            else:
                items.append({"level": "info", "title": "5 GHz existe, mas está fraco aqui",
                              "detail": f"A rede 5 GHz chega com {best5['rssi']} dBm neste ponto. 2,4 GHz é a "
                                        "melhor escolha aqui, a menos que você se aproxime do roteador."})
            scores["banda"] = 60
        else:
            items.append({"level": "warn", "title": "Seu roteador parece transmitir só em 2,4 GHz",
                          "detail": "Nenhuma rede 5 GHz do seu roteador foi detectada. 2,4 GHz é lenta e congestionada. "
                                    "Se o roteador for dual-band, ative a rede 5 GHz no painel dele; se não for, "
                                    "trocar por um roteador Wi-Fi 6 (ou pedir à operadora) é o maior ganho possível. "
                                    "Seu adaptador suporta 5 GHz."})
            scores["banda"] = 40
    elif band in ("5", "6"):
        items.append({"level": "ok", "title": f"Conectado em {band} GHz",
                      "detail": "Banda rápida e com pouca interferência."})
        scores["banda"] = 100

    # ---- Padrão
    if current_bss:
        std = current_bss["standard"]
        if std in ("Wi-Fi 6", "Wi-Fi 6E", "Wi-Fi 7"):
            items.append({"level": "ok", "title": f"Roteador {std}", "detail": "Padrão moderno."})
        elif std == "Wi-Fi 5":
            items.append({"level": "info", "title": "Roteador Wi-Fi 5 (802.11ac)",
                          "detail": "Bom padrão. Wi-Fi 6 traria melhor desempenho com muitos dispositivos."})
        else:
            items.append({"level": "warn", "title": f"Roteador {std} ({current_bss['phy']})",
                          "detail": "Padrão antigo: limita velocidade e lida mal com vários aparelhos. "
                                    "Considere um roteador Wi-Fi 6."})

    # ---- Canal
    if current_bss and band in channels:
        info = channels[band]
        rows = {r["channel"]: r for r in info["channels"]}
        cur = rows.get(ch)
        bst = rows.get(info["best"])
        if band == "5":
            cur_block = next((b for b in info["blocks"] if ch in b["channels"]), None)
            cur_dbm = cur_block["dbm"] if cur_block else (cur["dbm"] if cur else -100)
            best_dbm = info["best_block"]["dbm"]
        else:
            cur_dbm = cur["dbm"] if cur else -100
            best_dbm = bst["dbm"] if bst else -100
        scores["canal"] = channel_score(cur_dbm)
        if band == "2.4" and ch not in NON_OVERLAP_24:
            items.append({"level": "bad", "title": f"Canal {ch} sobreposto",
                          "detail": f"Em 2,4 GHz só os canais 1, 6 e 11 não se sobrepõem. O canal {ch} "
                                    f"sofre interferência de dois grupos de vizinhos. Mude para o canal "
                                    f"{info['best']} no painel do roteador."})
        elif cur_dbm - best_dbm > 6 and ch != info["best"]:
            items.append({"level": "warn", "title": f"Canal {ch} congestionado",
                          "detail": f"O canal {info['best']} tem bem menos interferência "
                                    f"({best_dbm} dBm vs {cur_dbm} dBm). Altere no roteador."})
        else:
            items.append({"level": "ok", "title": f"Canal {ch} adequado",
                          "detail": "Não há canal significativamente melhor no momento."})
        if band == "2.4" and current_bss["width"] == 40 and info["best_width"] == 20:
            items.append({"level": "warn", "title": "Largura de 40 MHz em 2,4 GHz com vizinhos",
                          "detail": "Com muitas redes vizinhas, 40 MHz em 2,4 GHz ocupa 2/3 da banda e "
                                    "causa colisões. Configure 20 MHz no roteador: costuma ficar mais estável "
                                    "e, na prática, mais rápido."})

    # ---- Segurança
    sec = (current_bss or {}).get("security") or conn.get("auth", "")
    if "WEP" in sec or "Aberta" in sec or "obsoleto" in sec or "TKIP" in sec:
        items.append({"level": "bad", "title": f"Segurança fraca: {sec}",
                      "detail": "Qualquer vizinho pode invadir ou usar sua rede (roubando banda). "
                                "Configure WPA2-AES ou WPA3 no roteador."})
        scores["seguranca"] = 10
    elif "WPA3" in sec:
        items.append({"level": "ok", "title": f"Segurança {sec}", "detail": "Proteção moderna."})
        scores["seguranca"] = 100
    else:
        items.append({"level": "info", "title": f"Segurança {sec} (AES)",
                      "detail": "Segura. Se todos os aparelhos suportarem, use WPA2/WPA3 (transição) "
                                "e desative o WPS no roteador."})
        scores["seguranca"] = 80

    # ---- Taxa de link
    rate = max(conn.get("rx_mbps", 0), conn.get("tx_mbps", 0))
    if rate:
        lvl = "ok" if rate >= 300 else "warn" if rate >= 100 else "bad"
        items.append({"level": lvl, "title": f"Taxa de link: {rate:.0f} Mbps",
                      "detail": "Velocidade negociada entre o PC e o roteador (a internet real será menor). "
                                + ("Abaixo de 100 Mbps limita planos de fibra mais rápidos." if rate < 100 else "")})

    weights = {"sinal": 0.4, "canal": 0.2, "banda": 0.2, "seguranca": 0.2}
    total_w = sum(weights[k] for k in scores)
    score = int(sum(scores[k] * weights[k] for k in scores) / total_w) if total_w else 0

    router = recommend_router(channels, my_bands, band)
    return {"items": items, "score": score, "scores": scores, "router": router}


def recommend_router(channels, my_bands, cur_band):
    c24, c5 = channels["2.4"], channels["5"]
    b = c5["best_block"]
    cfg = [
        {"group": "Rede 2,4 GHz", "settings": [
            ("Canal", f"{c24['best']} (fixo, não use 'Auto')"),
            ("Largura de banda", f"{c24['best_width']} MHz"),
            ("Modo", "802.11b/g/n/ax (ou g/n/ax)"),
            ("Potência de transmissão", "Alta / 100%"),
        ]},
        {"group": "Rede 5 GHz", "settings": [
            ("Canal", f"{c5['best']} (bloco {b['channels'][0]}-{b['channels'][-1]}"
                      f"{', DFS' if b['dfs'] else ''})"),
            ("Largura de banda", "80 MHz (160 MHz só se o bloco estiver livre)"),
            ("Modo", "802.11a/n/ac/ax"),
            ("Potência de transmissão", "Alta / 100%"),
        ]},
        {"group": "Segurança e recursos", "settings": [
            ("Segurança", "WPA2/WPA3-Personal (transição) com AES — nunca TKIP/WEP"),
            ("Senha", "12+ caracteres, misturando letras, números e símbolos"),
            ("WPS", "Desativado"),
            ("Band steering / Smart Connect", "Ativado com mesmo nome nas duas bandas "
                                             "(ou nomes separados, se aparelhos antigos tiverem problema)"),
            ("Wi-Fi 6: OFDMA / MU-MIMO / TWT", "Ativados"),
            ("Firmware", "Sempre atualizado"),
            ("QoS / WMM", "Ativado"),
        ]},
    ]
    tips = [
        "Posicione o roteador no centro da casa, elevado (1,5 m+), com antenas na vertical.",
        "Evite: dentro de armários, atrás da TV, perto de espelhos, aquários, micro-ondas e telefones sem fio.",
        "Cada parede de tijolo/concreto custa de 6 a 15 dB. Para casas grandes ou com 2 andares, use Mesh ou AP cabeado.",
        "Aparelhos fixos (TV, videogame, PC) ficam melhores no cabo de rede.",
        "Reinicie o roteador semanalmente se ele for da operadora e travar com frequência.",
    ]
    if "5" not in my_bands:
        tips.insert(0, "Ative a rede 5 GHz do roteador (ou troque por um dual-band Wi-Fi 6): é o maior upgrade possível.")
    return {"config": cfg, "tips": tips}
