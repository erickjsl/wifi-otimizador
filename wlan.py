"""Acesso à API nativa de Wi-Fi do Windows (wlanapi.dll) via ctypes.

Usar a API diretamente (em vez de parsear `netsh`) torna o app independente do
idioma do Windows e dá acesso a dados que o netsh não mostra (Information
Elements dos beacons: largura de canal, padrão Wi-Fi, segurança detalhada).
"""
import ctypes
import threading
from ctypes import (Structure, POINTER, byref, sizeof, c_ulong, c_ubyte, c_ushort,
                    c_long, c_ulonglong, c_int, c_void_p, c_wchar, addressof, string_at)
from ctypes import wintypes as wt


# --------------------------------------------------------------------------- #
# Estruturas
# --------------------------------------------------------------------------- #
class GUID(Structure):
    _fields_ = [("Data1", c_ulong), ("Data2", c_ushort), ("Data3", c_ushort),
                ("Data4", c_ubyte * 8)]


class WLAN_INTERFACE_INFO(Structure):
    _fields_ = [("InterfaceGuid", GUID),
                ("strInterfaceDescription", c_wchar * 256),
                ("isState", c_int)]


class WLAN_INTERFACE_INFO_LIST(Structure):
    _fields_ = [("dwNumberOfItems", wt.DWORD), ("dwIndex", wt.DWORD),
                ("InterfaceInfo", WLAN_INTERFACE_INFO * 1)]


class DOT11_SSID(Structure):
    _fields_ = [("uSSIDLength", c_ulong), ("ucSSID", c_ubyte * 32)]


class WLAN_RATE_SET(Structure):
    _fields_ = [("uRateSetLength", c_ulong), ("usRateSet", c_ushort * 126)]


class WLAN_BSS_ENTRY(Structure):
    _fields_ = [
        ("dot11Ssid", DOT11_SSID),
        ("uPhyId", c_ulong),
        ("dot11Bssid", c_ubyte * 6),
        ("dot11BssType", c_int),
        ("dot11BssPhyType", c_int),
        ("lRssi", c_long),
        ("uLinkQuality", c_ulong),
        ("bInRegDomain", c_ubyte),
        ("usBeaconPeriod", c_ushort),
        ("ullTimestamp", c_ulonglong),
        ("ullHostTimestamp", c_ulonglong),
        ("usCapabilityInformation", c_ushort),
        ("ulChCenterFrequency", c_ulong),
        ("wlanRateSet", WLAN_RATE_SET),
        ("ulIeOffset", c_ulong),
        ("ulIeSize", c_ulong),
    ]


class WLAN_BSS_LIST(Structure):
    _fields_ = [("dwTotalSize", wt.DWORD), ("dwNumberOfItems", wt.DWORD),
                ("wlanBssEntries", WLAN_BSS_ENTRY * 1)]


class WLAN_ASSOCIATION_ATTRIBUTES(Structure):
    _fields_ = [("dot11Ssid", DOT11_SSID), ("dot11BssType", c_int),
                ("dot11Bssid", c_ubyte * 6), ("dot11PhyType", c_int),
                ("uDot11PhyIndex", c_ulong), ("wlanSignalQuality", c_ulong),
                ("ulRxRate", c_ulong), ("ulTxRate", c_ulong)]


class WLAN_SECURITY_ATTRIBUTES(Structure):
    _fields_ = [("bSecurityEnabled", wt.BOOL), ("bOneXEnabled", wt.BOOL),
                ("dot11AuthAlgorithm", c_int), ("dot11CipherAlgorithm", c_int)]


class WLAN_CONNECTION_ATTRIBUTES(Structure):
    _fields_ = [("isState", c_int), ("wlanConnectionMode", c_int),
                ("strProfileName", c_wchar * 256),
                ("wlanAssociationAttributes", WLAN_ASSOCIATION_ATTRIBUTES),
                ("wlanSecurityAttributes", WLAN_SECURITY_ATTRIBUTES)]


# --------------------------------------------------------------------------- #
# Funções da DLL
# --------------------------------------------------------------------------- #
_api = ctypes.WinDLL("wlanapi.dll")

_WlanOpenHandle = _api.WlanOpenHandle
_WlanOpenHandle.argtypes = [wt.DWORD, c_void_p, POINTER(wt.DWORD), POINTER(wt.HANDLE)]
_WlanOpenHandle.restype = wt.DWORD

_WlanCloseHandle = _api.WlanCloseHandle
_WlanCloseHandle.argtypes = [wt.HANDLE, c_void_p]
_WlanCloseHandle.restype = wt.DWORD

