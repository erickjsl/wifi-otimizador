package com.certifi.pro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private WebView webView;
    private static final int PERMISSION_REQUEST_CODE = 100;
    private static final String CHANNEL_ID = "certifi_alerts";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        webView.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);
        webView.setBackgroundColor(0xFF0B1020); // Cor de fundo escura nativa para prevenir flash branco

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage consoleMessage) {
                android.util.Log.d("CertiFiWeb", consoleMessage.message() + " -- From line "
                        + consoleMessage.lineNumber() + " of " + consoleMessage.sourceId());
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                // Links externos (ex.: painel do roteador) abrem no navegador
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // Previne a tela branca de crash com ícone triste: se o renderizador sofrer OOM ou falha de GPU, recria imediatamente
                android.util.Log.e("CertiFiWeb", "Render process gone. Did crash: " + (detail != null && detail.didCrash()));
                if (webView != null) {
                    ((android.view.ViewGroup) webView.getParent()).removeView(webView);
                    webView.destroy();
                    webView = null;
                }
                recreate();
                return true;
            }
        });

        // Ponte nativa: o JavaScript chama window.AndroidWifi.*
        webView.addJavascriptInterface(new WifiBridge(), "AndroidWifi");

        createNotificationChannel();
        requestNativePermissions();

        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean hasLocationPermission() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNativePermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> perms = new ArrayList<>();
        perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissions(perms.toArray(new String[0]), PERMISSION_REQUEST_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Avisa a página para refazer a análise agora que a permissão foi decidida
        if (webView != null) {
            webView.post(() -> webView.evaluateJavascript(
                    "window.onNativePermission && window.onNativePermission()", null));
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Alertas CertiFi",
                    NotificationManager.IMPORTANCE_DEFAULT);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    // =====================================================================
    //  Ponte JavaScript <-> Android
    // =====================================================================
    private class WifiBridge {

        private WifiManager wifi() {
            return (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        }

        @JavascriptInterface
        public String status() {
            JSONObject o = new JSONObject();
            try {
                boolean locOn = true;
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                if (lm != null) {
                    if (Build.VERSION.SDK_INT >= 28) locOn = lm.isLocationEnabled();
                    else locOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                            || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                }
                WifiManager w = wifi();
                o.put("permission", hasLocationPermission());
                o.put("location", locOn);
                o.put("wifi", w != null && w.isWifiEnabled());
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("support5", w != null && w.is5GHzBandSupported());
                o.put("support6", Build.VERSION.SDK_INT >= 30 && w != null && w.is6GHzBandSupported());
            } catch (Exception e) { safePut(o, "error", e.toString()); }
            return o.toString();
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(MainActivity.this::requestNativePermissions);
        }

        @JavascriptInterface
        public void openLocationSettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)));
        }

        @JavascriptInterface
        public void openWifiSettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS)));
        }

        @JavascriptInterface
        public boolean startScan() {
            try {
                WifiManager w = wifi();
                return w != null && w.startScan();
            } catch (Exception e) { return false; }
        }

        @SuppressLint("MissingPermission")
        @JavascriptInterface
        public String scan() {
            JSONArray arr = new JSONArray();
            try {
                WifiManager w = wifi();
                if (w == null || !hasLocationPermission()) return arr.toString();
                List<ScanResult> list = w.getScanResults();
                for (ScanResult r : list) {
                    JSONObject o = new JSONObject();
                    o.put("ssid", r.SSID == null ? "" : r.SSID);
                    o.put("bssid", r.BSSID == null ? "" : r.BSSID.toLowerCase(Locale.ROOT));
                    o.put("rssi", r.level);
                    o.put("freq", r.frequency);
                    o.put("width", widthMhz(r.channelWidth));
                    o.put("center0", r.centerFreq0);
                    o.put("caps", r.capabilities == null ? "" : r.capabilities);
                    o.put("std", Build.VERSION.SDK_INT >= 30 ? r.getWifiStandard() : 0);
                    arr.put(o);
                }
            } catch (Exception e) { /* devolve o que tiver */ }
            return arr.toString();
        }

        @SuppressLint("MissingPermission")
        @JavascriptInterface
        public String connection() {
            JSONObject o = new JSONObject();
            try {
                WifiManager w = wifi();
                ConnectivityManager cm = (ConnectivityManager) getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
                WifiInfo i = null;
                boolean isWifiConnected = false;

                if (cm != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        Network activeNet = cm.getActiveNetwork();
                        if (activeNet != null) {
                            NetworkCapabilities caps = cm.getNetworkCapabilities(activeNet);
                            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                                isWifiConnected = true;
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                    Object transportInfo = caps.getTransportInfo();
                                    if (transportInfo instanceof WifiInfo) {
                                        i = (WifiInfo) transportInfo;
                                    }
                                }
                            }
                        }
                    } else {
                        NetworkInfo ni = cm.getActiveNetworkInfo();
                        if (ni != null && ni.isConnected() && ni.getType() == ConnectivityManager.TYPE_WIFI) {
                            isWifiConnected = true;
                        }
                    }
                }

                if (i == null && w != null) {
                    i = w.getConnectionInfo();
                }

                // Considera conectado se o ConnectivityManager confirmou Wi-Fi ou WifiInfo é válido
                boolean validInfo = (i != null && (i.getNetworkId() != -1 || (i.getBSSID() != null && !i.getBSSID().isEmpty()) || i.getRssi() > -127));
                if (!isWifiConnected && !validInfo) {
                    o.put("connected", false);
                    return o.toString();
                }

                String ssid = (i != null && i.getSSID() != null) ? i.getSSID().replace("\"", "") : "";
                if ("<unknown ssid>".equals(ssid)) ssid = "";
                String bssid = (i != null && i.getBSSID() != null) ? i.getBSSID().toLowerCase(Locale.ROOT) : "";
                int rssi = i != null ? i.getRssi() : -65;
                if (rssi <= -127 || rssi > 0) rssi = -65; // fallback razoável caso Android oculte RSSI

                int linkSpeed = i != null ? i.getLinkSpeed() : 0;
                int freq = i != null ? i.getFrequency() : 2412;

                o.put("connected", true);
                o.put("ssid", ssid);
                o.put("bssid", bssid);
                o.put("rssi", rssi);
                o.put("link", linkSpeed);
                o.put("freq", freq);

                if (Build.VERSION.SDK_INT >= 29 && i != null) {
                    o.put("rx", i.getRxLinkSpeedMbps());
                    o.put("tx", i.getTxLinkSpeedMbps());
                } else {
                    o.put("rx", linkSpeed);
                    o.put("tx", linkSpeed);
                }
                o.put("std", (Build.VERSION.SDK_INT >= 30 && i != null) ? i.getWifiStandard() : 0);

                if (w != null) {
                    DhcpInfo d = w.getDhcpInfo();
                    if (d != null) {
                        o.put("ip", ip(d.ipAddress));
                        o.put("gateway", ip(d.gateway));
                        JSONArray dns = new JSONArray();
                        if (d.dns1 != 0) dns.put(ip(d.dns1));
                        if (d.dns2 != 0) dns.put(ip(d.dns2));
                        o.put("dns", dns);
                    }
                }
            } catch (Exception e) { safePut(o, "error", e.toString()); }
            return o.toString();
        }

        /** Ping real usando o binário do sistema. Retorna média, jitter e perda. */
        @JavascriptInterface
        public String ping(String host, int count) {
            JSONObject o = new JSONObject();
            safePut(o, "host", host);
            if (host == null || !host.matches("[A-Za-z0-9.:\\-]+")) {
                safePut(o, "error", "host inválido");
                return o.toString();
            }
            int n = Math.max(1, Math.min(count, 20));
            List<Double> times = new ArrayList<>();
            try {
                Process p = new ProcessBuilder("/system/bin/ping", "-c", String.valueOf(n),
                        "-i", "0.2", "-W", "2", host).redirectErrorStream(true).start();
                BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
                Pattern pt = Pattern.compile("time[=<]([0-9.]+)");
                String line;
                while ((line = br.readLine()) != null) {
                    Matcher m = pt.matcher(line);
                    if (m.find()) times.add(Double.parseDouble(m.group(1)));
                }
                p.waitFor();
            } catch (Exception e) { safePut(o, "error", e.toString()); }
            double loss = 100.0 * (n - times.size()) / n;
            safePut(o, "loss", Math.round(loss * 10) / 10.0);
            if (!times.isEmpty()) {
                double sum = 0; for (double t : times) sum += t;
                double avg = sum / times.size();
                double jit = 0;
                for (int k = 1; k < times.size(); k++) jit += Math.abs(times.get(k) - times.get(k - 1));
                if (times.size() > 1) jit /= (times.size() - 1);
                safePut(o, "avg", Math.round(avg * 10) / 10.0);
                safePut(o, "jitter", Math.round(jit * 10) / 10.0);
            }
            return o.toString();
        }

        @JavascriptInterface
        public void notify(String title, String body) {
            runOnUiThread(() -> {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm == null) return;
                    android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26
                            ? new android.app.Notification.Builder(MainActivity.this, CHANNEL_ID)
                            : new android.app.Notification.Builder(MainActivity.this);
                    b.setSmallIcon(R.drawable.ic_launcher)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setAutoCancel(true);
                    nm.notify((int) (System.currentTimeMillis() % 100000), b.build());
                } catch (Exception ignored) { }
            });
        }

        private int widthMhz(int cw) {
            switch (cw) {
                case 1: return 40;
                case 2: return 80;
                case 3: return 160;
                case 4: return 160; // 80+80
                case 5: return 320;
                default: return 20;
            }
        }

        private String ip(int v) {
            return (v & 0xff) + "." + ((v >> 8) & 0xff) + "." + ((v >> 16) & 0xff) + "." + ((v >> 24) & 0xff);
        }

        private void safePut(JSONObject o, String k, Object v) {
            try { o.put(k, v); } catch (Exception ignored) { }
        }
    }
}
