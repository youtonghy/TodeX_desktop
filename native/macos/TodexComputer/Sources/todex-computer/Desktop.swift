import AppKit
import ApplicationServices
import TodexComputerCore

/// Apps, windows and displays as the main process sees them.
@MainActor
enum Desktop {
    struct WindowInfo {
        let id: UInt32
        let pid: pid_t
        let app: String
        let bundleId: String
        let title: String
        let frame: CGRect
    }

    static func appInfo(_ app: NSRunningApplication) -> [String: Any] {
        ["name": app.localizedName ?? "", "bundleId": app.bundleIdentifier ?? "", "pid": Int(app.processIdentifier)]
    }

    /// Resolves a bundle id or app name among running apps.
    static func runningApp(_ identifier: String) -> NSRunningApplication? {
        let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        let lowered = identifier.lowercased()
        return apps.first { $0.bundleIdentifier?.lowercased() == lowered }
            ?? apps.first { $0.localizedName?.lowercased() == lowered }
    }

    static func targetApp(_ identifier: String?) throws(HelperError) -> NSRunningApplication {
        if let identifier, !identifier.isEmpty {
            guard let app = runningApp(identifier) else {
                throw HelperError("APP_NOT_RUNNING", "\(identifier) is not running; use open_app first.")
            }
            return app
        }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            throw HelperError("EXECUTOR_FAILED", "no frontmost app")
        }
        return app
    }

    /// On-screen, normal-layer windows front to back.
    static func windows() -> [WindowInfo] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        let list = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
        return list.compactMap { entry in
            guard (entry[kCGWindowLayer as String] as? Int) == 0,
                  let id = entry[kCGWindowNumber as String] as? UInt32,
                  let pid = entry[kCGWindowOwnerPID as String] as? pid_t,
                  let boundsDict = entry[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: boundsDict),
                  frame.width > 1, frame.height > 1 else { return nil }
            let app = NSRunningApplication(processIdentifier: pid)
            return WindowInfo(
                id: id,
                pid: pid,
                app: app?.localizedName ?? (entry[kCGWindowOwnerName as String] as? String ?? ""),
                bundleId: app?.bundleIdentifier ?? "",
                title: entry[kCGWindowName as String] as? String ?? "",
                frame: frame)
        }
    }

    /// The topmost window containing a global point.
    static func window(at point: CGPoint) -> WindowInfo? {
        self.windows().first { $0.frame.contains(point) }
    }

    /// The AX window of `pid` best matching a CGWindow (by frame, then title).
    static func axWindow(pid: pid_t, matching window: WindowInfo?) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        let candidates = (AX.attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
        if let window {
            if let byFrame = candidates.first(where: { AX.frame($0).map { $0.integral == window.frame.integral } ?? false }) {
                return byFrame
            }
            if let byTitle = candidates.first(where: { AX.string($0, kAXTitleAttribute) == window.title }) {
                return byTitle
            }
        }
        if let focused = AX.attribute(app, kAXFocusedWindowAttribute) {
            // swiftlint:disable:next force_cast
            return (focused as! AXUIElement)
        }
        return candidates.first
    }

    static func displays() -> [[String: Any]] {
        NSScreen.screens.enumerated().map { index, screen in
            // Global coordinates use a top-left origin at the primary display.
            let primaryHeight = NSScreen.screens.first?.frame.height ?? screen.frame.height
            let frame = screen.frame
            return [
                "index": index,
                "x": frame.minX,
                "y": primaryHeight - frame.maxY,
                "width": frame.width,
                "height": frame.height,
                "scale": screen.backingScaleFactor,
            ]
        }
    }

    static func windowInfo(_ window: WindowInfo) -> [String: Any] {
        ["id": Int(window.id), "app": window.app, "bundleId": window.bundleId, "title": window.title,
         "x": window.frame.minX, "y": window.frame.minY, "width": window.frame.width, "height": window.frame.height]
    }
}