_WlanEnumInterfaces = _api.WlanEnumInterfaces
_WlanEnumInterfaces.argtypes = [wt.HANDLE, c_void_p, POINTER(POINTER(WLAN_INTERFACE_INFO_LIST))]
_WlanEnumInterfaces.restype = wt.DWORD

_WlanScan = _api.WlanScan
_WlanScan.argtypes = [wt.HANDLE, POINTER(GUID), c_void_p, c_void_p, c_void_p]
_WlanScan.restype = wt.DWORD

_WlanGetNetworkBssList = _api.WlanGetNetworkBssList
_WlanGetNetworkBssList.argtypes = [wt.HANDLE, POINTER(GUID), c_void_p, c_int, wt.BOOL,
                                   c_void_p, POINTER(POINTER(WLAN_BSS_LIST))]
_WlanGetNetworkBssList.restype = wt.DWORD

_WlanQueryInterface = _api.WlanQueryInterface
_WlanQueryInterface.argtypes = [wt.HANDLE, POINTER(GUID), c_int, c_void_p,
                                POINTER(wt.DWORD), POINTER(c_void_p), POINTER(c_int)]
_WlanQueryInterface.restype = wt.DWORD

_WlanFreeMemory = _api.WlanFreeMemory
_WlanFreeMemory.argtypes = [c_void_p]
_WlanFreeMemory.restype = None

OPCODE_CURRENT_CONNECTION = 7
OPCODE_CHANNEL_NUMBER = 8
OPCODE_RSSI = 0x10000102

PHY_NAMES = {1: "FHSS", 2: "802.11 (DSSS)", 3: "IR", 4: "802.11a", 5: "802.11b",
             6: "802.11g", 7: "802.11n", 8: "802.11ac", 9: "802.11ad", 10: "802.11ax",
             11: "802.11be"}

AUTH_NAMES = {1: "Aberta", 2: "WEP (chave compartilhada)", 3: "WPA-Enterprise", 4: "WPA-Personal",
              5: "WPA-None", 6: "WPA2-Enterprise", 7: "WPA2-Personal", 8: "WPA3-Enterprise 192",
              9: "WPA3-Personal (SAE)", 10: "OWE (Enhanced Open)", 11: "WPA3-Enterprise"}

CIPHER_NAMES = {0: "Nenhuma", 1: "WEP-40", 2: "TKIP", 4: "AES-CCMP", 5: "WEP-104",
                6: "BIP", 8: "AES-GCMP", 9: "AES-GCMP-256", 10: "AES-CCMP-256", 0x101: "WEP"}


class WlanError(Exception):
    def __init__(self, func, code):
        self.code = code
        if code == 5:
            msg = ("Acesso negado à varredura Wi-Fi. No Windows 11, ative "
                   "Configurações > Privacidade e segurança > Localização e permita "
                   "'Permitir que aplicativos da área de trabalho acessem sua localização'.")
        elif code == 1062:
            msg = "O serviço WLAN AutoConfig (WlanSvc) não está em execução."
        else:
            msg = f"{func} falhou (código {code})."
        super().__init__(msg)


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #
def _mac(arr):
    return ":".join(f"{b:02x}" for b in arr)


def _ssid(s: DOT11_SSID):
    raw = bytes(s.ucSSID[: s.uSSIDLength])
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def freq_to_channel(freq_mhz):
    """Retorna (banda, canal) a partir da frequência central em MHz."""
    if 2400 <= freq_mhz <= 2500:
        return "2.4", 14 if freq_mhz == 2484 else (freq_mhz - 2407) // 5
    if 4900 <= freq_mhz < 5935:
        return "5", (freq_mhz - 5000) // 5
    if 5935 <= freq_mhz <= 7125:
        return "6", (freq_mhz - 5950) // 5
    return "?", 0


def channel_to_freq(band, ch):
    if band == "2.4":
        return 2484 if ch == 14 else 2407 + 5 * ch
    if band == "5":
        return 5000 + 5 * ch
    if band == "6":
        return 5950 + 5 * ch
    return 0


