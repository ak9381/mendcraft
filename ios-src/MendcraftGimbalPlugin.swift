// MendcraftGimbal — OPTIONAL Apple DockKit control for a DockKit stand
// (Insta360 Flow 2 Pro). The add-a-device flow never needs it.
//
// Modes are chosen by the web layer (src/canvas/gimbalCanvas.ts):
//   face  — DockKit's OWN subject tracking (setSystemTrackingEnabled(true)).
//           We do not aim; the stand follows the person it sees.
//   hands — system tracking off; the web layer aims at her hands (only when a
//           hand tracker is actually producing frames).
//   hold  — system tracking off; nobody moves the stand.
//
// We no longer force system tracking off on load / resume / dock. The web
// layer's last choice (`wanted`) is re-applied on resume. aim() turns system
// tracking off for the duration of one move and then restores `wanted`;
// release() restores `wanted` too. When the app backgrounds, system tracking
// is turned back on (the stand behaves normally for other apps).
//
// UNVERIFIED: whether DockKit system tracking sees frames from the WKWebView
// getUserMedia camera (WebKit captures out of process). Because of that there
// is an OPT-IN camera keep-alive (`keepAlive: true` on setSystemTrackingEnabled):
// a minimal front-camera AVCaptureSession with no preview, no recording and no
// frame processing, so the app itself has a capture session DockKit can use.
// It is stopped on hold / hands / release-to-off / background. Test both ways.
//
// Everything DockKit is behind `#if canImport(DockKit)` and
// `@available(iOS 18.0, *)` (setOrientation is iOS 18+).
// Axis convention to verify on the device: DockKit Vector3D x = pitch (tilt),
// y = yaw (pan), z = roll; angles in radians; relative:true = from current pose.
//
// Copy this file into ios/App/App after `npx cap add ios` (see ios-src/README.md).

import Foundation
import UIKit
import AVFoundation
import Capacitor
#if canImport(DockKit)
import DockKit
import Spatial
#endif

@objc(MendcraftGimbalPlugin)
public class MendcraftGimbalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MendcraftGimbalPlugin"
    public let jsName = "MendcraftGimbal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aim", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSystemTrackingEnabled", returnType: CAPPluginReturnPromise),
    ]

    private var fgObserver: NSObjectProtocol?
    private var bgObserver: NSObjectProtocol?

    public override func load() {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            DockWatcher.shared.start()
            fgObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { _ in
                DockWatcher.shared.start()
                Task { await DockWatcher.shared.didBecomeActive() }
            }
            bgObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil,
                queue: .main
            ) { _ in
                Task { await DockWatcher.shared.didEnterBackground() }
            }
        }
        #endif
    }

    deinit {
        if let fgObserver { NotificationCenter.default.removeObserver(fgObserver) }
        if let bgObserver { NotificationCenter.default.removeObserver(bgObserver) }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let docked = await DockWatcher.shared.isDocked()
                call.resolve([
                    "available": docked,
                    "reason": docked ? "" : "No DockKit stand docked",
                    "systemTracking": DockWatcher.systemTrackingEnabled(),
                ])
            }
            return
        }
        call.resolve(["available": false, "reason": "Manual gimbal control needs iOS 18"])
        #else
        call.resolve(["available": false, "reason": "DockKit not in this SDK"])
        #endif
    }

    /// Relative move. yaw = pan (+ right), pitch = tilt (+ up), radians.
    /// System tracking is off only for this move, then restored.
    @objc func aim(_ call: CAPPluginCall) {
        let yaw = call.getDouble("yaw") ?? 0
        let pitch = call.getDouble("pitch") ?? 0
        let seconds = call.getDouble("seconds") ?? 1.2
        // Same safety clamp as the web side (30° per move): gentle, no whips.
        let maxStep = 30.0 * Double.pi / 180.0
        let y = max(-maxStep, min(maxStep, yaw))
        let p = max(-maxStep, min(maxStep, pitch))
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                do {
                    let ok = try await DockWatcher.shared.aim(yaw: y, pitch: p, seconds: seconds)
                    call.resolve(ok ? ["ok": true] : ["ok": false, "error": "No DockKit stand docked"])
                } catch {
                    call.resolve(["ok": false, "error": "\(error.localizedDescription)"])
                }
            }
            return
        }
        call.resolve(["ok": false, "error": "Manual gimbal control needs iOS 18"])
        #else
        call.resolve(["ok": false, "error": "DockKit not in this SDK"])
        #endif
    }

    /// Restore the web layer's chosen system-tracking state (after our moves).
    @objc func release(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let r = await DockWatcher.shared.restoreWanted()
                call.resolve(r)
            }
            return
        }
        #endif
        call.resolve(["ok": false, "enabled": false])
    }

    /// enabled: DockKit system (subject) tracking on/off.
    /// keepAlive (opt-in, default false): run a minimal front-camera
    /// AVCaptureSession while tracking is on. Resolves with what is REALLY set.
    @objc func setSystemTrackingEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let keepAlive = call.getBool("keepAlive") ?? false
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let r = await DockWatcher.shared.setWanted(enabled, keepAlive: keepAlive)
                call.resolve(r)
            }
            return
        }
        call.resolve(["ok": false, "enabled": false, "keepAlive": false, "error": "DockKit tracking control needs iOS 18"])
        #else
        call.resolve(["ok": false, "enabled": false, "keepAlive": false, "error": "DockKit not in this SDK"])
        #endif
    }
}

