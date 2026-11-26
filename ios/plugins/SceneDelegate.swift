// Capacitor iOS scene entry. Must use MendcraftViewController — a bare
// CAPBridgeViewController never registers MendcraftAppleAI / LAN / gimbal,
// so the mic path cannot reach Apple Foundation Models, and some iOS
// builds show a black WKWebView.
//
// Copy this file into ios/App/App after `npx cap add ios`, replacing the
// generated SceneDelegate if it instantiates CAPBridgeViewController().

import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = UIColor(red: 0.969, green: 0.961, blue: 0.941, alpha: 1)
        window?.rootViewController = MendcraftViewController()
        window?.makeKeyAndVisible()
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