def parse_ies(ie: bytes):
    """Interpreta os Information Elements do beacon/probe response."""
    info = {"ht": False, "vht": False, "he": False, "eht": False,
            "akm": [], "pairwise": [], "wpa": False,
            "ht_offset": 0, "ht_any_width": False,
            "vht_width": None, "vht_cf0": 0, "vht_cf1": 0, "he6": None,
            "country": None}
    i, n = 0, len(ie)
    while i + 2 <= n:
        eid, ln = ie[i], ie[i + 1]
        body = ie[i + 2: i + 2 + ln]
        if len(body) < ln:
            break
        if eid == 7 and ln >= 2:
            try:
                info["country"] = body[:2].decode("ascii")
            except UnicodeDecodeError:
                pass
        elif eid == 45:
            info["ht"] = True
        elif eid == 61 and ln >= 2:
            info["ht_offset"] = body[1] & 0x03
            info["ht_any_width"] = bool(body[1] & 0x04)
        elif eid == 191:
            info["vht"] = True
        elif eid == 192 and ln >= 3:
            info["vht_width"], info["vht_cf0"], info["vht_cf1"] = body[0], body[1], body[2]
        elif eid == 48 and ln >= 8:
            _parse_rsn(body, info)
        elif eid == 221 and ln >= 4 and body[:4] == b"\x00\x50\xf2\x01":
            info["wpa"] = True
        elif eid == 255 and ln >= 1:
            ext = body[0]
            if ext == 35:
                info["he"] = True
            elif ext == 36 and ln >= 7:
                _parse_he_op(body, info)
            elif ext == 108:
                info["eht"] = True
        i += 2 + ln
    return info


def _parse_rsn(b, info):
    try:
        pos = 2 + 4  # versão + group cipher
        cnt = int.from_bytes(b[pos:pos + 2], "little"); pos += 2
        for _ in range(cnt):
            info["pairwise"].append(b[pos + 3]); pos += 4
        cnt = int.from_bytes(b[pos:pos + 2], "little"); pos += 2
        for _ in range(cnt):
            if b[pos:pos + 3] == b"\x00\x0f\xac":
                info["akm"].append(b[pos + 3])
            pos += 4
    except IndexError:
        pass


def _parse_he_op(b, info):
    params = b[1] | (b[2] << 8) | (b[3] << 16)
    pos = 7
    if params & (1 << 14):
        pos += 3
    if params & (1 << 15):
        pos += 1
    if params & (1 << 17) and len(b) >= pos + 5:
        info["he6"] = {"w": b[pos + 1] & 0x03, "cf0": b[pos + 2], "cf1": b[pos + 3]}


def channel_layout(band, primary, info):
    """Calcula (largura_MHz, canal_central) do BSS."""
    width, center = 20, primary
    if band == "6":
        he6 = info.get("he6")
        if he6:
            width = {0: 20, 1: 40, 2: 80, 3: 160}[he6["w"]]
            if width == 160 and he6["cf1"]:
                center = he6["cf1"]
            elif width > 20:
                center = he6["cf0"] or primary
        return width, center
    if info["ht_offset"] in (1, 3) and info["ht_any_width"]:
        width = 40
        center = primary + (2 if info["ht_offset"] == 1 else -2)
    if band == "5" and info["vht_width"]:
        vw, cf0, cf1 = info["vht_width"], info["vht_cf0"], info["vht_cf1"]
        if vw == 1:
            if cf1 and abs(cf1 - cf0) == 8:
                width, center = 160, cf1
            else:
                width, center = 80, cf0
        elif vw == 2:
            width, center = 160, cf0
        elif vw == 3:
            width, center = 80, cf0
    return width, center


def security_label(info, privacy_bit):
    akm = set(info["akm"])
    tkip_only = bool(info["pairwise"]) and all(p == 2 for p in info["pairwise"])
    if akm & {8, 24}:
        label = "WPA2/WPA3-Personal" if akm & {2, 6} else "WPA3-Personal"
    elif akm & {12, 13}:
        label = "WPA3-Enterprise"
    elif akm & {1, 5}:
        label = "WPA2-Enterprise"
    elif akm & {2, 6}:
        label = "WPA2-Personal"
    elif 18 in akm:
        label = "OWE (Enhanced Open)"
    elif info["wpa"]:
        label = "WPA (obsoleto)"
    elif privacy_bit:
        label = "WEP (inseguro)"
    else:
        label = "Aberta"
    if tkip_only and "WPA" in label:
        label += " / TKIP"
    return label


def standard_label(info, phy, band):
    if info["eht"] or phy == 11:
        return "Wi-Fi 7"
    if info["he"] or phy == 10:
        return "Wi-Fi 6E" if band == "6" else "Wi-Fi 6"
    if info["vht"] or phy == 8:
        return "Wi-Fi 5"
    if info["ht"] or phy == 7:
        return "Wi-Fi 4"
    return "Legado (a/b/g)"


