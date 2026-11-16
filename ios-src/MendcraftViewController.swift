// Registers the two local plugins with Capacitor. In Xcode, set the Main
// storyboard's view controller class to MendcraftViewController (module App).
// Also turns DockKit system (face) tracking off on appear, so it really runs
// on launch even if the plugin's load() missed the first active notification.
// NOT compiled yet (see ios-src/README.md).
//
// Copy this file into ios/App/App after `npx cap add ios`.

import UIKit
import Capacitor

class MendcraftViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MendcraftLanPlugin())
        bridge?.registerPluginInstance(MendcraftGimbalPlugin())
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        MendcraftGimbalPlugin.requestSystemTrackingOff()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Do not re-enable here: disappearing a view is not leaving the app.
        // Backgrounding is handled by the plugin's didEnterBackground observer.
    }
}
