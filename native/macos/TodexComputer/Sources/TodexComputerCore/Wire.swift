import Foundation

/// One request line from the desktop's main process.
public struct Request: Decodable, Sendable {
    public let id: String
    public let cmd: String
    /// `observe`/`resolve`/`act`: bundle id or app name.
    public let app: String?
    /// Window id (CGWindowID) from `windows`/`observe`.
    public let window: UInt32?
    /// Element ref from the latest `observe`.
    public let ref: String?
    /// Global screen point (points, top-left origin).
    public let x: Double?
    public let y: Double?
    public let toX: Double?
    public let toY: Double?
    public let action: String?
    public let text: String?
    public let keys: String?
    public let deltaX: Double?
    public let deltaY: Double?
    /// `wait`: milliseconds.
    public let ms: Int?
    /// The user confirmed a sensitive action (password field).
    public let confirmed: Bool?

    public init(id: String, cmd: String, app: String? = nil, window: UInt32? = nil, ref: String? = nil,
                x: Double? = nil, y: Double? = nil, toX: Double? = nil, toY: Double? = nil,
                action: String? = nil, text: String? = nil, keys: String? = nil,
                deltaX: Double? = nil, deltaY: Double? = nil, ms: Int? = nil, confirmed: Bool? = nil)
    {
        self.id = id
        self.cmd = cmd
        self.app = app
        self.window = window
        self.ref = ref
        self.x = x
        self.y = y
        self.toX = toX
        self.toY = toY
        self.action = action
        self.text = text
        self.keys = keys
        self.deltaX = deltaX
        self.deltaY = deltaY
        self.ms = ms
        self.confirmed = confirmed
    }
}

/// A failure with a stable code the main process maps to tool errors.
public struct HelperError: Error, Sendable, Equatable {
    public let code: String
    public let message: String

    public init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }

    public static func invalid(_ message: String) -> HelperError { HelperError("INVALID_ARGUMENT", message) }
}

/// Encodes one response line: `{id, ok: true, result}` or `{id, ok: false, error}`.
public func responseLine(id: String, result: Result<[String: Any], HelperError>) -> String {
    var object: [String: Any] = ["id": id]
    switch result {
    case let .success(value):
        object["ok"] = true
        object["result"] = value
    case let .failure(error):
        object["ok"] = false
        object["error"] = ["code": error.code, "message": error.message]
    }
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
}

/// A request line that could not be decoded, with the id it carried, if any.
public struct DecodeFailure: Error, Sendable {
    public let id: String
    public let error: HelperError
}

/// Decodes one request line.
public func decodeRequest(_ line: String) -> Result<Request, DecodeFailure> {
    let data = Data(line.utf8)
    do {
        return .success(try JSONDecoder().decode(Request.self, from: data))
    } catch {
        let id = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String ?? ""
        return .failure(DecodeFailure(id: id, error: .invalid("malformed request: \(error)")))
    }
}
