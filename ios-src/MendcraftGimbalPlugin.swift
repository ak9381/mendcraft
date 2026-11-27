// MendcraftGimbal — OPTIONAL Apple DockKit control for a DockKit stand
// (Insta360 Flow 2 Pro). The add-a-device flow never needs it.
//
// Modes are chosen by the web layer (src/canvas/gimbalCanvas.ts):
//   face  — DockKit's OWN subject tracking (setSystemTrackingEnabled(true)).
//           We do not aim; the stand follows the person it sees.
//   hands — system tracking off; startHandTracking() runs the NATIVE hand
//           tracker (HandTracker: app-process front camera + Vision hand
//           pose → DockAccessory.track(_:cameraInformation:)). The web layer
//           turns its WKWebView camera off first: DockKit system tracking
//           follows the WebKit process's capture (seen live — the face kept
//           being followed) and our setSystemTrackingEnabled(false) does not
//           reach it. Older builds / iOS: the web layer's yaw-only aim().
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
// Body language: cue({kind}) — "yes" (nod) and "wakeup" play
// DockAccessory.animate(motion:) .yes / .wakeup. "no" (shake) is OUR OWN
// deterministic yaw shake (relative ±11° swings, ~1.2 s): DockKit's .no ran
// without any visible movement on the Flow 2 Pro. System tracking is paused
// for the cue and the web layer's `wanted` state is restored after (same as
// aim()). ok:true only once every move really completed within the budget
// (3 s); a cut-short shake moves back to where it started. Otherwise
// {ok:false, reason}. Undocked → {ok:false, reason:"No DockKit stand docked"}.
//
// Keeping tracking OFF (hands / hold): DockKit can turn system tracking back
// on behind our back (a capture session starting — the WebView camera
// included —, a redock, the stand's own button). While the web layer wants it
// off, a guard re-reads isSystemTrackingEnabled every 0.4 s and re-asserts
// "off", also on every in-process capture-session start and whenever DockKit
// reports tracked subjects. isAvailable() reports the diagnostics:
// systemTracking (read back), dockSubjects (subjects DockKit tracked in the
// last 1.5 s) and reasserts (how often we had to turn it off again).
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
import Vision
import os
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
        CAPPluginMethod(name: "startHandTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopHandTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "handTrackingStatus", returnType: CAPPluginReturnPromise),
    ]

    private var fgObserver: NSObjectProtocol?
    private var bgObserver: NSObjectProtocol?

    public override func load() {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            DockWatcher.shared.start()
            // running / aiming flips → the web layer (tile + announce honesty).
            HandTracker.shared.onChange = { [weak self] running, aiming in
                self?.notifyListeners("handTracking", data: ["running": running, "aimingAtHands": aiming])
            }
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
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            HandTracker.shared.onChange = nil
            Task { _ = await DockWatcher.shared.stopHands("plugin teardown") }
        }
        #endif
    }

    /// Follow my hands natively (see HandTracker): system tracking off, the
    /// app-process front camera + Vision hand pose drive DockAccessory.track().
    /// The web layer must have stopped its own camera first. Options (test):
    /// corrected (default true), mirrored (default false).
    /// Resolves {ok, running, enabled, error?}.
    @objc func startHandTracking(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            var cfg = HandTracker.Config()
            cfg.corrected = call.getBool("corrected") ?? true
            cfg.mirrored = call.getBool("mirrored") ?? false
            Task {
                let r = await DockWatcher.shared.startHands(cfg)
                call.resolve(r)
            }
            return
        }
        call.resolve(["ok": false, "running": false, "error": "Native hand following needs iOS 18"])
        #else
        call.resolve(["ok": false, "running": false, "error": "DockKit not in this SDK"])
        #endif
    }

    @objc func stopHandTracking(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            let reason = call.getString("reason") ?? "web layer"
            Task {
                let r = await DockWatcher.shared.stopHands(reason)
                call.resolve(r)
            }
            return
        }
        #endif
        call.resolve(["ok": true, "running": false])
    }

    /// {handTracking, aimingAtHands, lastHandMs?, handObservations, handTrackFailures, handError?}.
    @objc func handTrackingStatus(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            call.resolve(HandTracker.shared.status())
            return
        }
        #endif
        call.resolve(["handTracking": false, "aimingAtHands": false])
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let docked = await DockWatcher.shared.isDocked()
                let d = await DockWatcher.shared.diagnostics()
                var r: [String: Any] = [
                    "available": docked,
                    "reason": docked ? "" : "No DockKit stand docked",
                    "systemTracking": DockWatcher.systemTrackingEnabled(),
                ]
                for (k, v) in d { r[k] = v }
                call.resolve(r)
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
                    let tracking = DockWatcher.systemTrackingEnabled()
                    call.resolve(ok ? ["ok": true, "systemTracking": tracking] : ["ok": false, "error": "No DockKit stand docked", "systemTracking": tracking])
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

    /// Body language: kind = "yes" | "wakeup" → DockAccessory.animate(motion:)
    /// ("wakeup" then adds a small ±6° left-right wiggle); "no" → our own yaw
    /// shake. Resolves {ok, reason}; ok only after every move completed (3 s).
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
/// "Follow my hands", done natively. DockKit system tracking applies to the
/// WebKit process's capture (the WKWebView getUserMedia camera) and our
/// in-process setSystemTrackingEnabled(false) does not reach it — seen live:
/// the stand kept following her face. So in hands mode the web layer turns
/// its camera OFF and this app-process tracker owns the front camera:
///   AVCaptureSession (front, 640×480, ≤15 fps) → Vision
///   VNDetectHumanHandPoseRequest → the most confident / largest hand's box
///   (from its joints, padded, lightly smoothed) → DockAccessory.track(_:
///   cameraInformation:) with ONE .object Observation.
/// No hand → no observation is sent (the stand holds still). Never the face.
/// Frames are rotated upright (RotationCoordinator) and not mirrored;
/// CameraInformation.orientation = .corrected. Observation rects are
/// normalised with the origin TOP-left.
/// Unified log: subsystem "app.mendcraft", category "gimbal-hands", "[hands] …".
@available(iOS 18.0, *)
final class HandTracker: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    static let shared = HandTracker()

    struct Config: Sendable {
        /// true (default): buffers rotated upright, orientation .corrected.
        /// false (test option): raw sensor buffers + the phone's
        /// CameraOrientation + the camera intrinsics.
        var corrected = true
        /// Mirror the rect horizontally (test option for the live check).
        var mirrored = false
    }

    /// What status() / isRunning read: written on `queue`, read anywhere
    /// under `snapLock` (never a queue.sync from the actor).
    private struct Snapshot {
        var running = false
        var lastSentAt: CFTimeInterval = 0
        var sent = 0
        var failures = 0
        var lastError: String?
    }
    private let snapLock = NSLock()
    private var snap = Snapshot()
    /// Bumped by every stop(): a start() that was asked for before it must
    /// not bring the session back (read/written under snapLock).
    private var wantGen = 0

    /// Fired on the tracker queue when running / aiming flips.
    var onChange: (@Sendable (_ running: Bool, _ aiming: Bool) -> Void)?

    private let log = Logger(subsystem: "app.mendcraft", category: "gimbal-hands")
    private let queue = DispatchQueue(label: "mendcraft.gimbal.hands", qos: .userInitiated)
    // Everything below is touched on `queue` only.
    private var session: AVCaptureSession?
    private var device: AVCaptureDevice?
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var accessory: DockAccessory?
    private var config = Config()
    private var observers: [NSObjectProtocol] = []
    private let handRequest: VNDetectHumanHandPoseRequest = {
        let r = VNDetectHumanHandPoseRequest()
        r.maximumHandCount = 2
        return r
    }()
    private var lastProcessed: CFTimeInterval = 0
    private var smoothed: CGRect?
    private var lastHandSeen: CFTimeInterval = 0
    private var lastSentAt: CFTimeInterval = 0
    private var trackInFlight = false
    private var paused = false
    private var sent = 0
    private var failures = 0
    private var lastLogAt: CFTimeInterval = 0
    private var lastError: String?
    private var reportedRunning = false
    private var reportedAiming = false
    private var generation = 0
    /// Frames per second asked of the sensor (15; 8 when the phone runs hot).
    private var fps: Int32 = 15
    /// One automatic restart after a runtime error (e.g. media services reset).
    private var retriedAfterError = false

    /// A hand observation sent this recently counts as "aiming at hands".
    static let aimingWindow: CFTimeInterval = 0.5

    private func now() -> CFTimeInterval { CACurrentMediaTime() }

    /// For isAvailable / handTrackingStatus (snapshot, no queue hop).
    func status() -> [String: Any] {
        snapLock.lock(); let s = snap; snapLock.unlock()
        let age = s.lastSentAt > 0 ? Int((now() - s.lastSentAt) * 1000) : -1
        var r: [String: Any] = [
            "handTracking": s.running,
            "aimingAtHands": s.running && age >= 0 && Double(age) < HandTracker.aimingWindow * 1000,
            "handObservations": s.sent,
            "handTrackFailures": s.failures,
        ]
        if age >= 0 { r["lastHandMs"] = age }
        if let e = s.lastError { r["handError"] = e }
        return r
    }

    var isRunning: Bool { snapLock.lock(); defer { snapLock.unlock() }; return snap.running }
    private func isRunningLocked() -> Bool {
        guard let s = session else { return false }
        return s.isRunning && !s.isInterrupted
    }
    /// Publish the queue's state to the snapshot. On `queue`.
    private func publish() {
        let v = Snapshot(running: isRunningLocked(), lastSentAt: lastSentAt, sent: sent, failures: failures, lastError: lastError)
        snapLock.lock(); snap = v; snapLock.unlock()
    }
    private func currentWant() -> Int { snapLock.lock(); defer { snapLock.unlock() }; return wantGen }

    /// Pause track() calls while a nod / shake plays.
    func setPaused(_ p: Bool) { queue.async { self.paused = p } }

    func start(_ acc: DockAccessory, config: Config) async -> (ok: Bool, error: String?) {
        let token = currentWant()
        let denied = "Camera permission denied — allow Mendcraft in Settings › Camera"
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: break
        case .notDetermined:
            if !(await AVCaptureDevice.requestAccess(for: .video)) { return (false, denied) }
        default:
            return (false, denied)
        }
        return await withCheckedContinuation { cont in
            queue.async {
                // stop() came after this start was asked for: stay stopped.
                guard token == self.currentWant() else { cont.resume(returning: (false, "superseded")); return }
                self.retriedAfterError = false
                cont.resume(returning: self.startLocked(acc, config: config))
            }
        }
    }

    private func startLocked(_ acc: DockAccessory, config: Config) -> (ok: Bool, error: String?) {
        accessory = acc
        // Running, or still waiting for WebKit to let go of the lens
        // (interrupted): keep that session — the caller waits it out.
        if let s = session, s.isRunning || s.isInterrupted,
           config.corrected == self.config.corrected, config.mirrored == self.config.mirrored {
            return (true, nil)
        }
        teardownLocked(reason: nil)
        self.config = config
        lastError = nil
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
            lastError = "No front camera"; publish(); return (false, lastError)
        }
        let input: AVCaptureDeviceInput
        do { input = try AVCaptureDeviceInput(device: dev) } catch {
            lastError = "Front camera: \(error.localizedDescription)"; publish(); return (false, lastError)
        }
        let s = AVCaptureSession()
        s.beginConfiguration()
        // Thermal / battery: a small frame (Vision's hand model needs little).
        if s.canSetSessionPreset(.vga640x480) { s.sessionPreset = .vga640x480 } else { s.sessionPreset = .low }
        guard s.canAddInput(input) else {
            s.commitConfiguration()
            lastError = "The front camera is busy"; publish(); return (false, lastError)
        }
        s.addInput(input)
        let out = AVCaptureVideoDataOutput()
        out.alwaysDiscardsLateVideoFrames = true
        out.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        out.setSampleBufferDelegate(self, queue: queue)
        guard s.canAddOutput(out) else {
            s.commitConfiguration()
            lastError = "Camera output unavailable"; publish(); return (false, lastError)
        }
        s.addOutput(out)
        let rc = AVCaptureDevice.RotationCoordinator(device: dev, previewLayer: nil)
        if let c = out.connection(with: .video) {
            if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = false }
            if config.corrected {
                let a = rc.videoRotationAngleForHorizonLevelCapture
                if c.isVideoRotationAngleSupported(a) { c.videoRotationAngle = a }
            } else if c.isCameraIntrinsicMatrixDeliverySupported {
                c.isCameraIntrinsicMatrixDeliveryEnabled = true
            }
        }
        s.commitConfiguration()
        // ≤15 fps at the sensor (8 when hot): no wasted frames.
        applyFrameRate(dev, HandTracker.fpsForThermal())
        generation += 1
        let gen = generation
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: s, queue: nil) { [weak self] note in
            let raw = (note.userInfo?[AVCaptureSessionInterruptionReasonKey] as? NSNumber)?.intValue
            let why: String
            switch raw.flatMap({ AVCaptureSession.InterruptionReason(rawValue: $0) }) {
            case .videoDeviceInUseByAnotherClient?: why = "the camera is in use by another capture"
            case .videoDeviceNotAvailableInBackground?: why = "app in background"
            case .videoDeviceNotAvailableDueToSystemPressure?: why = "system pressure (thermal)"
            default: why = "camera interrupted"
            }
            self?.queue.async {
                guard let self, self.generation == gen else { return }
                self.lastError = "Hand camera paused: \(why)"
                self.log.notice("[hands] session interrupted: \(why, privacy: .public)")
                self.report()
            }
        })
        observers.append(nc.addObserver(forName: AVCaptureSession.interruptionEndedNotification, object: s, queue: nil) { [weak self] _ in
            self?.queue.async {
                guard let self, self.generation == gen else { return }
                self.lastError = nil
                self.log.notice("[hands] session interruption ended")
                self.report()
            }
        })
        observers.append(nc.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: s, queue: nil) { [weak self] note in
            let err = (note.userInfo?[AVCaptureSessionErrorKey] as? NSError)?.localizedDescription ?? "unknown"
            self?.queue.async {
                guard let self, self.generation == gen else { return }
                self.log.error("[hands] session runtime error: \(err, privacy: .public)")
                self.teardownLocked(reason: "runtime error")
                // Once per start: build the session again (e.g. media services were reset).
                if !self.retriedAfterError, let acc = self.accessory {
                    self.retriedAfterError = true
                    let r = self.startLocked(acc, config: self.config)
                    self.log.notice("[hands] restart after runtime error: \(r.ok ? "ok" : (r.error ?? "failed"), privacy: .public)")
                    if r.ok { self.report(); return }
                }
                self.lastError = "Hand camera error: \(err)"
                self.report()
            }
        })
        observers.append(nc.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async {
                guard let self, self.generation == gen, let dev = self.device else { return }
                self.applyFrameRate(dev, HandTracker.fpsForThermal())
            }
        })
        session = s
        device = dev
        rotation = rc
        smoothed = nil
        lastSentAt = 0
        lastHandSeen = 0
        trackInFlight = false
        s.startRunning() // on our own queue, never the main thread
        // Interrupted (WebKit still holds the lens) is not a failure: keep it.
        guard s.isRunning || s.isInterrupted else {
            teardownLocked(reason: nil)
            lastError = "The hand camera did not start"
            log.error("[hands] start failed: session did not run")
            publish()
            return (false, lastError)
        }
        let orient = config.corrected ? "corrected" : "device"
        log.notice("[hands] start: front camera \(s.sessionPreset.rawValue, privacy: .public) @\(self.fps, privacy: .public)fps, orient=\(orient, privacy: .public), mirrored=\(config.mirrored, privacy: .public), interrupted=\(s.isInterrupted, privacy: .public)")
        report()
        return (true, nil)
    }

    static func fpsForThermal() -> Int32 {
        let t = ProcessInfo.processInfo.thermalState
        return (t == .serious || t == .critical) ? 8 : 15
    }

    /// Sensor frame rate (both min and max frame duration). On `queue`.
    private func applyFrameRate(_ dev: AVCaptureDevice, _ want: Int32) {
        guard (try? dev.lockForConfiguration()) != nil else { return }
        defer { dev.unlockForConfiguration() }
        let f = Double(want)
        guard dev.activeFormat.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= f && f <= $0.maxFrameRate }) else { return }
        dev.activeVideoMinFrameDuration = CMTime(value: 1, timescale: want)
        dev.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: want)
        if want != fps { log.notice("[hands] frame rate → \(want, privacy: .public) fps (thermal)") }
        fps = want
    }

    func stop(reason: String) {
        snapLock.lock(); wantGen += 1; snapLock.unlock()
        queue.async { self.teardownLocked(reason: reason); self.report() }
    }

    /// Must run on `queue`.
    private func teardownLocked(reason: String?) {
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        if let s = session {
            s.stopRunning()
            if let reason { log.notice("[hands] stop: \(reason, privacy: .public) (sent \(self.sent, privacy: .public) observations)") }
        }
        session = nil
        device = nil
        rotation = nil
        smoothed = nil
        lastSentAt = 0
        generation += 1
        publish()
    }

    /// Publish the snapshot; fire onChange when running / aiming flipped. On `queue`.
    private func report() {
        publish()
        let running = isRunningLocked()
        let aiming = running && lastSentAt > 0 && now() - lastSentAt < HandTracker.aimingWindow
        if running == reportedRunning && aiming == reportedAiming { return }
        reportedRunning = running
        reportedAiming = aiming
        onChange?(running, aiming)
    }

    // MARK: frames (on `queue`)

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard session != nil, let acc = accessory else { return }
        let t = now()
        // At most the sensor rate (15 fps; 8 when the phone runs hot).
        let interval: CFTimeInterval = 1.0 / Double(fps)
        if t - lastProcessed < interval * 0.9 { report(); return }
        lastProcessed = t
        // Keep the frame upright as the phone turns (corrected mode).
        if config.corrected, let rc = rotation {
            let a = rc.videoRotationAngleForHorizonLevelCapture
            if connection.videoRotationAngle != a, connection.isVideoRotationAngleSupported(a) { connection.videoRotationAngle = a }
        }
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up, options: [:])
        var best: (rect: CGRect, score: Double)?
        do {
            try handler.perform([handRequest])
            for obs in handRequest.results ?? [] {
                guard let pts = try? obs.recognizedPoints(.all) else { continue }
                let good = pts.values.filter { $0.confidence > 0.3 }
                if good.count < 6 { continue }
                var minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0
                var conf = 0.0
                for p in good {
                    minX = min(minX, p.location.x); maxX = max(maxX, p.location.x)
                    minY = min(minY, p.location.y); maxY = max(maxY, p.location.y)
                    conf += Double(p.confidence)
                }
                conf /= Double(good.count)
                // Vision: normalised, origin BOTTOM-left → DockKit: origin TOP-left.
                var r = CGRect(x: minX, y: 1 - maxY, width: maxX - minX, height: maxY - minY)
                // Joints hug the skeleton: pad to the whole hand (20 % a side, ≥ 2 % of the frame).
                let padX = max(r.width * 0.2, 0.02), padY = max(r.height * 0.2, 0.02)
                r = r.insetBy(dx: -padX, dy: -padY).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
                if r.isNull || r.width <= 0 || r.height <= 0 { continue }
                if config.mirrored { r.origin.x = 1 - r.maxX }
                // Most confident × largest; the hand we already follow wins ties.
                var score = conf * Double(obs.confidence) * Double(r.width * r.height).squareRoot()
                if let prev = smoothed, prev.intersects(r) { score *= 1.5 }
                if score > (best?.score ?? -1) { best = (r, score) }
            }
        } catch {
            noteFailure("Vision: \(error.localizedDescription)")
        }
        guard let hand = best?.rect else {
            // No hand: send nothing — the stand holds still. Drop the smoothing after 0.5 s.
            if smoothed != nil && t - lastHandSeen > HandTracker.aimingWindow {
                smoothed = nil
                log.notice("[hands] no hand — holding still (no observation sent)")
            }
            report()
            return
        }
        lastHandSeen = t
        let k = 0.5 // light smoothing
        let s: CGRect
        if let p = smoothed {
            s = CGRect(x: p.minX + (hand.minX - p.minX) * k, y: p.minY + (hand.minY - p.minY) * k,
                       width: p.width + (hand.width - p.width) * k, height: p.height + (hand.height - p.height) * k)
        } else {
            s = hand
        }
        smoothed = s
        if paused || trackInFlight { report(); return }
        let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)
        var intrinsics: matrix_float3x3?
        if !config.corrected,
           let data = CMGetAttachment(sampleBuffer, key: kCMSampleBufferAttachmentKey_CameraIntrinsicMatrix, attachmentModeOut: nil) as? Data,
           data.count == MemoryLayout<matrix_float3x3>.size {
            intrinsics = data.withUnsafeBytes { $0.load(as: matrix_float3x3.self) }
        }
        let info = DockAccessory.CameraInformation(
            captureDevice: device?.deviceType ?? .builtInWideAngleCamera,
            cameraPosition: .front,
            orientation: config.corrected ? .corrected : HandTracker.cameraOrientation(rotation),
            cameraIntrinsics: intrinsics,
            referenceDimensions: CGSize(width: w, height: h)
        )
        let obs = DockAccessory.Observation(identifier: 1, type: .object, rect: s)
        trackInFlight = true
        let gen = generation
        Task { [weak self] in
            var err: String?
            do { try await acc.track([obs], cameraInformation: info) } catch { err = error.localizedDescription }
            self?.queue.async {
                guard let self else { return }
                self.trackInFlight = false
                guard self.generation == gen else { return }
                if let err {
                    self.noteFailure("track() failed: \(err)")
                } else {
                    self.sent += 1
                    self.lastSentAt = self.now()
                    self.lastError = nil
                    if self.now() - self.lastLogAt > 2 {
                        self.lastLogAt = self.now()
                        let rect = String(format: "%.2f,%.2f,%.2f,%.2f", s.minX, s.minY, s.width, s.height)
                        self.log.notice("[hands] track hand rect=(\(rect, privacy: .public)) ref=\(w, privacy: .public)x\(h, privacy: .public) sent=\(self.sent, privacy: .public)")
                    }
                }
                self.report()
            }
        }
    }

    private func noteFailure(_ text: String) {
        failures += 1
        lastError = text
        if now() - lastLogAt > 2 {
            lastLogAt = now()
            log.error("[hands] \(text, privacy: .public) (failures \(self.failures, privacy: .public))")
        }
    }

    /// Raw-buffer test mode: the phone's orientation from the rotation
    /// coordinator (90° = portrait for the front camera).
    static func cameraOrientation(_ rc: AVCaptureDevice.RotationCoordinator?) -> DockAccessory.CameraOrientation {
        guard let a = rc?.videoRotationAngleForHorizonLevelCapture else { return .portrait }
        switch Int(a.rounded()) % 360 {
        case 90: return .portrait
        case 270: return .portraitUpsideDown
        case 0: return .landscapeLeft
        case 180: return .landscapeRight
        default: return .portrait
        }
    }
}

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
    /// App in the foreground (the guard runs only then; background = DockKit's).
    private var appActive = true
    /// Re-asserts "tracking off" while the web layer wants it off.
    private var guardTask: Task<Void, Never>?
    /// Watches DockKit's tracked subjects (diagnostic + re-assert trigger).
    private var trackingTask: Task<Void, Never>?
    private var captureObserver: NSObjectProtocol?
    /// How often we found system tracking back on and turned it off again.
    private var reasserts = 0
    private var lastSubjectsAt: Date?
    private var lastSubjectCount = 0
    private var lastForcedAt = Date.distantPast
    /// Bumped by every setWanted(): an enforceOff() that awaited across a
    /// web-layer choice must not leave its "off" behind.
    private var trackingGen = 0
    /// The web layer chose "follow my hands" (native tracker). Survives
    /// background / undock; the tracker itself runs only while docked + active.
    private var handsWanted = false
    private var handsConfig = HandTracker.Config()
    /// Bumped by every hands start / stop / Follow me: a start that awaited
    /// across one of them gives up.
    private var handsGen = 0

    /// Start one move (aim / cue). Call endMove() exactly once after it.
    private func beginMove() {
        if movesInFlight == 0 { pausedFrom = DockAccessoryManager.shared.isSystemTrackingEnabled }
        movesInFlight += 1
        HandTracker.shared.setPaused(true)
    }

    /// End one move; the last one out restores `wanted ?? pausedFrom`.
    private func endMove() async {
        movesInFlight = max(0, movesInFlight - 1)
        guard movesInFlight == 0 else { return }
        HandTracker.shared.setPaused(false)
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
        if captureObserver == nil {
            // An in-process capture session starting (e.g. the keep-alive) can
            // flip DockKit tracking back on: re-assert "off" right after.
            captureObserver = NotificationCenter.default.addObserver(
                forName: AVCaptureSession.didStartRunningNotification, object: nil, queue: nil
            ) { _ in
                Task { await DockWatcher.shared.enforceOff(force: true) }
            }
        }
        do {
            for try await change in try DockAccessoryManager.shared.accessoryStateChanges {
                if change.state == .docked, let acc = change.accessory {
                    accessory = acc
                    watchTracking(acc)
                    updateGuard()
                    // Fresh dock: re-apply the web layer's choice (if any).
                    if let wanted { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(wanted) }
                    _ = await applyHands()
                } else if change.state == .undocked {
                    accessory = nil
                    updateGuard()
                    HandTracker.shared.stop(reason: "undocked")
                    trackingTask?.cancel(); trackingTask = nil
                    lastSubjectsAt = nil; lastSubjectCount = 0
                }
            }
        } catch {
            started = false
        }
    }

    func isDocked() -> Bool { accessory != nil }

    /// Diagnostics for the web layer (rides isAvailable).
    func diagnostics() -> [String: Any] {
        let recent = lastSubjectsAt.map { Date().timeIntervalSince($0) < 1.5 } ?? false
        var d: [String: Any] = [
            "dockSubjects": recent ? lastSubjectCount : 0,
            "reasserts": reasserts,
        ]
        if let wanted { d["wantedTracking"] = wanted }
        d["handsWanted"] = handsWanted
        for (k, v) in HandTracker.shared.status() { d[k] = v }
        return d
    }

    /// DockKit's own view of who it tracks. While we want tracking OFF, a
    /// tracked subject means DockKit is following someone anyway: re-assert.
    private func watchTracking(_ acc: DockAccessory) {
        trackingTask?.cancel()
        trackingTask = Task { [weak self] in
            guard let states = try? acc.trackingStates else { return }
            for await state in states {
                if Task.isCancelled { break }
                await self?.noteTracking(state.trackedSubjects.count)
            }
        }
    }

    private func noteTracking(_ count: Int) async {
        lastSubjectCount = count
        if count > 0 {
            lastSubjectsAt = Date()
            // Our own hand observations show up as tracked subjects too.
            if wanted == false, movesInFlight == 0, !handsWanted { await enforceOff(force: true) }
        }
    }

    /// Keep system tracking off while the web layer wants it off. `force`
    /// sends "off" even when DockKit reads back off (at most once a second).
    func enforceOff(force: Bool = false) async {
        guard wanted == false, appActive, accessory != nil else { return }
        let on = DockAccessoryManager.shared.isSystemTrackingEnabled
        if !on && !force { return }
        if !on {
            if Date().timeIntervalSince(lastForcedAt) < 1.0 { return }
            lastForcedAt = Date()
        } else {
            reasserts += 1
        }
        let gen = trackingGen
        try? await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
        // The web layer chose meanwhile (actor reentrancy across the await):
        // our "off" may have landed after its "on" — put its choice back.
        if gen != trackingGen, wanted == true {
            try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true)
        }
    }

    /// Run the guard exactly while tracking is wanted off, the app is active
    /// and a stand is docked.
    private func updateGuard() {
        if wanted == false && appActive && accessory != nil {
            if guardTask == nil {
                guardTask = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 400_000_000)
                        if Task.isCancelled { break }
                        await self?.enforceOff()
                    }
                }
            }
        } else {
            guardTask?.cancel()
            guardTask = nil
        }
    }

    func setWanted(_ enabled: Bool, keepAlive: Bool) async -> [String: Any] {
        wanted = enabled
        trackingGen += 1
        // Follow me = DockKit's own tracking: the hand tracker stops.
        if enabled && handsWanted {
            handsWanted = false
            handsGen += 1
            HandTracker.shared.stop(reason: "follow me")
        }
        let gen = trackingGen
        keepAliveWanted = enabled && keepAlive
        updateGuard()
        // Follow me during a move (aim / cue): the move's endMove() would put
        // it back anyway — wait for it (≤ 3.5 s) so the read-back is true.
        if enabled {
            let until = Date().addingTimeInterval(3.5)
            while movesInFlight > 0 && Date() < until && gen == trackingGen {
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        var errText: String?
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(enabled)
            // A racing write (an enforceOff in flight) landed after ours: once more.
            if gen == trackingGen, wanted == enabled, DockAccessoryManager.shared.isSystemTrackingEnabled != enabled {
                try await DockAccessoryManager.shared.setSystemTrackingEnabled(enabled)
            }
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
        appActive = true
        if let wanted { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(wanted) }
        updateGuard()
        _ = await applyKeepAlive()
        _ = await applyHands()
    }

    func didEnterBackground() async {
        appActive = false
        updateGuard()
        CameraKeepAlive.shared.stop()
        HandTracker.shared.stop(reason: "background")
        try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true)
    }

    /// Start/stop the opt-in keep-alive to match keepAliveWanted. Returns an error text.
    private func applyKeepAlive() async -> String? {
        if !keepAliveWanted { CameraKeepAlive.shared.stop(); return nil }
        return await withCheckedContinuation { cont in
            CameraKeepAlive.shared.start { ok, err in cont.resume(returning: ok ? nil : (err ?? "Camera keep-alive failed")) }
        }
    }

    /// Follow my hands, natively: system tracking off (and guarded off), the
    /// keep-alive stopped, then the app-process hand tracker drives
    /// DockAccessory.track(). The web layer has already turned its own camera
    /// off. Resolves {ok, running, error?}.
    func startHands(_ config: HandTracker.Config) async -> [String: Any] {
        guard accessory != nil else { return ["ok": false, "running": false, "error": "No DockKit stand docked"] }
        wanted = false
        trackingGen += 1
        keepAliveWanted = false
        CameraKeepAlive.shared.stop()
        handsWanted = true
        handsGen += 1
        let myGen = handsGen
        handsConfig = config
        updateGuard()
        var errText: String?
        do { try await DockAccessoryManager.shared.setSystemTrackingEnabled(false) } catch { errText = error.localizedDescription }
        let superseded = { () -> Bool in myGen != self.handsGen || !self.handsWanted }
        if superseded() { return await bailHands() }
        if let e = await applyHands() {
            if superseded() { return await bailHands() }
            errText = e; handsWanted = false
        }
        // The WebKit process may still be letting go of the lens (our session
        // starts interrupted, "in use by another client"): give it 2 s.
        let until = Date().addingTimeInterval(2.0)
        while errText == nil && !HandTracker.shared.isRunning && Date() < until && !superseded() {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        if superseded() { return await bailHands() }
        let running = HandTracker.shared.isRunning
        if !running && errText == nil {
            errText = HandTracker.shared.status()["handError"] as? String ?? "The hand camera didn’t start"
            handsWanted = false
            HandTracker.shared.stop(reason: "start timed out")
        }
        var r: [String: Any] = ["ok": running, "running": running, "enabled": DockAccessoryManager.shared.isSystemTrackingEnabled]
        if let errText { r["error"] = errText }
        return r
    }

    /// A start overtaken by Follow me / stop: our "off" must not be the last word.
    private func bailHands() async -> [String: Any] {
        if wanted == true { try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true) }
        return ["ok": false, "running": false, "error": "superseded"]
    }

    func stopHands(_ reason: String) -> [String: Any] {
        handsWanted = false
        handsGen += 1
        HandTracker.shared.stop(reason: reason)
        return ["ok": true, "running": false]
    }

    /// Run the hand tracker exactly while hands are wanted, a stand is docked
    /// and the app is active. Returns an error text.
    private func applyHands() async -> String? {
        guard handsWanted, appActive, let acc = accessory else {
            if !handsWanted { HandTracker.shared.stop(reason: "not wanted") }
            return nil
        }
        let gen = handsGen
        let r = await HandTracker.shared.start(acc, config: handsConfig)
        // Follow me / stop / undock while the camera started (actor reentrancy).
        guard handsWanted, gen == handsGen, accessory != nil else {
            HandTracker.shared.stop(reason: "superseded")
            return "superseded"
        }
        // A capture session starting can flip DockKit tracking back on.
        if r.ok { await enforceOff(force: true) }
        return r.ok ? nil : (r.error ?? "The hand tracker didn’t start")
    }

    /// Set once the stand refuses a move with pitch in it (see aim()).
    private var pitchRefused = false

    func aim(yaw: Double, pitch: Double, seconds: Double) async throws -> Bool {
        guard let acc = accessory else { return false }
        // Off for this move only; endMove() puts the web layer's choice (or
        // the pre-pause state) back once the last overlapping move finished.
        beginMove()
        let ms = Int64(max(0.3, min(4.0, seconds)) * 1000)
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
            // setOrientation returns a Progress when the move STARTS: wait for
            // it to finish (or its duration + a margin) before tracking is
            // restored and the web layer may send the next move.
            // Some stands refuse any pitch in a relative move (DockKit error
            // 16, seen live on the Flow): retry yaw-only, and stop asking for
            // pitch for the rest of the session. Yaw-only moves (the shake) work.
            let usePitch = pitch != 0 && !pitchRefused
            let progress: Progress
            do {
                progress = try await acc.setOrientation(Vector3D(x: usePitch ? pitch : 0, y: yaw, z: 0), duration: .milliseconds(ms), relative: true)
            } catch where usePitch {
                pitchRefused = true
                progress = try await acc.setOrientation(Vector3D(x: 0, y: yaw, z: 0), duration: .milliseconds(ms), relative: true)
            }
            await DockWatcher.waitForMove(progress, maxMs: ms + 400)
        } catch {
            await endMove()
            throw error
        }
        await endMove()
        return true
    }

    /// Nod / wake-up: DockKit's built-in accessory animation. Shake: our own
    /// yaw shake (DockKit's .no did not visibly move the stand). Tracking is
    /// paused for it and the web layer's choice restored afterwards.
    func cue(_ kind: String) async -> [String: Any] {
        guard let acc = accessory else { return ["ok": false, "reason": "No DockKit stand docked"] }
        if kind == "no" { return await shakeCue(acc) }
        let motion: DockAccessory.Animation
        switch kind {
        case "yes": motion = .yes
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

    /// Shake "no": three brisk ±11° yaw swings, net zero, ~1.2 s, inside a 3 s
    /// budget. Tracking paused/restored exactly like the animations. ok only
    /// when every swing really completed; cut short → a compensating move
    /// puts the stand back where it started.
    private func shakeCue(_ acc: DockAccessory) async -> [String: Any] {
        beginMove()
        let deadline = Date().addingTimeInterval(3.0)
        var result: [String: Any]
        do {
            try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
            let r = await DockWatcher.shake(acc, deadline: deadline)
            result = r.ok ? ["ok": true] : ["ok": false, "reason": r.reason]
        } catch {
            result = ["ok": false, "reason": error.localizedDescription]
        }
        await endMove()
        return result
    }

    /// Relative yaw swings; returns ok only if every one finished. Never starts
    /// a swing that would not end (plus the way back) before `deadline`.
    static func shake(_ acc: DockAccessory, deadline: Date) async -> (ok: Bool, reason: String) {
        let s = 11.0 * Double.pi / 180.0
        // (yaw, ms): right, left, right, left, back to centre — net 0.
        let steps: [(Double, Int64)] = [(s, 170), (-2 * s, 260), (2 * s, 260), (-2 * s, 260), (s, 170)]
        var offset = 0.0
        let before = await yawPosition(acc)
        var turned: Double? // measured yaw after the first swing (radians), when DockKit reports it
        for (i, (yaw, ms)) in steps.enumerated() {
            // Room for this swing, its margin and a way back (~350 ms).
            if Date().addingTimeInterval(Double(ms + 200 + 350) / 1000).compare(deadline) == .orderedDescending {
                await settle(acc, offset, before: before)
                return (false, "The gimbal shake ran out of time")
            }
            let p: Progress
            do {
                p = try await acc.setOrientation(Vector3D(x: 0, y: yaw, z: 0), duration: .milliseconds(ms), relative: true)
            } catch {
                await settle(acc, offset, before: before)
                return (false, error.localizedDescription)
            }
            await waitForMove(p, maxMs: ms + 200)
            // Not reported finished yet: give it 100 ms more (no "almost done" shortcut).
            if !p.isFinished && !p.isCancelled { await waitForMove(p, maxMs: 100) }
            let done = !p.isCancelled && p.isFinished
            offset += yaw * (done ? 1.0 : min(1.0, max(0.0, p.fractionCompleted)))
            if i == 0, let b = before, let now = await yawPosition(acc) { turned = abs(now - b) }
            if !done {
                await settle(acc, offset, before: before)
                return (false, "The gimbal didn’t finish the shake")
            }
        }
        // Whatever the moves say, end where we started (measured pose).
        await closeDrift(acc, before: before)
        // DockKit reported positions and the stand never really turned: say so.
        if let t = turned, t < 3.0 * Double.pi / 180.0 {
            return (false, "The gimbal didn’t move for the shake")
        }
        return (true, "")
    }

    /// Current yaw from DockKit's motion states (nil if it doesn't answer in 250 ms).
    static func yawPosition(_ acc: DockAccessory) async -> Double? {
        let v: Double?? = try? await withTimeout(ms: 250) { () async -> Double? in
            guard let states = try? acc.motionStates else { return nil }
            for await m in states { return m.angularPositions.y }
            return nil
        }
        return v ?? nil
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
    /// With `before` (the measured yaw at the start), one closing move then
    /// fixes what the estimate missed.
    private static func settle(_ acc: DockAccessory, _ offset: Double, before: Double? = nil) async {
        if abs(offset) >= 0.001 {
            await Task.detached {
                if let p = try? await acc.setOrientation(Vector3D(x: 0, y: -offset, z: 0), duration: .milliseconds(200), relative: true) {
                    await DockWatcher.waitForMove(p, maxMs: 400)
                }
            }.value
        }
        await closeDrift(acc, before: before)
    }

    /// One closing relative move of (before − measured now) when the stand is
    /// more than 1° off where it started; clamped to ±15°. Detached so a
    /// cancellation doesn't stop it.
    private static func closeDrift(_ acc: DockAccessory, before: Double?) async {
        guard let b = before else { return }
        await Task.detached {
            guard let now = await DockWatcher.yawPosition(acc) else { return }
            let err = b - now
            if abs(err) <= Double.pi / 180.0 { return }
            let lim = 15.0 * Double.pi / 180.0
            let fix = max(-lim, min(lim, err))
            if let p = try? await acc.setOrientation(Vector3D(x: 0, y: fix, z: 0), duration: .milliseconds(200), relative: true) {
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
