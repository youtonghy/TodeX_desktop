import AppKit
import ApplicationServices
import PeekabooAutomationKit
import PeekabooFoundation
import TodexComputerCore

/// Executes requests. Policy (blocked apps, app approval, a busy user) is
/// the main process's job; `resolve` tells it what a request would touch.
@MainActor
final class Commands {
    private let table = ElementTable()
    private lazy var automation = UIAutomationService()

    func handle(_ request: Request) async throws(HelperError) -> [String: Any] {
        switch request.cmd {
        case "permissions":
            return ["screen": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()]
        case "idle":
            // Hardware input only: events this helper posts are not counted.
            let any = CGEventType(rawValue: ~0)!
            return ["seconds": CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: any)]
        case "windows":
            return ["windows": Desktop.windows().prefix(40).map(Desktop.windowInfo), "displays": Desktop.displays()]
        case "observe":
            return try self.observe(request)
        case "resolve":
            return try self.resolve(request)
        case "act":
            return try await self.act(request)
        default:
            throw .invalid("unknown command \(request.cmd)")
        }
    }

    // MARK: - Observe

    private func observe(_ request: Request) throws(HelperError) -> [String: Any] {
        try Self.requireAccessibility()
        let windows = Desktop.windows()
        let window: Desktop.WindowInfo?
        let app: NSRunningApplication
        if let id = request.window {
            guard let match = windows.first(where: { $0.id == id }),
                  let owner = NSRunningApplication(processIdentifier: match.pid) else {
                throw HelperError("INVALID_ARGUMENT", "window \(id) is not on screen")
            }
            window = match
            app = owner
        } else {
            app = try Desktop.targetApp(request.app)
            window = windows.first { $0.pid == app.processIdentifier }
        }
        self.table.reset(pid: app.processIdentifier)
        let root = Desktop.axWindow(pid: app.processIdentifier, matching: window)
            ?? AXUIElementCreateApplication(app.processIdentifier)
        var reader = TreeReader(table: self.table)
        let tree = AXTreeFormat.format(reader.read(root))
        self.table.setRefs(tree.refs)
        var result: [String: Any] = [
            "app": Desktop.appInfo(app),
            "windows": windows.prefix(30).map { ["id": Int($0.id), "app": $0.app, "bundleId": $0.bundleId, "title": $0.title] },
            "displays": Desktop.displays(),
            "tree": tree.text,
            "truncated": tree.truncated,
        ]
        if let window { result["window"] = Desktop.windowInfo(window) }
        return result
    }

    // MARK: - Resolve

    /// What a request would act on: the owning app, and whether the target
    /// is a password field.
    private func resolve(_ request: Request) throws(HelperError) -> [String: Any] {
        if let ref = request.ref {
            try Self.requireAccessibility()
            let element = try self.table.element(for: ref)
            let pid = AX.pid(element)
            let app = NSRunningApplication(processIdentifier: pid)
            return [
                "bundleId": app?.bundleIdentifier ?? "",
                "name": app?.localizedName ?? "",
                "pid": Int(pid),
                "secure": AX.string(element, kAXSubroleAttribute) == "AXSecureTextField",
            ]
        }
        if let x = request.x, let y = request.y {
            guard let window = Desktop.window(at: CGPoint(x: x, y: y)) else {
                return ["bundleId": "", "name": "", "pid": 0, "secure": false]
            }
            return ["bundleId": window.bundleId, "name": window.app, "pid": Int(window.pid), "windowId": Int(window.id), "secure": false]
        }
        if request.action == "open_app", let identifier = request.app {
            if let running = Desktop.runningApp(identifier) {
                return ["bundleId": running.bundleIdentifier ?? "", "name": running.localizedName ?? identifier, "pid": Int(running.processIdentifier), "secure": false]
            }
            guard let url = Self.applicationURL(identifier), let bundle = Bundle(url: url) else {
                throw HelperError("INVALID_ARGUMENT", "no app named \(identifier)")
            }
            return ["bundleId": bundle.bundleIdentifier ?? "", "name": FileManager.default.displayName(atPath: url.path), "pid": 0, "secure": false]
        }
        let app = try Desktop.targetApp(request.app)
        var secure = false
        if request.action == "type", let focused = Self.focusedElement(pid: app.processIdentifier) {
            secure = AX.string(focused, kAXSubroleAttribute) == "AXSecureTextField"
        }
        return ["bundleId": app.bundleIdentifier ?? "", "name": app.localizedName ?? "", "pid": Int(app.processIdentifier), "secure": secure]
    }

    // MARK: - Act

    private func act(_ request: Request) async throws(HelperError) -> [String: Any] {
        guard let action = request.action else { throw .invalid("act needs action") }
        if action != "wait" && action != "open_app" { try Self.requireAccessibility() }
        let element = try request.ref.map { ref throws(HelperError) in try self.table.element(for: ref) }
        let point = try self.point(request, element: element)
        var path = "pointer"
        switch action {
        case "click", "right_click":
            if let element, action == "click", Self.perform(element, ["AXPress", "AXConfirm", "AXPick"]) {
                path = "background"
            } else if let element, action == "right_click", Self.perform(element, ["AXShowMenu"]) {
                path = "background"
            } else {
                try await self.pointerClick(at: point, type: action == "click" ? .single : .right)
            }
        case "double_click":
            try await self.pointerClick(at: point, type: .double)
        case "hover":
            try await self.wrap { try await self.automation.moveMouse(to: try self.require(point), duration: 150, steps: 10, profile: .linear) }
        case "drag":
            guard let toX = request.toX, let toY = request.toY else { throw .invalid("drag needs toX and toY") }
            let from = try self.require(point)
            try await self.wrap {
                try await self.automation.drag(DragOperationRequest(
                    from: from, to: CGPoint(x: toX, y: toY), duration: 400, steps: 20, modifiers: nil, profile: .linear))
            }
        case "scroll":
            path = try self.scroll(request, element: element, at: point)
        case "type":
            path = try await self.type(request, element: element)
        case "key":
            let chord = try KeyChord(parsing: request.keys ?? "")
            let pid = try request.app.map { app throws(HelperError) in try Desktop.targetApp(app).processIdentifier }
                ?? NSWorkspace.shared.frontmostApplication?.processIdentifier
            try await self.wrap {
                if let pid {
                    try await self.automation.hotkey(keys: chord.peekabooKeys, holdDuration: 50, targetProcessIdentifier: pid)
                } else {
                    try await self.automation.hotkey(keys: chord.peekabooKeys, holdDuration: 50)
                }
            }
            path = "background"
        case "wait":
            try? await Task.sleep(for: .milliseconds(min(max(request.ms ?? 1000, 0), 10000)))
            path = "none"
        case "open_app":
            try await self.openApp(request.app ?? "")
            path = "background"
        case "focus_window":
            try self.focusWindow(request)
            path = "background"
        default:
            throw .invalid("unknown action \(action)")
        }
        let app = element.flatMap { NSRunningApplication(processIdentifier: AX.pid($0)) }
            ?? request.app.flatMap(Desktop.runningApp)
            ?? point.flatMap { Desktop.window(at: $0) }.flatMap { NSRunningApplication(processIdentifier: $0.pid) }
            ?? NSWorkspace.shared.frontmostApplication
        return ["app": app.map(Desktop.appInfo) ?? [:], "path": path]
    }

    private func point(_ request: Request, element: AXUIElement?) throws(HelperError) -> CGPoint? {
        if let x = request.x, let y = request.y {
            guard x.isFinite, y.isFinite else { throw .invalid("x and y must be finite") }
            return CGPoint(x: x, y: y)
        }
        guard let element, let frame = AX.frame(element), frame.width > 0, frame.height > 0 else { return nil }
        return CGPoint(x: frame.midX, y: frame.midY)
    }

    private func require(_ point: CGPoint?) throws(HelperError) -> CGPoint {
        guard let point else { throw .invalid("this action needs a ref with a frame, or x and y") }
        return point
    }

    private func pointerClick(at point: CGPoint?, type: ClickType) async throws(HelperError) {
        let target = try self.require(point)
        try await self.wrap { try await self.automation.click(target: .coordinates(target), clickType: type, snapshotId: nil) }
    }

    private func scroll(_ request: Request, element: AXUIElement?, at point: CGPoint?) throws(HelperError) -> String {
        let deltaY = Int32((request.deltaY ?? 0).rounded())
        let deltaX = Int32((request.deltaX ?? 0).rounded())
        if let element, deltaX == 0,
           Self.perform(element, [deltaY > 0 ? "AXScrollDownByPage" : "AXScrollUpByPage"]) {
            return "background"
        }
        if let point { CGWarpMouseCursorPosition(point) }
        let source = CGEventSource(stateID: .privateState)
        // Pixels; the wheel's positive direction is up, the agent's is down.
        guard let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
                                  wheel1: -deltaY, wheel2: -deltaX, wheel3: 0) else {
            throw HelperError("EXECUTOR_FAILED", "could not create a scroll event")
        }
        event.post(tap: .cghidEventTap)
        return "pointer"
    }

    /// Inserts text without keystrokes (no input method interference): into
    /// the element, else the target app's focused element; pastes when the
    /// element does not accept inserted text.
    private func type(_ request: Request, element: AXUIElement?) async throws(HelperError) -> String {
        let text = request.text ?? ""
        let pid: pid_t
        if let element {
            pid = AX.pid(element)
        } else {
            pid = try Desktop.targetApp(request.app).processIdentifier
        }
        let target = element ?? Self.focusedElement(pid: pid)
        if let target, AX.string(target, kAXSubroleAttribute) == "AXSecureTextField", request.confirmed != true {
            throw HelperError("SENSITIVE_ACTION", "typing into a password field")
        }
        if let target {
            if element != nil { AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) }
            if AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute as CFString, text as CFString) == .success {
                return "background"
            }
        }
        try await self.paste(text, pid: pid)
        return "background"
    }

    /// Pastes through the target app, restoring the clipboard afterwards.
    private func paste(_ text: String, pid: pid_t) async throws(HelperError) {
        let pasteboard = NSPasteboard.general
        let saved = pasteboard.pasteboardItems?.map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) { copy.setData(data, forType: type) }
            }
            return copy
        } ?? []
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        defer {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                pasteboard.clearContents()
                if !saved.isEmpty { pasteboard.writeObjects(saved) }
            }
        }
        try await self.wrap { try await self.automation.hotkey(keys: "cmd,v", holdDuration: 50, targetProcessIdentifier: pid) }
    }

    private func openApp(_ identifier: String) async throws(HelperError) {
        if let running = Desktop.runningApp(identifier) {
            running.activate()
            return
        }
        guard let url = Self.applicationURL(identifier) else { throw .invalid("no app named \(identifier)") }
        do {
            _ = try await NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        } catch {
            throw HelperError("EXECUTOR_FAILED", "could not open \(identifier): \(error.localizedDescription)")
        }
    }

    private func focusWindow(_ request: Request) throws(HelperError) {
        if let id = request.window {
            guard let window = Desktop.windows().first(where: { $0.id == id }),
                  let app = NSRunningApplication(processIdentifier: window.pid) else {
                throw .invalid("window \(id) is not on screen")
            }
            if let axWindow = Desktop.axWindow(pid: window.pid, matching: window) {
                AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
            }
            app.activate()
            return
        }
        try Desktop.targetApp(request.app).activate()
    }

    // MARK: - Support

    private func wrap(_ body: () async throws -> Void) async throws(HelperError) {
        do {
            try await body()
        } catch {
            throw HelperError("EXECUTOR_FAILED", "\(error)")
        }
    }

    private static func requireAccessibility() throws(HelperError) {
        guard AXIsProcessTrusted() else {
            throw HelperError("PERMISSION_REQUIRED", "TodeX needs the Accessibility permission (System Settings → Privacy & Security → Accessibility).")
        }
    }

    private static func perform(_ element: AXUIElement, _ candidates: [String]) -> Bool {
        let available = AX.actions(element)
        guard let action = candidates.first(where: available.contains) else { return false }
        return AXUIElementPerformAction(element, action as CFString) == .success
    }

    private static func focusedElement(pid: pid_t) -> AXUIElement? {
        guard let value = AX.attribute(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute) else { return nil }
        // swiftlint:disable:next force_cast
        return (value as! AXUIElement)
    }

    private static func applicationURL(_ identifier: String) -> URL? {
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: identifier) { return url }
        let name = identifier.hasSuffix(".app") ? identifier : identifier + ".app"
        for directory in ["/Applications", "/System/Applications", "/System/Applications/Utilities", NSHomeDirectory() + "/Applications"] {
            let url = URL(fileURLWithPath: directory).appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return nil
    }
}
