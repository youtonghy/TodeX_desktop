import AppKit
import ApplicationServices
import TodexComputerCore

/// Thin, typed reads over AXUIElement.
enum AX {
    static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    static func string(_ element: AXUIElement, _ name: String) -> String? {
        switch attribute(element, name) {
        case let value as String: value
        case let value as NSNumber: value.stringValue
        default: nil
        }
    }

    static func bool(_ element: AXUIElement, _ name: String) -> Bool? {
        (attribute(element, name) as? NSNumber)?.boolValue
    }

    static func children(_ element: AXUIElement) -> [AXUIElement] {
        (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    }

    static func frame(_ element: AXUIElement) -> CGRect? {
        guard let positionValue = attribute(element, kAXPositionAttribute),
              let sizeValue = attribute(element, kAXSizeAttribute) else { return nil }
        var position = CGPoint.zero
        var size = CGSize.zero
        // swiftlint:disable force_cast
        AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        // swiftlint:enable force_cast
        return CGRect(origin: position, size: size)
    }

    static func actions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
        return (names as? [String]) ?? []
    }

    static func pid(_ element: AXUIElement) -> pid_t {
        var pid: pid_t = 0
        AXUIElementGetPid(element, &pid)
        return pid
    }
}

/// Elements of the latest observation, addressable by ref until the next one.
@MainActor
final class ElementTable {
    private(set) var elements: [AXUIElement] = []
    private(set) var refs: [String: Int] = [:]
    private(set) var pid: pid_t = 0

    func reset(pid: pid_t) {
        self.elements = []
        self.refs = [:]
        self.pid = pid
    }

    func add(_ element: AXUIElement) -> Int {
        self.elements.append(element)
        return self.elements.count - 1
    }

    func setRefs(_ refs: [String: Int]) {
        self.refs = refs
    }

    func element(for ref: String) throws(HelperError) -> AXUIElement {
        guard let index = self.refs[ref], index < self.elements.count else {
            throw HelperError("REF_NOT_FOUND", "\(ref) is not in the latest observation; call computer_observe again.")
        }
        return self.elements[index]
    }
}

/// Reads an AX subtree into `AXNodeInfo`, bounded by depth and count.
@MainActor
struct TreeReader {
    let table: ElementTable
    let maxDepth = 30
    let maxNodes = 2500
    private var count = 0

    init(table: ElementTable) {
        self.table = table
    }

    mutating func read(_ element: AXUIElement, depth: Int = 0) -> AXNodeInfo {
        self.count += 1
        let handle = self.table.add(element)
        let role = AX.string(element, kAXRoleAttribute) ?? "AXUnknown"
        var node = AXNodeInfo(
            role: role,
            subrole: AX.string(element, kAXSubroleAttribute),
            title: AX.string(element, kAXTitleAttribute),
            description: AX.string(element, kAXDescriptionAttribute),
            value: AX.string(element, kAXValueAttribute),
            enabled: AX.bool(element, kAXEnabledAttribute) ?? true,
            focused: AX.bool(element, kAXFocusedAttribute) ?? false,
            selected: AX.bool(element, kAXSelectedAttribute) ?? false,
            handle: handle)
        if node.title == nil && node.description == nil {
            node.description = AX.string(element, kAXHelpAttribute)
        }
        guard depth < self.maxDepth else { return node }
        for child in AX.children(element) {
            guard self.count < self.maxNodes else { break }
            node.children.append(self.read(child, depth: depth + 1))
        }
        return node
    }
}
