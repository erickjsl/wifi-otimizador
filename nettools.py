"""Testes de rede (ping, DNS, velocidade) e ações de sistema."""
import base64
import ipaddress
import json
import os
import random
import re
import socket
import statistics
import struct
import subprocess
import tempfile
import threading
import time
import urllib.request

NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


def run(cmd, timeout=60):
    r = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    out = r.stdout.decode("utf-8", errors="ignore") if r.stdout.startswith(b"\xef\xbb\xbf") else \
        r.stdout.decode("cp850", errors="ignore")
    return r.returncode, out.strip()


def ps(script, timeout=60):
    """Executa PowerShell com saída UTF-8."""
    full = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';" + script
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                        "-Command", full], capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
    return r.returncode, r.stdout.decode("utf-8", errors="ignore").strip(), \
        r.stderr.decode("utf-8", errors="ignore").strip()


def ps_quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def ps_elevated(script, timeout=180):
    """Executa um script PowerShell como administrador (abre o prompt do UAC)."""
    fd, out_path = tempfile.mkstemp(suffix=".txt", prefix="wifiopt_")
    os.close(fd)
    inner = (f"$ErrorActionPreference='Continue'; & {{ {script} }} *>&1 | "
             f"Out-File -FilePath {ps_quote(out_path)} -Encoding utf8")
    enc = base64.b64encode(inner.encode("utf-16-le")).decode()
    outer = ("try { Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop "
             f"-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{enc}'; 'OK' }} "
             "catch { 'CANCELADO' }")
    _, out, _ = ps(outer, timeout=timeout)
    try:
        with open(out_path, "r", encoding="utf-8-sig", errors="ignore") as f:
            result = f.read().strip()
    except OSError:
        result = ""
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass
    if "CANCELADO" in out:
        return False, "Permissão de administrador negada (UAC cancelado)."
    return True, result or "Concluído."


# --------------------------------------------------------------------------- #
# Informações da rede
# --------------------------------------------------------------------------- #
def net_info():
    script = r"""
$w = Get-NetAdapter | Where-Object { $_.NdisPhysicalMedium -eq 9 } | Sort-Object Status | Select-Object -First 1
$cfg = $null
if ($w) { $cfg = Get-NetIPConfiguration -InterfaceIndex $w.ifIndex -ErrorAction SilentlyContinue }
$dns = @()
if ($w) { $dns = @((Get-DnsClientServerAddress -InterfaceIndex $w.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses) }
[pscustomobject]@{
  name = $w.Name; index = $w.ifIndex; status = "$($w.Status)"; mac = $w.MacAddress;
  driver = $w.InterfaceDescription; speed = $w.LinkSpeed;
  ip = @($cfg.IPv4Address.IPAddress)[0]; gateway = @($cfg.IPv4DefaultGateway.NextHop)[0];
  dns = $dns
} | ConvertTo-Json -Compress
"""
    _, out, _ = ps(script)
    try:
        d = json.loads(out)
        if isinstance(d.get("dns"), str):
            d["dns"] = [d["dns"]]
        d["dns"] = d.get("dns") or []
        return d
    except (json.JSONDecodeError, AttributeError):
        return {"name": "Wi-Fi", "index": None, "gateway": None, "dns": []}


# --------------------------------------------------------------------------- #
# Ping
# --------------------------------------------------------------------------- #
def ping(host, count=20):
    if not host:
        return None
    _, out = run(["ping", "-n", str(count), "-w", "1000", host], timeout=count * 2 + 10)
    times = []
    for line in out.splitlines():
        if "TTL=" in line.upper():
            m = re.search(r"[=<]\s*(\d+)\s*ms", line)
            times.append(float(m.group(1)) if m else 0.5)
    sent = count
    loss = round(100 * (sent - len(times)) / sent, 1)
    if not times:
        return {"host": host, "loss": 100.0, "avg": None, "min": None, "max": None, "jitter": None}
    jitter = statistics.mean(abs(a - b) for a, b in zip(times, times[1:])) if len(times) > 1 else 0
    return {"host": host, "loss": loss, "avg": round(statistics.mean(times), 1),
            "min": min(times), "max": max(times), "jitter": round(jitter, 1), "samples": times}


def ping_suite(gateway):
    targets = {"Roteador (gateway)": gateway, "Google DNS": "8.8.8.8", "Cloudflare": "1.1.1.1"}
    results = {}

    def worker(name, host):
        results[name] = ping(host)

    th = [threading.Thread(target=worker, args=kv) for kv in targets.items() if kv[1]]
    [t.start() for t in th]
    [t.join() for t in th]
    return results


# --------------------------------------------------------------------------- #
# DNS
# --------------------------------------------------------------------------- #
DNS_PROVIDERS = {
    "Cloudflare": ["1.1.1.1", "1.0.0.1"],
    "Google": ["8.8.8.8", "8.8.4.4"],
    "Quad9": ["9.9.9.9", "149.112.112.112"],
    "OpenDNS": ["208.67.222.222", "208.67.220.220"],
    "AdGuard (bloqueia anúncios)": ["94.140.14.14", "94.140.15.15"],
}
TEST_DOMAINS = ["google.com", "youtube.com", "netflix.com", "whatsapp.net", "instagram.com",
                "globo.com", "uol.com.br", "mercadolivre.com.br", "amazon.com.br", "tiktok.com"]


