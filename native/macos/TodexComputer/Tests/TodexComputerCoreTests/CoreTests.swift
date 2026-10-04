import Foundation
import Testing
@testable import TodexComputerCore

struct KeyChordTests {
    @Test func parsesCommonChords() throws {
        #expect(try KeyChord(parsing: "cmd+c").peekabooKeys == "cmd,c")
        #expect(try KeyChord(parsing: "Shift+Cmd+Z").peekabooKeys == "cmd,shift,z")
        #expect(try KeyChord(parsing: "ctrl-alt-delete").peekabooKeys == "ctrl,alt,delete")
        #expect(try KeyChord(parsing: "Enter").peekabooKeys == "return")
        #expect(try KeyChord(parsing: "esc").key == "escape")
        #expect(try KeyChord(parsing: "f5").key == "f5")
        #expect(try KeyChord(parsing: "-").key == "-")
        #expect(try KeyChord(parsing: "cmd+-").peekabooKeys == "cmd,-")
        #expect(try KeyChord(parsing: "option+arrowleft").peekabooKeys == "alt,left")
    }

    @Test func rejectsBadChords() {
        for raw in ["", "cmd", "cmd+a+b", "cmd+launchrockets", "f99"] {
            #expect(throws: HelperError.self) { try KeyChord(parsing: raw) }
        }
    }
}

struct TreeFormatTests {
    @Test func refsActionableNodesAndHidesSecrets() {
        let root = AXNodeInfo(role: "AXWindow", title: "Login", children: [
            AXNodeInfo(role: "AXGroup", children: [
                AXNodeInfo(role: "AXStaticText", value: "Sign in to continue", handle: 2),
                AXNodeInfo(role: "AXTextField", description: "Email", value: "ada@example.com", focused: true, handle: 3),
                AXNodeInfo(role: "AXTextField", subrole: "AXSecureTextField", description: "Password", value: "hunter2", handle: 4),
                AXNodeInfo(role: "AXButton", title: "Continue", enabled: false, handle: 5),
            ], handle: 1),
        ], handle: 0)
        let tree = AXTreeFormat.format(root)
        #expect(tree.text == """
        - Window "Login"
          - StaticText "Sign in to continue"
          - TextField "Email" value="ada@example.com" [focused] [ref=e1]
          - TextField (password) "Password" [ref=e2]
          - Button "Continue" [disabled] [ref=e3]
        """)
        #expect(tree.refs == ["e1": 3, "e2": 4, "e3": 5])
        #expect(!tree.text.contains("hunter2"))
        #expect(!tree.truncated)
    }

    @Test func truncatesHugeTrees() {
        let children = (0..<5000).map { AXNodeInfo(role: "AXButton", title: "Button number \($0) with a long label", handle: $0 + 1) }
        let tree = AXTreeFormat.format(AXNodeInfo(role: "AXWindow", title: "Big", children: children, handle: 0))
        #expect(tree.truncated)
        #expect(tree.text.utf8.count <= AXTreeFormat.maxChars)
    }
}

struct WireTests {
    @Test func decodesRequestsAndEncodesResponses() throws {
        let request = try decodeRequest(#"{"id":"1","cmd":"act","action":"type","ref":"e2","text":"hi","confirmed":true}"#).get()
        #expect(request.cmd == "act")
        #expect(request.confirmed == true)
        guard case let .failure(failure) = decodeRequest(#"{"id":"7","cmd":5}"#) else {
            Issue.record("expected failure"); return
        }
        #expect(failure.id == "7")
        #expect(failure.error.code == "INVALID_ARGUMENT")
        let line = responseLine(id: "1", result: .failure(HelperError("TARGET_BLOCKED", "no")))
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
        #expect(object?["ok"] as? Bool == false)
        #expect((object?["error"] as? [String: Any])?["code"] as? String == "TARGET_BLOCKED")
    }
}