/// Opt-in camera keep-alive: a front-camera capture session with no preview,
/// no recording and no frame processing. Only exists so DockKit has an
/// app-owned camera session to track from, if it needs one.
final class CameraKeepAlive {
    static let shared = CameraKeepAlive()
    private let queue = DispatchQueue(label: "mendcraft.camera.keepalive")
    private var session: AVCaptureSession?

    var isRunning: Bool { queue.sync { session?.isRunning ?? false } }

    func start(completion: @escaping (Bool, String?) -> Void) {
        let begin = { [weak self] in
            guard let self else { completion(false, "keep-alive gone"); return }
            self.queue.async {
                if let s = self.session, s.isRunning { completion(true, nil); return }
                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
                      let input = try? AVCaptureDeviceInput(device: device) else {
                    completion(false, "No front camera"); return
                }
                let s = AVCaptureSession()
                s.beginConfiguration()
                s.sessionPreset = .medium
                guard s.canAddInput(input) else { s.commitConfiguration(); completion(false, "Camera busy"); return }
                s.addInput(input)
                let out = AVCaptureVideoDataOutput()
                out.alwaysDiscardsLateVideoFrames = true
                if s.canAddOutput(out) { s.addOutput(out) }
                s.commitConfiguration()
                s.startRunning()
                self.session = s
                completion(s.isRunning, s.isRunning ? nil : "Camera session did not start")
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: begin()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                if ok { begin() } else { completion(false, "Camera permission denied") }
            }
        default: completion(false, "Camera permission denied")
        }
    }

    func stop() {
        queue.async { [weak self] in
            self?.session?.stopRunning()
            self?.session = nil
        }
    }
}

#if canImport(DockKit)
@available(iOS 18.0, *)
actor DockWatcher {
    static let shared = DockWatcher()
    private var accessory: DockAccessory?
    private var started = false
    /// Last state the web layer asked for. nil = never asked: leave DockKit alone.
    private var wanted: Bool?
    private var keepAliveWanted = false
    private var movesInFlight = 0

    nonisolated func start() {
        Task { await self.watch() }
    }

    nonisolated static func systemTrackingEnabled() -> Bool {
        DockAccessoryManager.shared.isSystemTrackingEnabled
    }

    private func watch() async {
        if started { return }
        started = true
        do {
            for try await change in try DockAccessoryManager.shared.accessoryStateChanges {
                if change.state == .docked, let acc = change.accessory {
                    accessory = acc
                    // Fresh dock: re-apply the web layer's choice (if any).
                    if let wanted { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(wanted) }
                } else if change.state == .undocked {
                    accessory = nil
                }
            }
        } catch {
            started = false
        }
    }

    func isDocked() -> Bool { accessory != nil }

    func setWanted(_ enabled: Bool, keepAlive: Bool) async -> [String: Any] {
        wanted = enabled
        keepAliveWanted = enabled && keepAlive
        var errText: String?
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(enabled)
        } catch {
            errText = error.localizedDescription
        }
        let keepAliveErr = await applyKeepAlive()
        var r: [String: Any] = [
            "ok": errText == nil,
            "enabled": DockAccessoryManager.shared.isSystemTrackingEnabled,
            "keepAlive": CameraKeepAlive.shared.isRunning,
        ]
        if let msg = errText ?? keepAliveErr { r["error"] = msg }
        return r
    }

    func restoreWanted() async -> [String: Any] {
        var errText: String?
        if let wanted {
            do { try await DockAccessoryManager.shared.setSystemTrackingEnabled(wanted) } catch { errText = error.localizedDescription }
        }
        var r: [String: Any] = ["ok": errText == nil, "enabled": DockAccessoryManager.shared.isSystemTrackingEnabled]
        if let errText { r["error"] = errText }
        return r
    }

    func didBecomeActive() async {
        if let wanted { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(wanted) }
        _ = await applyKeepAlive()
    }

    func didEnterBackground() async {
        CameraKeepAlive.shared.stop()
        try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true)
    }

    /// Start/stop the opt-in keep-alive to match keepAliveWanted. Returns an error text.
    private func applyKeepAlive() async -> String? {
        if !keepAliveWanted { CameraKeepAlive.shared.stop(); return nil }
        return await withCheckedContinuation { cont in
            CameraKeepAlive.shared.start { ok, err in cont.resume(returning: ok ? nil : (err ?? "Camera keep-alive failed")) }
        }
    }

    func aim(yaw: Double, pitch: Double, seconds: Double) async throws -> Bool {
        guard let acc = accessory else { return false }
        movesInFlight += 1
        defer { movesInFlight -= 1 }
        // Off for this move only; the restore below puts the web layer's
        // choice back once the last overlapping move has finished.
        try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
        let target = Vector3D(x: pitch, y: yaw, z: 0)
        let ms = Int64(max(0.3, min(4.0, seconds)) * 1000)
        do {
            _ = try await acc.setOrientation(target, duration: .milliseconds(ms), relative: true)
        } catch {
            if movesInFlight == 1, wanted == true { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true) }
            throw error
        }
        if movesInFlight == 1, wanted == true { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true) }
        return true
    }
}
#endif
