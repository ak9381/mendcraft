// Registers the local plugins with Capacitor (LAN, gimbal, Apple on-device AI). In Xcode, set the Main
// storyboard's view controller class to MendcraftViewController (module App).
// DockKit system tracking is NOT forced off here any more: the web layer picks
// face / hands / hold through MendcraftGimbal.setSystemTrackingEnabled.
//
// Copy this file into ios/App/App after `npx cap add ios`.

import UIKit
import Capacitor

class MendcraftViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MendcraftLanPlugin())
        bridge?.registerPluginInstance(MendcraftGimbalPlugin())
        bridge?.registerPluginInstance(MendcraftAppleAIPlugin())
        // Canvas colour (#F7F5F0) behind the web view: the status-bar band and
        // the home-indicator strip are never the black Dark Mode default.
        let canvas = UIColor(red: 0xF7 / 255.0, green: 0xF5 / 255.0, blue: 0xF0 / 255.0, alpha: 1)
        view.backgroundColor = canvas
        webView?.backgroundColor = canvas
        webView?.scrollView.backgroundColor = canvas
    }

    // The canvas is light whatever the system appearance: dark clock and
    // icons in the status bar (the default is white ones in Dark Mode, which
    // are invisible on the light canvas).
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Do not re-enable here: disappearing a view is not leaving the app.
        // Backgrounding is handled by the plugin's didEnterBackground observer.
    }
}
