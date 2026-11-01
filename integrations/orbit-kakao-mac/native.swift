import AppKit
import ApplicationServices
import CryptoKit
import Foundation

// No event synthesis, AXPerformAction, keyboard, clipboard, script engine or file ingestion.
// This adapter reads direct metadata only, and refuses unverified timestamps/layouts.
let kakaoBundle = "com.kakao.KakaoTalkMac"
let supportedVersion = "26.9.0"
let maxRows = 500

struct ReviewError: Error {
    let code: String
    let message: String
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success else { return nil }
    return result
}

func string(_ element: AXUIElement, _ name: String) -> String {
    (attribute(element, name) as? String) ?? ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func role(_ element: AXUIElement) -> String { string(element, kAXRoleAttribute) }
func digest(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
func staticText(_ element: AXUIElement) -> Bool {
    if role(element) == kAXStaticTextRole { return true }
    guard [kAXTextFieldRole, kAXTextAreaRole].contains(role(element)) else { return false }
    var settable = DarwinBoolean(true)
    return AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && !settable.boolValue
}

func metadataText(_ element: AXUIElement) -> String {
    let value = string(element, kAXValueAttribute)
    return value.isEmpty ? string(element, kAXTitleAttribute) : value
}

func dayString(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
}

func lastInputAt() -> Double {
    let idle = [CGEventType.keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel].map {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0)
    }.min() ?? 0
    return Date().timeIntervalSince1970 - idle
}

func runningApp() throws -> NSRunningApplication {
    guard AXIsProcessTrusted() else {
        throw ReviewError(code: "ACCESSIBILITY_REQUIRED", message: "손쉬운 사용 권한이 필요합니다. 권한은 자동으로 요청하거나 변경하지 않습니다.")
    }
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: kakaoBundle).first else {
        throw ReviewError(code: "KAKAO_NOT_RUNNING", message: "카카오톡을 직접 열어 주세요.")
    }
    guard app.bundleURL.flatMap({ Bundle(url: $0) })?.infoDictionary?["CFBundleShortVersionString"] as? String == supportedVersion else {
        throw ReviewError(code: "UNVERIFIED_VERSION", message: "이 카카오톡 버전의 읽음 표시 구조를 검증하지 못했습니다.")
    }
    return app
}

func tables(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    if depth > 5 { return [] }
    if role(element) == kAXTableRole { return [element] }
    // Never descend into editable fields, web advertisements or preview scroll areas under cells.
    if [kAXTextAreaRole, kAXTextFieldRole, kAXCellRole, "AXWebArea"].contains(role(element)) { return [] }
    return children(element).prefix(100).flatMap { tables($0, depth: depth + 1) }
}

func rows(_ table: AXUIElement) -> [AXUIElement] {
    children(table).filter { role($0) == kAXRowRole }.prefix(maxRows).map { $0 }
}

func directCellChildren(_ row: AXUIElement) -> [AXUIElement] {
    let cells = children(row).filter { role($0) == kAXCellRole }
    return cells.count == 1 ? children(cells[0]) : []
}

func currentContext() throws -> (AXUIElement, AXUIElement, String) {
    let app = try runningApp()
    guard !app.isHidden else {
        throw ReviewError(code: "USER_FOCUS_REQUIRED", message: "카카오톡을 숨기지 않은 상태에서 이미 읽은 대화방을 직접 열어 주세요.")
    }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    guard let focused = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() else {
        throw ReviewError(code: "WINDOW_UNKNOWN", message: "현재 대화방 창을 확인하지 못했습니다.")
    }
    let window = unsafeBitCast(focused, to: AXUIElement.self)
    let title = string(window, kAXTitleAttribute)
    guard role(window) == kAXWindowRole, !title.isEmpty, title != "카카오톡", string(window, kAXIdentifierAttribute) != "Main Window", (attribute(window, kAXMinimizedAttribute) as? Bool) != true else {
        throw ReviewError(code: "OPEN_READ_ROOM", message: "목록 대신 이미 읽은 대화방 창을 직접 열어 주세요.")
    }
    return (root, window, title)
}

