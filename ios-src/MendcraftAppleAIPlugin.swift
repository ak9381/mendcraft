// MendcraftAppleAI — on-device Apple Foundation Models (Apple Intelligence)
// for the Capacitor iOS shell. Cloud Gemini stays on the existing web
// Firebase AI Logic path. We do not use the Firebase iOS HybridModel API
// (removed in firebase-ios-sdk 13.2.0, 16 Nov 2026) and we do not add
// Firebase AI Logic or App Check on iOS.
//
// STATUS: written on Linux, NOT compiled or run yet (no Mac/Xcode on the
// build box). Behind `#if canImport(FoundationModels)` and
// `@available(iOS 26.0, *)` so older SDKs/OSes compile and report
// status "unsupported".
//
// Copy this file into ios/App/App after `npx cap add ios` (see ios-src/README.md).

import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(MendcraftAppleAIPlugin)
public class MendcraftAppleAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MendcraftAppleAIPlugin"
    public let jsName = "MendcraftAppleAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prewarm", returnType: CAPPluginReturnPromise),
    ]

    @objc public func availability(_ call: CAPPluginCall) {
        call.resolve(Self.availabilityPayload())
    }

    @objc public func generate(_ call: CAPPluginCall) {
        let prompt = call.getString("prompt")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if prompt.isEmpty {
            call.reject("prompt is required")
            return
        }
        let schemaJSON = Self.schemaJSON(from: call)
        let instructions = call.getString("instructions")
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let text = try await Self.generate(
                        prompt: prompt,
                        schemaJSON: schemaJSON,
                        instructions: instructions
                    )
                    call.resolve(["text": text, "source": "on_device"])
                } catch {
                    call.reject(error.localizedDescription, nil, error)
                }
            }
            return
        }
        #endif
        call.reject("Apple Foundation Models require iOS 26 or later")
    }

    @objc public func prewarm(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let avail = Self.availabilityPayload()
            let status = avail["status"] as? String ?? "unavailable"
            guard status == "available" else {
                call.resolve(["ok": false, "status": status])
                return
            }
            Task { @MainActor in
                let session = LanguageModelSession()
                session.prewarm()
                call.resolve(["ok": true, "status": "available"])
            }
            return
        }
        #endif
        call.resolve(["ok": false, "status": "unsupported"])
    }

    static func availabilityPayload() -> [String: String] {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return ["status": "available"]
            case .unavailable(let reason):
                return ["status": statusName(reason)]
            @unknown default:
                return ["status": "unavailable"]
            }
        }
        #endif
        return ["status": "unsupported"]
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    static func statusName(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible:
            return "deviceNotEligible"
        case .appleIntelligenceNotEnabled:
            return "appleIntelligenceNotEnabled"
        case .modelNotReady:
            return "modelNotReady"
        @unknown default:
            return "unavailable"
        }
    }

    @available(iOS 26.0, *)
    static func generate(prompt: String, schemaJSON: String?, instructions: String?) async throws -> String {
        var inst = instructions?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if inst.isEmpty {
            inst = "Reply with JSON only. Do not wrap it in markdown."
        }
        if let schemaJSON, !schemaJSON.isEmpty {
            inst += "\nThe JSON must match this schema:\n\(schemaJSON)"
        }
        let session = LanguageModelSession(instructions: inst)
        let response = try await session.respond(to: prompt)
        return response.content
    }
    #endif

    static func schemaJSON(from call: CAPPluginCall) -> String? {
        if let raw = call.getString("schema")?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            return raw
        }
        if let obj = call.getObject("schema") {
            if JSONSerialization.isValidJSONObject(obj),
               let data = try? JSONSerialization.data(withJSONObject: obj),
               let text = String(data: data, encoding: .utf8) {
                return text
            }
        }
        return nil
    }
}
