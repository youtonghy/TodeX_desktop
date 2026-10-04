import Foundation

/// A key chord such as `cmd+shift+z`, normalized to Peekaboo's hotkey
/// format (`cmd,shift,z`): modifiers first, one non-modifier key last.
public struct KeyChord: Equatable, Sendable {
    public let modifiers: [String]
    public let key: String

    static let modifierAliases: [String: String] = [
        "cmd": "cmd", "command": "cmd", "⌘": "cmd", "meta": "cmd", "super": "cmd",
        "shift": "shift", "⇧": "shift",
        "alt": "alt", "option": "alt", "opt": "alt", "⌥": "alt",
        "ctrl": "ctrl", "control": "ctrl", "⌃": "ctrl",
        "fn": "fn",
    ]
    static let modifierOrder = ["cmd", "ctrl", "alt", "shift", "fn"]
    static let keyAliases: [String: String] = [
        "enter": "return", "return": "return", "esc": "escape", "escape": "escape",
        "tab": "tab", "space": "space", "backspace": "delete", "delete": "delete",
        "del": "forward_delete", "forwarddelete": "forward_delete",
        "up": "up", "down": "down", "left": "left", "right": "right",
        "arrowup": "up", "arrowdown": "down", "arrowleft": "left", "arrowright": "right",
        "home": "home", "end": "end", "pageup": "pageup", "pagedown": "pagedown",
    ]

    /// Parses `cmd+c`, `Cmd-Shift-Z`, `enter`, `f5`. Throws on an empty
    /// chord, several non-modifier keys, or only modifiers.
    public init(parsing raw: String) throws(HelperError) {
        // `+`/`,` separate keys; `-` only when neither is used (`ctrl-alt-delete`),
        // so `cmd+-` keeps its minus.
        let usesDash = !raw.contains("+") && !raw.contains(",") && raw.count > 1
        let parts = raw
            .split(whereSeparator: { $0 == "+" || $0 == "," || $0 == " " || (usesDash && $0 == "-") })
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { throw .invalid("empty key chord") }
        var modifiers = Set<String>()
        var key: String?
        for part in parts {
            if let modifier = Self.modifierAliases[part] {
                modifiers.insert(modifier)
            } else if key == nil {
                key = Self.keyAliases[part] ?? part
            } else {
                throw .invalid("a chord has one key besides modifiers: \(raw)")
            }
        }
        guard let key else { throw .invalid("a chord needs a key besides modifiers: \(raw)") }
        let isFunctionKey = key.first == "f" && Int(key.dropFirst()).map { (1...20).contains($0) } == true
        guard key.count == 1 || Self.keyAliases.values.contains(key) || isFunctionKey else {
            throw .invalid("unknown key \(key)")
        }
        self.modifiers = Self.modifierOrder.filter(modifiers.contains)
        self.key = key
    }

    /// Peekaboo `hotkey(keys:)` format.
    public var peekabooKeys: String { (self.modifiers + [self.key]).joined(separator: ",") }
}

