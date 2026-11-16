// MendcraftLan — the LAN half of add-a-device on iPhone. Chrome can't send UDP
// or scan Wi-Fi, so on iOS the connector interpreter's transports land here:
//   sendUdp   one JSON datagram to a PRIVATE IPv4 host, wait for one reply
//   http      one request to a PRIVATE IPv4 URL
//   discover  WiZ broadcast (UDP 38899) or Bonjour browse (mdns)
// The web interpreter (src/devices/connector.ts) has already validated the
// connector and filled the template; this file re-checks host + port anyway.
//
// STATUS: written on Linux, NOT compiled or run yet (no Mac/Xcode on the build
// box). Needs in Info.plist: NSLocalNetworkUsageDescription, NSBonjourServices
// (e.g. _hap._tcp), NSAppTransportSecurity/NSAllowsLocalNetworking; and the
// com.apple.developer.networking.multicast entitlement for UDP broadcast.

import Foundation
import Network
import Capacitor

@objc(MendcraftLanPlugin)
public class MendcraftLanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MendcraftLanPlugin"
    public let jsName = "MendcraftLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendUdp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "http", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
    ]

    static let allowedUdpPorts: Set<Int> = [38899, 4003]
    static let allowedHttpPorts: Set<Int> = [80, 8080, 8081, 9123]

    static func isPrivateIPv4(_ host: String) -> Bool {
        let p = host.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4, p.allSatisfy({ (0...255).contains($0) }) else { return false }
        return p[0] == 10 || (p[0] == 172 && (16...31).contains(p[1])) || (p[0] == 192 && p[1] == 168)
    }

    @objc func sendUdp(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), MendcraftLanPlugin.isPrivateIPv4(host),
              let port = call.getInt("port"), MendcraftLanPlugin.allowedUdpPorts.contains(port),
              let payload = call.getString("payload"), let data = payload.data(using: .utf8), data.count < 4096 else {
            call.reject("host/port not allowed"); return
        }
        let waitMs = call.getInt("waitMs") ?? 800
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: UInt16(port))!, using: .udp)
        var done = false
        let finish: (String?) -> Void = { reply in
            if done { return }
            done = true
            conn.cancel()
            call.resolve(reply.map { ["reply": $0] } ?? [:])
        }
        conn.start(queue: .global())
        conn.send(content: data, completion: .contentProcessed { err in
            if let err = err { if !done { done = true; conn.cancel(); call.reject("\(err)") }; return }
            conn.receiveMessage { content, _, _, _ in
                finish(content.flatMap { String(data: $0, encoding: .utf8) })
            }
        })
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(waitMs)) { finish(nil) }
    }

    @objc func http(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), url.scheme == "http",
              let host = url.host, MendcraftLanPlugin.isPrivateIPv4(host),
              MendcraftLanPlugin.allowedHttpPorts.contains(url.port ?? 80) else {
            call.reject("url not allowed"); return
        }
        let method = (call.getString("method") ?? "GET").uppercased()
        guard ["GET", "POST", "PUT"].contains(method) else { call.reject("method not allowed"); return }
        var req = URLRequest(url: url, timeoutInterval: 4)
        req.httpMethod = method
        if let body = call.getString("body") {
            req.httpBody = body.data(using: .utf8)
            req.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        URLSession.shared.dataTask(with: req) { data, resp, err in
            if let err = err { call.reject("\(err)"); return }
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            call.resolve(["status": status, "body": data.flatMap { String(data: $0, encoding: .utf8) } ?? ""])
        }.resume()
    }

    @objc func discover(_ call: CAPPluginCall) {
        let method = call.getString("method") ?? "manual"
        let waitMs = call.getInt("waitMs") ?? 1500
        switch method {
        case "wiz-udp-broadcast":
            DispatchQueue.global().async {
                let found = MendcraftLanPlugin.broadcastWiz(waitMs: waitMs)
                call.resolve(["devices": found.map { ["host": $0, "name": "WiZ bulb"] }])
            }
        case "mdns":
            browseBonjour(type: call.getString("service") ?? "_http._tcp", waitMs: waitMs, call: call)
        default:
            call.resolve(["devices": []])
        }
    }

    /// WiZ: broadcast getPilot to 255.255.255.255:38899 and collect responders.
    /// BSD socket because NWConnection can't receive from many senders.
    static func broadcastWiz(waitMs: Int) -> [String] {
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else { return [] }
        defer { close(fd) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout<Int32>.size))
        var tv = timeval(tv_sec: 0, tv_usec: 200_000)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(38899).bigEndian
        addr.sin_addr.s_addr = INADDR_BROADCAST
        let msg = Array("{\"method\":\"getPilot\",\"params\":{}}".utf8)
        _ = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(fd, msg, msg.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        var hosts = Set<String>()
        let deadline = Date().addingTimeInterval(Double(waitMs) / 1000)
        var buf = [UInt8](repeating: 0, count: 2048)
        while Date() < deadline {
            var from = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { recvfrom(fd, &buf, buf.count, 0, $0, &len) }
            }
            if n > 0 {
                let ip = String(cString: inet_ntoa(from.sin_addr))
                if isPrivateIPv4(ip) { hosts.insert(ip) }
            }
        }
        return Array(hosts)
    }

    private var browser: NWBrowser?

    private func browseBonjour(type: String, waitMs: Int, call: CAPPluginCall) {
        let b = NWBrowser(for: .bonjour(type: type, domain: nil), using: .tcp)
        browser = b
        var names: [String] = []
        b.browseResultsChangedHandler = { results, _ in
            names = results.compactMap {
                if case let .service(name, _, _, _) = $0.endpoint { return name }
                return nil
            }
        }
        b.start(queue: .global())
        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(waitMs)) { [weak self] in
            b.cancel()
            self?.browser = nil
            // Bonjour gives names; resolving to an IP needs a connection — left
            // for the device test. Returned without host, so the web asks her.
            call.resolve(["devices": [], "names": names])
        }
    }
}
