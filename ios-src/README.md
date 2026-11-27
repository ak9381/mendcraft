# Mendcraft iOS sources (`ios-src/`)

These Swift files are written on Linux and are **not compiled here** (no Mac /
Xcode on the build box). After you generate the Capacitor iOS project on a Mac,
copy them into the App target.

## Copy into `ios/App/App`

From the `app/` directory, after `npx cap add ios` (or on a later `npx cap sync ios`):

```sh
cp ios-src/MendcraftGimbalPlugin.swift    ios/App/App/
cp ios-src/MendcraftViewController.swift ios/App/App/
cp ios-src/MendcraftLanPlugin.swift      ios/App/App/
```

Then in Xcode:

1. Add those three files to the **App** target if they are not already in the project (drag from `ios/App/App` if needed).
2. Set the Main storyboard’s view controller class to `MendcraftViewController` (module **App**).

`MendcraftGimbalPlugin.swift` turns DockKit system face tracking **off** in
`load()`, on `UIApplication.didBecomeActive` (resume), when a stand docks, and
again from `MendcraftViewController.viewDidAppear`. That call has to actually
run: otherwise the Flow 2 Pro keeps following a face inside Mendcraft. Tracking
is turned back on only when the app backgrounds.

The web layer (already in the hosted bundle) aims at her hands in normal use,
and in Add a device stops following so she can point or nudge pan/tilt, then
holds so the device stays in frame.
