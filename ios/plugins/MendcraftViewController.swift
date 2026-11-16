// Registers the two local plugins with Capacitor. In Xcode, set the Main
// storyboard's view controller class to MendcraftViewController (module App).
// NOT compiled yet (see ios/README.md).

import UIKit
import Capacitor

class MendcraftViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MendcraftLanPlugin())
        bridge?.registerPluginInstance(MendcraftGimbalPlugin())
    }
}
