import AppKit
import LocalAuthentication

// An independent bundle gives the system prompt the current display name,
// without renaming the main app's legacy Keychain identity.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let context = LAContext()
let policy = LAPolicy.deviceOwnerAuthenticationWithBiometrics
var error: NSError?
guard context.canEvaluatePolicy(policy, error: &error) else { exit(2) }
if CommandLine.arguments.dropFirst().elementsEqual(["--check"]) { exit(0) }
guard CommandLine.arguments.dropFirst().elementsEqual(["--authenticate"]) else { exit(2) }
context.localizedFallbackTitle = ""
context.localizedCancelTitle = "Отменить"
let parent = getppid()
let deadline = Date.timeIntervalSinceReferenceDate + 85
let watchdog = DispatchSource.makeTimerSource(queue: .main)
watchdog.schedule(deadline: .now() + 1, repeating: 1)
watchdog.setEventHandler {
    if getppid() != parent || Date.timeIntervalSinceReferenceDate >= deadline {
        context.invalidate()
        exit(1)
    }
}
watchdog.resume()
application.activate(ignoringOtherApps: true)
context.evaluatePolicy(policy, localizedReason: "Разблокировать «Обла»") { success, _ in
    exit(success ? 0 : 1)
}
application.run()
