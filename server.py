"""Wi-Fi Otimizador — servidor local (somente 127.0.0.1) + painel web.

Execute:  python server.py
"""
import json
import mimetypes
import os
import secrets
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import analysis
import certify
import nettools
import wlan

import socket

HOST, PORT = "0.0.0.0", 8765
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
TOKEN = secrets.token_urlsafe(24)  # protege a API contra sites maliciosos (CSRF)

_client = None
_scan_lock = threading.Lock()
_state = {"net": None, "net_time": 0}


def client():
    global _client
    if _client is None:
        _client = wlan.WlanClient()
    return _client


def wifi_iface():
    ifs = client().interfaces()
    if not ifs:
        raise RuntimeError("Nenhum adaptador Wi-Fi encontrado.")
    connected = [i for i in ifs if i["state"] == 1]
    return (connected or ifs)[0]


def net_info(force=False):
    if force or not _state["net"] or time.time() - _state["net_time"] > 30:
        _state["net"] = nettools.net_info()
        _state["net_time"] = time.time()
    return _state["net"]


def do_scan():
    with _scan_lock:
        c = client()
        it = wifi_iface()
        g = it["guid"]
        c.scan(g)
        time.sleep(3.5)  # tempo para a varredura de todos os canais terminar
        aps = c.bss_list(g)
        conn = c.connection(g)
    current = None
    mine = []
    if conn:
        current = next((a for a in aps if a["bssid"] == conn["bssid"]), None)
        if current:
            current["rssi"] = c.rssi(g) or current["rssi"]
        mine = [a for a in aps if (conn["ssid"] and a["ssid"] == conn["ssid"])
                or analysis.same_device(a["bssid"], conn["bssid"])]
    mine_set = {a["bssid"] for a in mine}
    for a in aps:
        a["mine"] = a["bssid"] in mine_set
        a["connected"] = bool(conn) and a["bssid"] == conn["bssid"]
    channels = analysis.analyze_channels(aps, mine_set)
    diag = analysis.diagnose(aps, conn, current, channels, mine)
    return {
        "adapter": it["description"],
        "connection": conn,
        "current": current,
        "aps": sorted(aps, key=lambda a: -a["rssi"]),
        "channels": channels,
        "diagnosis": diag,
        "net": net_info(),
        "time": time.time(),
    }


def signal():
    c = client()
    it = wifi_iface()
    conn = c.connection(it["guid"])
    if not conn:
        return {"connected": False}
    rssi = c.rssi(it["guid"])
    if rssi is None:
        rssi = int(conn["quality"] / 2 - 100)
    return {"connected": True, "rssi": rssi, "quality": conn["quality"], "ssid": conn["ssid"],
            "bssid": conn["bssid"], "rx": conn["rx_mbps"], "tx": conn["tx_mbps"],
            "channel": c.channel(it["guid"]), "t": time.time()}


class Handler(BaseHTTPRequestHandler):
    server_version = "WiFiOtimizador/1.0"

    def log_message(self, fmt, *args):
        pass

    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host in ("127.0.0.1", "localhost", "0.0.0.0"):
            return True
        # Aceita conexões vindas da rede local privada (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        if host.startswith("192.168.") or host.startswith("10.") or host.startswith("172."):
            return True
        return False

    def _json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as f:
            data = f.read()
        if full.endswith("index.html"):
            data = data.replace(b"__TOKEN__", TOKEN.encode())
        if full.endswith(".json") or full.endswith("manifest.json"):
            ctype = "application/manifest+json; charset=utf-8"
        elif full.endswith("sw.js"):
            ctype = "application/javascript; charset=utf-8"
        elif full.endswith(".svg"):
            ctype = "image/svg+xml"
        else:
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _guard(self):
        if not self._host_ok():
            self.send_error(403)
            return False
        if self.path.startswith("/api/") and self.headers.get("X-Token") != TOKEN:
            self._json({"error": "Token inválido"}, 403)
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        try:
            if path == "/api/scan":
                return self._json(do_scan())
            if path == "/api/signal":
                return self._json(signal())
            if path == "/api/ping":
                return self._json(nettools.ping_suite(net_info().get("gateway")))
            if path == "/api/dns":
                return self._json(nettools.dns_bench(net_info(force=True).get("dns", [])))
            if path == "/api/speed":
                return self._json(nettools.speed_test())
            if path == "/api/adapter":
                n = net_info()
                return self._json({"net": n, "props": nettools.adapter_properties(n.get("name") or "Wi-Fi")})
            if path.startswith("/api/"):
                return self._json({"error": "Rota inexistente"}, 404)
            return self._static(path)
        except wlan.WlanError as e:
            return self._json({"error": str(e)}, 500)
        except Exception as e:
            traceback.print_exc()
            return self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def do_POST(self):
        if not self._guard():
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            path = urlparse(self.path).path
            if path == "/api/certify":
                cdata = certify.generate_certificate_data(
                    body.get("client_info") or {},
                    body.get("points") or [],
                    body.get("sla_profile") or "residencial_padrao"
                )
                return self._json(cdata)
            if path != "/api/action":
                return self._json({"error": "Rota inexistente"}, 404)
            n = net_info()
            ctx = {"iface": n.get("name"), "index": n.get("index")}
            try:
                conn = client().connection(wifi_iface()["guid"])
                ctx["profile"] = conn and conn["profile"]
            except Exception:
                pass
            ok, out = nettools.action(body.get("action"), body.get("params") or {}, ctx)
            net_info(force=True)
            return self._json({"ok": ok, "output": out})
        except Exception as e:
            traceback.print_exc()
            return self._json({"ok": False, "output": f"{type(e).__name__}: {e}"}, 500)


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    if sys.platform != "win32":
        print("Este app funciona apenas no Windows.")
        sys.exit(1)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    local_ip = get_local_ip()
    url_local = f"http://127.0.0.1:{PORT}/"
    url_network = f"http://{local_ip}:{PORT}/"
    print("=" * 64)
    print("  CertiFi Pro rodando em:")
    print("    • No Computador: ", url_local)
    print("    • No Celular / Tablet: ", url_network)
    print("  Feche esta janela (ou Ctrl+C) para encerrar.")
    print("=" * 64)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url_local)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
