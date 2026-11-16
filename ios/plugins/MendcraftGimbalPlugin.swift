// MendcraftGimbal — OPTIONAL Apple DockKit control for a DockKit stand
// (Insta360 Flow 2 Pro). The add-a-device flow never needs it: it works with a
// hand-held phone, a plain stand, the laptop camera, or no camera at all.
// When a DockKit stand IS docked, this turns the phone to face the device Nano
// found, with DockKit's own face tracking switched OFF (it would otherwise pull
// the camera back to her face).
//
// STATUS: written on Linux, NOT compiled or run yet (no Mac/Xcode on the build
// box, gimbal not delivered). Everything is behind `#if canImport(DockKit)` and
// `@available(iOS 18.0, *)` (manual motor control, setOrientation, is iOS 18+),
// so older SDKs/OSes compile and report available:false.
// Axis convention to verify on the device: DockKit Vector3D x = pitch (tilt),
// y = yaw (pan), z = roll; angles in radians; relative:true = from current pose.

import Foundation
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
    ]

    public override func load() {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) { DockWatcher.shared.start() }
        #endif
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                let docked = await DockWatcher.shared.isDocked()
                call.resolve(["available": docked, "reason": docked ? "" : "No DockKit stand docked"])
            }
            return
        }
        call.resolve(["available": false, "reason": "Manual gimbal control needs iOS 18"])
        #else
        call.resolve(["available": false, "reason": "DockKit not in this SDK"])
        #endif
    }

    /// Relative move. yaw = pan (+ right), pitch = tilt (+ up), radians.
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
                    call.resolve(["ok": ok])
                } catch {
                    call.resolve(["ok": false, "error": "\(error)"])
                }
            }
            return
        }
        #endif
        call.resolve(["ok": false])
    }

    @objc func release(_ call: CAPPluginCall) {
        #if canImport(DockKit)
        if #available(iOS 18.0, *) {
            Task {
                await DockWatcher.shared.release()
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }
}

#if canImport(DockKit)
@available(iOS 18.0, *)
actor DockWatcher {
    static let shared = DockWatcher()
    private var accessory: DockAccessory?
    private var started = false

    nonisolated func start() {
        Task { await self.watch() }
    }

    private func watch() async {
        if started { return }
        started = true
        do {
            for try await change in try DockAccessoryManager.shared.accessoryStateChanges {
                if change.state == .docked, let acc = change.accessory {
                    accessory = acc
                } else if change.state == .undocked {
                    accessory = nil
                }
            }
        } catch {
            started = false
        }
    }

    func isDocked() -> Bool { accessory != nil }

    func aim(yaw: Double, pitch: Double, seconds: Double) async throws -> Bool {
        guard let acc = accessory else { return false }
        // Our own aiming: switch DockKit's system (face) tracking off first.
        try await DockAccessoryManager.shared.setSystemTrackingEnabled(false)
        let target = Vector3D(x: pitch, y: yaw, z: 0)
        let ms = Int64(max(0.3, min(4.0, seconds)) * 1000)
        try await acc.setOrientation(target, duration: .milliseconds(ms), relative: true)
        return true
    }

    func release() async {
        try? await DockAccessoryManager.shared.setSystemTrackingEnabled(true)
    }
}
#endif
