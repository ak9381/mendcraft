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
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Do not re-enable here: disappearing a view is not leaving the app.
        // Backgrounding is handled by the plugin's didEnterBackground observer.
    }
}
