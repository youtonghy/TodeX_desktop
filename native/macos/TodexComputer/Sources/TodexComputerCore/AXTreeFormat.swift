/// A node read from the Accessibility API, independent of AXUIElement so the
/// formatting is testable.
public struct AXNodeInfo: Sendable {
    public var role: String
    public var subrole: String?
    public var title: String?
    public var description: String?
    public var value: String?
    public var enabled: Bool
    public var focused: Bool
    public var selected: Bool
    public var children: [AXNodeInfo]
    /// Index into the caller's element table, used for refs.
    public var handle: Int

    public init(role: String, subrole: String? = nil, title: String? = nil, description: String? = nil,
                value: String? = nil, enabled: Bool = true, focused: Bool = false, selected: Bool = false,
                children: [AXNodeInfo] = [], handle: Int)
    {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.value = value
        self.enabled = enabled
        self.focused = focused
        self.selected = selected
        self.children = children
        self.handle = handle
    }

    public var isSecureField: Bool { self.subrole == "AXSecureTextField" }
}

public struct FormattedTree: Sendable {
    public let text: String
    /// `eN` → element handle.
    public let refs: [String: Int]
    public let truncated: Bool
}

public enum AXTreeFormat {
    public static let maxChars = 64 * 1024

    /// Roles an agent can act on; they get `[ref=eN]`.
    static let actionable: Set<String> = [
        "AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton",
        "AXComboBox", "AXMenuItem", "AXMenuButton", "AXMenuBarItem", "AXLink", "AXSlider",
        "AXIncrementor", "AXDisclosureTriangle", "AXCell", "AXRow", "AXTab", "AXSearchField",
        "AXStepper", "AXColorWell", "AXDateField", "AXSegmentedControl",
    ]
    /// Structural roles printed only through their children when unnamed.
    static let transparent: Set<String> = [
        "AXGroup", "AXScrollArea", "AXSplitGroup", "AXLayoutArea", "AXUnknown", "AXSplitter",
        "AXGrowArea", "AXMatte", "AXRuler", "AXLayoutItem",
    ]

    static func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let collapsed = value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }
        return collapsed.count > 200 ? String(collapsed.prefix(200)) + "…" : collapsed
    }

    static func quote(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    /// Indented text like the browser snapshot: `- AXButton "Save" [ref=e3]`.
    /// Secure field values are never printed.
    public static func format(_ root: AXNodeInfo) -> FormattedTree {
        var lines: [String] = []
        var refs: [String: Int] = [:]
        var size = 0
        var truncated = false

        func walk(_ node: AXNodeInfo, depth: Int) {
            if truncated { return }
            let name = clean(node.title) ?? clean(node.description)
            let printed = !(transparent.contains(node.role) && name == nil)
                && !(node.role == "AXStaticText" && clean(node.value) == nil && name == nil)
            if printed {
                var line = String(repeating: "  ", count: depth) + "- " + node.role.replacingOccurrences(of: "AX", with: "")
                if node.isSecureField { line += " (password)" }
                if node.role == "AXStaticText", let text = clean(node.value) ?? name {
                    line += " " + quote(text)
                } else {
                    if let name { line += " " + quote(name) }
                    if !node.isSecureField, let value = clean(node.value), value != name {
                        line += " value=" + quote(value)
                    }
                }
                if !node.enabled { line += " [disabled]" }
                if node.focused { line += " [focused]" }
                if node.selected { line += " [selected]" }
                if actionable.contains(node.role) || node.isSecureField {
                    let ref = "e\(refs.count + 1)"
                    refs[ref] = node.handle
                    line += " [ref=\(ref)]"
                }
                if size + line.utf8.count + 1 > maxChars {
                    truncated = true
                    return
                }
                size += line.utf8.count + 1
                lines.append(line)
            }
            for child in node.children {
                walk(child, depth: printed ? depth + 1 : depth)
            }
        }
        walk(root, depth: 0)
        return FormattedTree(text: lines.joined(separator: "\n"), refs: refs, truncated: truncated)
    }
}