def dns_query(server, domain, timeout=2.0):
    tid = random.randint(0, 0xFFFF)
    pkt = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    pkt += b"".join(bytes([len(p)]) + p.encode() for p in domain.split(".")) + b"\x00"
    pkt += struct.pack(">HH", 1, 1)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        t0 = time.perf_counter()
        s.sendto(pkt, (server, 53))
        while True:
            data, _ = s.recvfrom(1024)
            if data[:2] == pkt[:2]:
                return (time.perf_counter() - t0) * 1000


def dns_bench(system_dns):
    servers = {}
    for ip in system_dns:
        servers[ip] = f"Atual ({ip})"
    for name, ips in DNS_PROVIDERS.items():
        servers.setdefault(ips[0], name)
    results = []

    def worker(ip, name):
        times, fails = [], 0
        for d in TEST_DOMAINS:
            try:
                times.append(dns_query(ip, d))
            except OSError:
                fails += 1
        prov = next((ips for n, ips in DNS_PROVIDERS.items() if ips[0] == ip), [ip])
        results.append({"name": name, "ip": ip, "servers": prov,
                        "median": round(statistics.median(times), 1) if times else None,
                        "fails": fails, "current": name.startswith("Atual")})

    th = [threading.Thread(target=worker, args=kv) for kv in servers.items()]
    [t.start() for t in th]
    [t.join() for t in th]
    results.sort(key=lambda r: (r["median"] is None, r["fails"], r["median"] or 9e9))
    return results


# --------------------------------------------------------------------------- #
# Velocidade (Cloudflare)
# --------------------------------------------------------------------------- #
UA = {"User-Agent": "Mozilla/5.0 WiFiOtimizador/1.0"}


def _download(duration=8.0, threads=4):
    total = [0]
    lock = threading.Lock()
    stop = time.perf_counter() + duration

    def worker():
        while time.perf_counter() < stop:
            try:
                req = urllib.request.Request("https://speed.cloudflare.com/__down?bytes=50000000", headers=UA)
                with urllib.request.urlopen(req, timeout=10) as r:
                    while time.perf_counter() < stop:
                        chunk = r.read(65536)
                        if not chunk:
                            break
                        with lock:
                            total[0] += len(chunk)
            except Exception:
                time.sleep(0.2)

    t0 = time.perf_counter()
    th = [threading.Thread(target=worker, daemon=True) for _ in range(threads)]
    [t.start() for t in th]
    [t.join(duration + 12) for t in th]
    return total[0] * 8 / (time.perf_counter() - t0) / 1e6


def _upload(duration=6.0, threads=3):
    total = [0]
    lock = threading.Lock()
    stop = time.perf_counter() + duration
    payload = os.urandom(2_000_000)

    def worker():
        while time.perf_counter() < stop:
            try:
                req = urllib.request.Request("https://speed.cloudflare.com/__up", data=payload,
                                             headers={**UA, "Content-Type": "application/octet-stream"})
                with urllib.request.urlopen(req, timeout=15) as r:
                    r.read()
                with lock:
                    total[0] += len(payload)
            except Exception:
                time.sleep(0.2)

    t0 = time.perf_counter()
    th = [threading.Thread(target=worker, daemon=True) for _ in range(threads)]
    [t.start() for t in th]
    [t.join(duration + 20) for t in th]
    return total[0] * 8 / (time.perf_counter() - t0) / 1e6


def speed_test():
    lat = []
    for _ in range(5):
        try:
            t0 = time.perf_counter()
            req = urllib.request.Request("https://speed.cloudflare.com/__down?bytes=0", headers=UA)
            urllib.request.urlopen(req, timeout=5).read()
            lat.append((time.perf_counter() - t0) * 1000)
        except Exception:
            pass
    return {"download": round(_download(), 1), "upload": round(_upload(), 1),
            "latency": round(min(lat), 1) if lat else None, "server": "Cloudflare"}


# --------------------------------------------------------------------------- #
# Adaptador
# --------------------------------------------------------------------------- #
RECOMMEND_RULES = [
    # (palavras-chave no nome/keyword, preferências de valor em ordem, explicação)
    (("preferred band", "banda preferencial", "bandpref", "band preference", "preferência de banda"),
     ("5g", "5 g", "5.2", "5,2", "5ghz"), "Prefira 5 GHz: mais rápido e menos congestionado."),
    (("roam",), ("medium", "médio", "media", "3"),
     "Com um só roteador, agressividade média evita trocas desnecessárias; com Mesh, use média-alta."),
    (("mimo power", "smps", "power sav", "economia de energia", "powersav", "energy"),
     ("no smps", "disable", "desativ", "maximum perf", "desempenho máximo", "off", "0"),
     "Desativar economia de energia reduz latência e quedas."),
    (("wake on", "wol", "despertar"), None, "Indiferente para desempenho."),
    (("802.11n", "ht mode", "vht", "wireless mode", "modo wireless", "modo sem fio", "ieee"),
     ("ax", "ac", "auto", "802.11a/b/g/n/ac", "11ac"), "Use o modo mais moderno suportado (Automático)."),
    (("channel width", "largura", "bandwidth", "40mhz", "bw"),
     ("auto", "80", "20/40"), "Deixe Auto para negociar a maior largura possível."),
]