func readState(_ root: AXUIElement, title: String) throws {
    let windows = (attribute(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    guard let main = windows.first(where: { string($0, kAXIdentifierAttribute) == "Main Window" }) else {
        throw ReviewError(code: "LIST_UNAVAILABLE", message: "대화방 목록에서 읽음 상태를 확인하지 못했습니다.")
    }
    let candidates = tables(main).flatMap(rows).compactMap { row -> String? in
        let fields = directCellChildren(row)
        let texts = fields.filter(staticText)
        let preview = fields.filter { role($0) == kAXScrollAreaRole }
        let profile = fields.filter { role($0) == kAXButtonRole }
        // Only direct room header/badge metadata are read. Preview descendants stay untouched.
        guard texts.count >= 1, preview.count == 1, profile.count == 1 else { return nil }
        let header = metadataText(texts[0])
        guard header == title || header.hasPrefix(title + " ") else { return nil }
        guard texts.count == 1 else { return "unread" }
        let imageIDs = fields.filter { role($0) == kAXImageRole }.map {
            string($0, kAXDescriptionAttribute) + " " + string($0, kAXIdentifierAttribute)
        }
        guard !imageIDs.contains(where: { $0.contains("unread") || $0.contains("mention") }) else { return "unread" }
        return "read"
    }
    guard candidates.count == 1, candidates[0] == "read" else {
        throw ReviewError(code: "UNREAD_OR_UNKNOWN", message: "현재 방의 미읽음이 없다는 사실을 목록에서 확인하지 못했습니다. 검토를 건너뜁니다.")
    }
}

// Read Help metadata before any body Value. Date precision is retained, never invented.
func timestamp(_ fields: [AXUIElement]) -> (date: Date, precision: String)? {
    let help = fields.filter(staticText).map { string($0, kAXHelpAttribute) }
    let formats = [("yyyy. MM. dd. HH:mm", "minute"), ("yyyy. M. d. HH:mm", "minute"), ("yyyy-MM-dd HH:mm:ss", "minute"), ("yyyy-MM-dd'T'HH:mm:ssXXX", "minute"), ("yyyy. M. d.", "day"), ("yyyy. MM. dd.", "day")]
    return help.compactMap { text in
        formats.compactMap { format, precision -> (Date, String)? in
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
            formatter.dateFormat = format
            formatter.isLenient = false
            guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
            return (date, precision)
        }.first
    }.first
}

func qualifiedRows(_ window: AXUIElement) throws -> [(fields: [AXUIElement], date: Date, precision: String)] {
    let cutoff = Date().addingTimeInterval(-7 * 86400)
    let found = tables(window).flatMap(rows).compactMap { row -> ([AXUIElement], Date, String)? in
        let fields = directCellChildren(row)
        guard let stamp = timestamp(fields), stamp.date >= cutoff, stamp.date <= Date() else { return nil }
        return (fields, stamp.date, stamp.precision)
    }
    guard !found.isEmpty else {
        throw ReviewError(code: "DATE_UNVERIFIED", message: "최근 7일 범위의 발신 날짜를 확인하지 못했습니다. 경계에 걸친 첫 날짜와 날짜 불명 메시지는 수집하지 않습니다.")
    }
    return found
}

func metadata(_ root: AXUIElement, _ window: AXUIElement, _ title: String) throws -> [String: Any] {
    try readState(root, title: title)
    // Window identity avoids merging different same-title rooms; reopening may create a new source.
    let identity = string(window, kAXIdentifierAttribute)
    let id = digest(kakaoBundle + "|" + title + "|" + (identity.isEmpty ? String(CFHash(window)) : identity))
    let qualified = try qualifiedRows(window)
    let last = qualified.max { $0.date < $1.date }!
    let signature = digest(qualified.map { "\(iso($0.date))|\($0.precision)|\($0.fields.map { String(CFHash($0)) }.joined(separator: ","))" }.joined(separator: ";"))
    return ["id": id, "title": title, "unreadCount": 0, "layoutVerified": true, "verifiedAt": iso(Date()), last.precision == "day" ? "lastActivityOn" : "lastActivityAt": last.precision == "day" ? dayString(last.date) : iso(last.date), "activitySignature": signature, "lastInputAt": lastInputAt()]
}

func captureCurrent() throws -> [String: Any] {
    let (root, window, title) = try currentContext()
    let before = try metadata(root, window, title)
    let qualified = try qualifiedRows(window)
    let messages = qualified.enumerated().compactMap { index, row -> [String: Any]? in
        let textFields = row.fields.filter { staticText($0) && string($0, kAXHelpAttribute).isEmpty }
        // Continuous rows without an explicit sender are not attributed by guesswork.
        guard textFields.count == 2 else { return nil }
        let sender = metadataText(textFields[0])
        let text = metadataText(textFields[1])
        guard !sender.isEmpty, sender.count <= 200, !text.isEmpty, text.count <= 8000 else {
            return nil
        }
        let identity = digest("\(before["id"]!)|\(iso(row.date))|\(index)|\(sender)|\(text)")
        if row.precision == "day" { return ["id": identity, "sentOn": dayString(row.date), "timePrecision": "day", "sender": sender, "text": text] }
        return ["id": identity, "sentAt": iso(row.date), "sender": sender, "text": text]
    }
    guard !messages.isEmpty else { throw ReviewError(code: "UNSUPPORTED_CHAT_LAYOUT", message: "발신자와 본문을 확실히 구분한 메시지가 없어 검토를 건너뜁니다.") }
    let (_, afterWindow, afterTitle) = try currentContext()
    let after = try metadata(root, afterWindow, afterTitle)
    guard before["id"] as? String == after["id"] as? String, before["activitySignature"] as? String == after["activitySignature"] as? String, title == afterTitle, abs((before["lastInputAt"] as? Double ?? 0) - (after["lastInputAt"] as? Double ?? 1)) < 0.05 else {
        throw ReviewError(code: "ROOM_CHANGED", message: "대화방 상태가 바뀌어 수집을 폐기했습니다.")
    }
    return ["roomId": before["id"]!, "messages": messages]
}

func run() throws -> [String: Any] {
    guard CommandLine.arguments.count == 2 else { throw ReviewError(code: "OPERATION", message: "지원하지 않는 실행입니다.") }
    switch CommandLine.arguments[1] {
    case "health":
        let app = NSRunningApplication.runningApplications(withBundleIdentifier: kakaoBundle).first
        let running = app != nil
        let version = app?.bundleURL.flatMap({ Bundle(url: $0) })?.infoDictionary?["CFBundleShortVersionString"] as? String
        let supported = version == supportedVersion
        let trusted = AXIsProcessTrusted()
        let message = !running ? "카카오톡을 직접 열어 주세요." : !trusted ? "손쉬운 사용 권한이 없어 수집할 수 없습니다. 권한은 자동으로 변경하지 않습니다." : !supported ? "이 카카오톡 버전의 읽음 표시 구조를 검증하지 못해 수집할 수 없습니다." : "자동 방 이동은 비활성입니다. 현재 열린 읽은 방도 발신 날짜·읽음 상태를 확인할 수 있을 때만 수집합니다. 날짜만 있으면 시각 미확인으로 보존합니다."
        return ["connected": running && trusted && supported, "accessibility": trusted, "layoutSupported": supported, "message": message]
    case "inspect-current":
        let (root, window, title) = try currentContext()
        return try metadata(root, window, title)
    case "capture-current": return try captureCurrent()
    default: throw ReviewError(code: "OPERATION", message: "방 이동·입력·전송을 지원하지 않습니다.")
    }
}

do {
    let data = try JSONSerialization.data(withJSONObject: run(), options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
} catch let error as ReviewError {
    let data = try JSONSerialization.data(withJSONObject: ["error": error.message, "code": error.code])
    FileHandle.standardOutput.write(data)
    exit(2)
} catch {
    FileHandle.standardOutput.write(Data("{\"error\":\"네이티브 검토를 완료하지 못했습니다.\",\"code\":\"NATIVE\"}".utf8))
    exit(2)
}
