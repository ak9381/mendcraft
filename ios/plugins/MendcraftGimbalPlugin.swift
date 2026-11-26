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
// Body language: cue({kind}) plays DockAccessory.animate(motion:) — .yes (nod),
// .no (shake), .wakeup — the web layer calls it on Approve / refusal / pairing.
// System tracking is paused for the animation and the web layer's `wanted`
// state is restored after (same as aim()). ok:true only once DockKit accepted
// the animation and it finished (or ran its course) within 3 s; otherwise
// {ok:false, reason}. Undocked → {ok:false, reason:"No DockKit stand docked"}.
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
        CAPPluginMethod(name: "cue", returnType: CAPPluginReturnPromise),
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

    /// Body language: kind = "yes" | "no" | "wakeup" → DockAccessory.animate(motion:)
    /// ("wakeup" then adds a small ±6° left-right wiggle, inside the same 3 s).
    /// Resolves {ok, reason}; ok only after DockKit ran it (3 s timeout).
    @objc func cue(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? ""
        guard ["yes", "no", "wakeup"].contains(kind) else {
            call.resolve(["ok": false, "reason": "Unknown cue"])
            return
        }
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let r = await DockWatcher.shared.cue(kind)
                call.resolve(r)
            }
            return
        }
        call.resolve(["ok": false, "reason": "Gimbal animations need iOS 18"])
        #else
        call.resolve(["ok": false, "reason": "DockKit not in this SDK"])
        #endif
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
    private var observers: [NSObjectProtocol] = []
    /// Last interruption reason (e.g. the WebView camera or a call took the
    /// front camera). Surfaced as the keep-alive error text.
    private(set) var lastInterruption: String?

    var isRunning: Bool { queue.sync { (session?.isRunning ?? false) && !(session?.isInterrupted ?? false) } }

    /// Must run on `queue`.
    private func teardown() {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        session?.stopRunning()
        session = nil
    }

    func start(completion: @escaping (Bool, String?) -> Void) {
        let begin = { [weak self] in
            guard let self else { completion(false, "keep-alive gone"); return }
            self.queue.async {
                if let s = self.session, s.isRunning, !s.isInterrupted { completion(true, nil); return }
                // Never two sessions: stop any previous (stopped/interrupted) one first.
                self.teardown()
                self.lastInterruption = nil
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
                // Watch interruptions: another capture (likely the WebView's
                // getUserMedia) taking the front camera. We yield — stop — so
                // the two never fight; the web layer sees keepAlive:false.
                let nc = NotificationCenter.default
                self.observers.append(nc.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: s, queue: nil) { note in
                    let raw = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue
                    let why: String
                    switch raw.flatMap({ AVCaptureSession.InterruptionReason(rawValue: $0) }) {
                    case .videoDeviceInUseByAnotherClient?: why = "Keep-alive stopped: the camera is in use by another capture"
                    case .videoDeviceNotAvailableInBackground?: why = "Keep-alive stopped: app in background"
                    default: why = "Keep-alive stopped: camera interrupted"
                    }
                    // Singleton: a strong capture is fine (no cycle that matters).
                    self.queue.async { self.lastInterruption = why; self.teardown() }
                })
                self.observers.append(nc.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: s, queue: nil) { _ in
                    self.queue.async { self.lastInterruption = nil }
                })
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
        queue.async { [weak self] in self?.teardown() }
    }
}

/// The animation's Progress, cancellable from the timeout. A Progress that
/// arrives after cancel() is cancelled on arrival.
final class ProgressBox: @unchecked Sendable {
    private let lock = NSLock()
    private var progress: Progress?
    private var cancelled = false
    func set(_ p: Progress) {
        lock.lock(); progress = p; let c = cancelled; lock.unlock()
        if c { p.cancel() }
    }
    func cancel() {
        lock.lock(); cancelled = true; let p = progress; lock.unlock()
        p?.cancel()
    }
    var isCancelled: Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled
    }
}