def adapter_properties(name):
    script = (f"Get-NetAdapterAdvancedProperty -Name {ps_quote(name)} -ErrorAction SilentlyContinue | "
              "Select-Object DisplayName, DisplayValue, RegistryKeyword, ValidDisplayValues | "
              "ConvertTo-Json -Compress -Depth 3")
    _, out, _ = ps(script)
    try:
        props = json.loads(out) if out else []
    except json.JSONDecodeError:
        props = []
    if isinstance(props, dict):
        props = [props]
    for p in props:
        vals = p.get("ValidDisplayValues") or []
        if isinstance(vals, str):
            vals = [vals]
        p["ValidDisplayValues"] = vals
        key = f"{p.get('DisplayName', '')} {p.get('RegistryKeyword', '')}".lower()
        p["suggest"], p["why"] = None, None
        for words, prefs, why in RECOMMEND_RULES:
            if any(w in key for w in words):
                p["why"] = why
                if prefs:
                    for pref in prefs:
                        hit = next((v for v in vals if pref in v.lower()), None)
                        if hit:
                            p["suggest"] = hit
                            break
                break
    # potência do plano de energia para o adaptador sem fio
    return props


POWER_SUB = "19cbb8fa-5279-450e-9fac-8a3d5fedd0c1"
POWER_SET = "12bbebe6-58d6-4636-95bb-3217ef867c1a"


# --------------------------------------------------------------------------- #
# Ações
# --------------------------------------------------------------------------- #
def action(name, params, ctx):
    iface = ctx.get("iface") or "Wi-Fi"
    idx = ctx.get("index")

    if name == "flushdns":
        _, out = run(["ipconfig", "/flushdns"])
        return True, out

    if name == "reconnect":
        profile = ctx.get("profile")
        if not profile:
            return False, "Nenhum perfil conectado."
        run(["netsh", "wlan", "disconnect", f"interface={iface}"])
        time.sleep(2)
        code, out = run(["netsh", "wlan", "connect", f"name={profile}", f"interface={iface}"])
        time.sleep(4)
        return code == 0, out

    if name == "renew":
        return ps_elevated("ipconfig /release; ipconfig /renew; ipconfig /flushdns")

    if name == "reset_stack":
        ok, out = ps_elevated("netsh winsock reset; netsh int ip reset; ipconfig /flushdns")
        return ok, out + "\n\n⚠ Reinicie o computador para concluir."

    if name == "set_dns":
        servers = params.get("servers") or []
        try:
            servers = [str(ipaddress.IPv4Address(s)) for s in servers][:2]
        except ValueError:
            return False, "Endereço de DNS inválido."
        if not servers or idx is None:
            return False, "Parâmetros inválidos."
        lst = ",".join(ps_quote(s) for s in servers)
        return ps_elevated(f"Set-DnsClientServerAddress -InterfaceIndex {int(idx)} -ServerAddresses {lst}; "
                           "Clear-DnsClientCache; Get-DnsClientServerAddress -InterfaceIndex "
                           f"{int(idx)} -AddressFamily IPv4 | Format-List")

    if name == "dns_auto":
        if idx is None:
            return False, "Adaptador não encontrado."
        return ps_elevated(f"Set-DnsClientServerAddress -InterfaceIndex {int(idx)} -ResetServerAddresses; "
                           "Clear-DnsClientCache; 'DNS voltou para automático (DHCP).'")

    if name == "set_prop":
        kw, val = params.get("keyword"), params.get("value")
        if not kw or val is None:
            return False, "Parâmetros inválidos."
        return ps_elevated(f"Set-NetAdapterAdvancedProperty -Name {ps_quote(iface)} "
                           f"-RegistryKeyword {ps_quote(kw)} -DisplayValue {ps_quote(val)}; "
                           f"'Propriedade alterada. O adaptador reinicia por alguns segundos.'")

    if name == "power_max":
        cmds = (f"powercfg /setacvalueindex SCHEME_CURRENT {POWER_SUB} {POWER_SET} 0; "
                f"powercfg /setdcvalueindex SCHEME_CURRENT {POWER_SUB} {POWER_SET} 0; "
                "powercfg /setactive SCHEME_CURRENT")
        code, out, err = ps(cmds)
        if code != 0:
            return ps_elevated(cmds + "; 'Plano de energia: Wi-Fi em desempenho máximo.'")
        return True, "Adaptador sem fio configurado para Desempenho Máximo (na tomada e na bateria)."

    return False, f"Ação desconhecida: {name}"
