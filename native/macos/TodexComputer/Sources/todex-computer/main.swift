import AppKit
import TodexComputerCore

// JSON lines on stdin → JSON lines on stdout, one request at a time, in
// order. stdout carries only protocol lines; diagnostics go to stderr.
setvbuf(stdout, nil, _IOLBF, 0)
let commands = await MainActor.run { Commands() }

func emit(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

for try await line in FileHandle.standardInput.bytes.lines {
    guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
    switch decodeRequest(line) {
    case let .failure(failure):
        emit(responseLine(id: failure.id, result: .failure(failure.error)))
    case let .success(request):
        let result: Result<[String: Any], HelperError>
        do {
            result = .success(try await commands.handle(request))
        } catch {
            result = .failure(error)
        }
        emit(responseLine(id: request.id, result: result))
    }
}