/// Resolves a continuation exactly once (result vs timeout race).
final class OnceGate: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
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
    /// System-tracking state captured when the FIRST overlapping move paused it
    /// (movesInFlight 0 → 1). Never re-read mid-move: by then it is our own
    /// "off". Restored (unless the web layer chose) when the last move ends.
    private var pausedFrom: Bool?

    /// Start one move (aim / cue). Call endMove() exactly once after it.
    private func beginMove() {
        if movesInFlight == 0 { pausedFrom = DockAccessoryManager.shared.isSystemTrackingEnabled }
        movesInFlight += 1
    }

    /// End one move; the last one out restores `wanted ?? pausedFrom`.
    private func endMove() async {
        movesInFlight = max(0, movesInFlight - 1)
        guard movesInFlight == 0 else { return }
        let restoreOn = wanted ?? pausedFrom ?? false
        pausedFrom = nil
        if restoreOn { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true) }
    }

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
        if let msg = errText ?? keepAliveErr ?? (keepAliveWanted ? CameraKeepAlive.shared.lastInterruption : nil) { r["error"] = msg }
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
        // Off for this move only; endMove() puts the web layer's choice (or
        // the pre-pause state) back once the last overlapping move finished.
        beginMove()
        let target = Vector3D(x: pitch, y: yaw, z: 0)
        let ms = Int64(max(0.3, min(4.0, seconds)) * 1000)
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
            // setOrientation returns a Progress when the move STARTS: wait for
            // it to finish (or its duration + a margin) before tracking is
            // restored and the web layer may send the next move.
            let progress = try await acc.setOrientation(target, duration: .milliseconds(ms), relative: true)
            await DockWatcher.waitForMove(progress, maxMs: ms + 400)
        } catch {
            await endMove()
            throw error
        }
        await endMove()
        return true
    }

    /// DockKit's built-in accessory animation. Tracking is paused for it and
    /// the web layer's choice restored afterwards (face-follow keeps working).
    func cue(_ kind: String) async -> [String: Any] {
        guard let acc = accessory else { return ["ok": false, "reason": "No DockKit stand docked"] }
        let motion: DockAccessory.Animation
        switch kind {
        case "yes": motion = .yes
        case "no": motion = .no
        case "wakeup": motion = .wakeup
        default: return ["ok": false, "reason": "Unknown cue"]
        }
        // Tracking paused for the animation; endMove() restores what the web
        // layer chose, or (never chose) what DockKit had before the first pause.
        beginMove()
        var result: [String: Any]
        // Holds the animation's Progress so a timeout can cancel it.
        let box = ProgressBox()
        // yes/no: 3 s in all. Wake-up: its own 4.5 s — the full animation
        // (up to 2.8 s) and then the ~1 s wiggle, never cut short mid-wiggle.
        let budgetMs: UInt64 = kind == "wakeup" ? 4500 : 3000
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
            // animate() returns a Progress; whole thing bounded by budgetMs.
            let outcome = try await DockWatcher.withTimeout(ms: budgetMs) {
                try await withTaskCancellationHandler {
                    let progress = try await acc.animate(motion: motion)
                    box.set(progress)
                    // Wait for the animation to really finish before the wiggle starts.
                    await DockWatcher.waitForMove(progress, maxMs: 2800)
                    if progress.isCancelled { return false }
                    if kind == "wakeup" { return try await DockWatcher.wiggle(acc, box: box) }
                    return true
                } onCancel: {
                    box.cancel()
                }
            }
            // Timed out: stop the animation before tracking is restored.
            if outcome == nil { box.cancel() }
            switch outcome {
            case .some(true): result = ["ok": true]
            case .some(false): result = ["ok": false, "reason": "The gimbal animation was cancelled"]
            case .none: result = ["ok": false, "reason": "The gimbal didn’t answer in \(budgetMs / 1000 == 3 ? "3" : "4.5") s"]
            }
        } catch {
            result = ["ok": false, "reason": error.localizedDescription]
        }
        await endMove()
        return result
    }

    /// Run `op`, giving up after `ms`: nil on timeout. Returns at the deadline
    /// even if DockKit never answers (the late result is dropped, the op cancelled).
    static func withTimeout<T: Sendable>(ms: UInt64, _ op: @escaping @Sendable () async throws -> T) async throws -> T? {
        let gate = OnceGate()
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<T?, Error>) in
            let work = Task {
                do {
                    let v = try await op()
                    if gate.claim() { cont.resume(returning: v) }
                } catch {
                    if gate.claim() { cont.resume(throwing: error) }
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: ms * 1_000_000)
                if gate.claim() { work.cancel(); cont.resume(returning: nil) }
            }
        }
    }

    /// After .wakeup, a small friendly "hello" shake: ±6° yaw, twice (relative
    /// moves, back to where it started), ~1 s in all. Tracking is already
    /// paused by the caller, which restores it afterwards. False if cancelled —
    /// and then a compensating move puts the stand back where it started, so
    /// it is never left ~6° off.
    static func wiggle(_ acc: DockAccessory, box: ProgressBox) async throws -> Bool {
        let step = 6.0 * Double.pi / 180.0
        var offset = 0.0 // net yaw moved so far (radians)
        for yaw in [step, -2 * step, 2 * step, -step] {
            if Task.isCancelled || box.isCancelled { await settle(acc, offset); return false }
            let p = try await acc.setOrientation(Vector3D(x: 0, y: yaw, z: 0), duration: .milliseconds(180), relative: true)
            box.set(p)
            await DockWatcher.waitForMove(p, maxMs: 260)
            // A cancelled step moved only part of the way.
            offset += yaw * (p.isFinished && !p.isCancelled ? 1.0 : min(1.0, max(0.0, p.fractionCompleted)))
            if p.isCancelled || Task.isCancelled { await settle(acc, offset); return false }
        }
        return true
    }

    /// Undo a cut-short wiggle: move back by `offset`, in a detached task so
    /// the cancellation that stopped the wiggle doesn't stop this too.
    private static func settle(_ acc: DockAccessory, _ offset: Double) async {
        if abs(offset) < 0.001 { return }
        await Task.detached {
            if let p = try? await acc.setOrientation(Vector3D(x: 0, y: -offset, z: 0), duration: .milliseconds(200), relative: true) {
                await DockWatcher.waitForMove(p, maxMs: 400)
            }
        }.value
    }

    /// Poll the move's Progress until it finishes (or is cancelled), at most
    /// `maxMs`; returns early if the calling task is cancelled.
    static func waitForMove(_ progress: Progress, maxMs: Int64) async {
        let start = Date()
        while !progress.isFinished && !progress.isCancelled {
            if Task.isCancelled { break }
            if Date().timeIntervalSince(start) * 1000 >= Double(maxMs) { break }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
    }
}
#endif