# --------------------------------------------------------------------------- #
# Cliente
# --------------------------------------------------------------------------- #
class WlanClient:
    def __init__(self):
        self._lock = threading.Lock()
        self._h = wt.HANDLE()
        ver = wt.DWORD()
        rc = _WlanOpenHandle(2, None, byref(ver), byref(self._h))
        if rc:
            raise WlanError("WlanOpenHandle", rc)

    def close(self):
        if self._h:
            _WlanCloseHandle(self._h, None)
            self._h = wt.HANDLE()

    def interfaces(self):
        with self._lock:
            p = POINTER(WLAN_INTERFACE_INFO_LIST)()
            rc = _WlanEnumInterfaces(self._h, None, byref(p))
            if rc:
                raise WlanError("WlanEnumInterfaces", rc)
            try:
                n = p.contents.dwNumberOfItems
                base = addressof(p.contents) + WLAN_INTERFACE_INFO_LIST.InterfaceInfo.offset
                arr = (WLAN_INTERFACE_INFO * n).from_address(base)
                return [{"guid": GUID.from_buffer_copy(bytes(it.InterfaceGuid)),
                         "description": it.strInterfaceDescription,
                         "state": it.isState} for it in arr]
            finally:
                _WlanFreeMemory(p)

    def scan(self, guid):
        with self._lock:
            return _WlanScan(self._h, byref(guid), None, None, None)

    def bss_list(self, guid):
        with self._lock:
            p = POINTER(WLAN_BSS_LIST)()
            rc = _WlanGetNetworkBssList(self._h, byref(guid), None, 3, False, None, byref(p))
            if rc:
                raise WlanError("WlanGetNetworkBssList", rc)
            try:
                n = p.contents.dwNumberOfItems
                base = addressof(p.contents) + WLAN_BSS_LIST.wlanBssEntries.offset
                out = []
                for k in range(n):
                    addr = base + k * sizeof(WLAN_BSS_ENTRY)
                    e = WLAN_BSS_ENTRY.from_address(addr)
                    ie = string_at(addr + e.ulIeOffset, e.ulIeSize) if e.ulIeSize else b""
                    out.append(self._bss_to_dict(e, ie))
                return out
            finally:
                _WlanFreeMemory(p)

    @staticmethod
    def _bss_to_dict(e, ie):
        freq = e.ulChCenterFrequency // 1000
        band, ch = freq_to_channel(freq)
        info = parse_ies(ie)
        width, center = channel_layout(band, ch, info)
        privacy = bool(e.usCapabilityInformation & 0x10)
        return {
            "ssid": _ssid(e.dot11Ssid),
            "bssid": _mac(e.dot11Bssid),
            "rssi": int(e.lRssi),
            "quality": int(e.uLinkQuality),
            "freq": freq,
            "band": band,
            "channel": int(ch),
            "width": width,
            "center": int(center),
            "phy": PHY_NAMES.get(e.dot11BssPhyType, "?"),
            "standard": standard_label(info, e.dot11BssPhyType, band),
            "security": security_label(info, privacy),
            "country": info["country"],
        }

    def _query(self, guid, opcode):
        size = wt.DWORD()
        data = c_void_p()
        vtype = c_int()
        rc = _WlanQueryInterface(self._h, byref(guid), opcode, None,
                                 byref(size), byref(data), byref(vtype))
        return rc, data

    def connection(self, guid):
        with self._lock:
            rc, data = self._query(guid, OPCODE_CURRENT_CONNECTION)
            if rc:
                return None
            try:
                c = ctypes.cast(data, POINTER(WLAN_CONNECTION_ATTRIBUTES)).contents
                a, s = c.wlanAssociationAttributes, c.wlanSecurityAttributes
                return {
                    "state": c.isState,
                    "profile": c.strProfileName,
                    "ssid": _ssid(a.dot11Ssid),
                    "bssid": _mac(a.dot11Bssid),
                    "phy": PHY_NAMES.get(a.dot11PhyType, "?"),
                    "quality": int(a.wlanSignalQuality),
                    "rx_mbps": a.ulRxRate / 1000,
                    "tx_mbps": a.ulTxRate / 1000,
                    "auth": AUTH_NAMES.get(s.dot11AuthAlgorithm, str(s.dot11AuthAlgorithm)),
                    "cipher": CIPHER_NAMES.get(s.dot11CipherAlgorithm, str(s.dot11CipherAlgorithm)),
                }
            finally:
                _WlanFreeMemory(data)

    def rssi(self, guid):
        with self._lock:
            rc, data = self._query(guid, OPCODE_RSSI)
            if rc:
                return None
            try:
                return int(ctypes.cast(data, POINTER(c_long)).contents.value)
            finally:
                _WlanFreeMemory(data)

    def channel(self, guid):
        with self._lock:
            rc, data = self._query(guid, OPCODE_CHANNEL_NUMBER)
            if rc:
                return None
            try:
                return int(ctypes.cast(data, POINTER(c_ulong)).contents.value)
            finally:
                _WlanFreeMemory(data)
