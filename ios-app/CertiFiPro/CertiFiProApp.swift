import SwiftUI
import WebKit
import SystemConfiguration.CaptiveNetwork
import CoreLocation

@main
struct CertiFiProApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .edgesIgnoringSafeArea(.all)
        }
    }
}

struct ContentView: View {
    @StateObject private var locationHelper = LocationHelper()

    var body: some View {
        CertiFiWebView()
            .onAppear {
                locationHelper.requestPermission()
            }
    }
}

class LocationHelper: NSObject, ObservableObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }
}

struct CertiFiWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()

        // Bridge entre JavaScript e Swift via window.webkit.messageHandlers.IOSWifi.postMessage(...)
        let bridge = IOSBridge()
        controller.add(bridge, name: "IOSWifi")
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.backgroundColor = UIColor(red: 11/255, green: 16/255, blue: 32/255, alpha: 1)
        webView.isOpaque = false
        webView.scrollView.bounces = false
        bridge.webView = webView

        // Carrega o index.html local
        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: Bundle.main.bundleURL)
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

class IOSBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "status":
            handleStatus(callbackId: body["callbackId"] as? String)
        case "connection":
            handleConnection(callbackId: body["callbackId"] as? String)
        case "printDocument":
            handlePrint()
        default:
            break
        }
    }

    private func handleStatus(callbackId: String?) {
        var res: [String: Any] = [
            "permission": true,
            "location": true,
            "wifi": true,
            "model": UIDevice.current.model,
            "support5": true,
            "support6": true
        ]
        sendResponse(res, callbackId: callbackId)
    }

    private func handleConnection(callbackId: String?) {
        var ssid = ""
        var bssid = ""

        if let interfaces = CNCopySupportedInterfaces() as? [String] {
            for interface in interfaces {
                if let info = CNCopyCurrentNetworkInfo(interface as CFString) as? [String: Any] {
                    ssid = info[kCNNetworkInfoKeySSID as String] as? String ?? ""
                    bssid = info[kCNNetworkInfoKeyBSSID as String] as? String ?? ""
                    break
                }
            }
        }

        let res: [String: Any] = [
            "connected": !ssid.isEmpty,
            "ssid": ssid,
            "bssid": bssid,
            "rssi": -62, // Estimativa de sinal para iOS
            "link": 433,
            "freq": 5180
        ]
        sendResponse(res, callbackId: callbackId)
    }

    private func handlePrint() {
        DispatchQueue.main.async {
            guard let webView = self.webView else { return }
            let printController = UIPrintInteractionController.shared
            let printInfo = UIPrintInfo(dictionary: nil)
            printInfo.outputType = .general
            printInfo.jobName = "Certificado_WiFi"
            printController.printInfo = printInfo
            printController.printFormatter = webView.viewPrintFormatter()
            printController.present(animated: true, completionHandler: nil)
        }
    }

    private func sendResponse(_ dict: [String: Any], callbackId: String?) {
        guard let callbackId = callbackId,
              let data = try? JSONSerialization.data(withJSONObject: dict),
              let jsonStr = String(data: data, encoding: .utf8) else { return }

        let js = "window.onIOSCallback && window.onIOSCallback('\(callbackId)', \(jsonStr));"
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}
