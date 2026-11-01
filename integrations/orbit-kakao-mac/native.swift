import AppKit
import ApplicationServices
import CryptoKit
import Foundation

// Only verified read-room row actions and bounded scrollbar actions are exposed.
// No keyboard, clipboard, script engine, arbitrary target or file ingestion.
let kakaoBundle = "com.kakao.KakaoTalkMac"
let supportedVersion = "26.9.0"
let maxRows = 500
let scanRoomLimit = 10
let scanMessageLimit = 250
let scanPageLimit = 8
let scanByteLimit = 75000

struct ListRoom {
    let row: AXUIElement
    let header: String
    let titlePrefix: String
    let date: Date
    let precision: String
    let id: String
}

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

func assertNoUserInput(_ initial: Double) throws {
    guard abs(lastInputAt() - initial) < 0.05 else {
        throw ReviewError(code: "USER_ACTIVE", message: "사용자 입력이 감지되어 자동 검토를 중지했습니다. 수집 중인 내용은 전달하지 않았습니다.")
    }
}

func actionNames(_ element: AXUIElement) -> [String] {
    var value: CFArray?
    guard AXUIElementCopyActionNames(element, &value) == .success else { return [] }
    return (value as? [String]) ?? []
}

let reviewMouseTag: Int64 = 0x4F524249544B414B
func nonLeftInputAt() -> Double {
    let idle = [CGEventType.keyDown, .rightMouseDown, .scrollWheel].map {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0)
    }.min() ?? 0
    return Date().timeIntervalSince1970 - idle
}

final class ReviewInputGuard {
    private let baselineOther = nonLeftInputAt()
    private var expectedLeft = Date().timeIntervalSince1970 - CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown)
    private var interrupted = false
    private let lock = NSLock()
    private var monitor: Any?
    init() throws {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown, .scrollWheel]) { [weak self] event in
            if event.cgEvent?.getIntegerValueField(.eventSourceUserData) == reviewMouseTag { return }
            self?.lock.lock(); self?.interrupted = true; self?.lock.unlock()
        }
        guard monitor != nil else { throw ReviewError(code: "INPUT_GUARD_UNAVAILABLE", message: "사용자 입력 감시를 준비하지 못해 자동 이동을 중단했습니다.") }
    }
    deinit { if let monitor = monitor { NSEvent.removeMonitor(monitor) } }
    func check(ignoreOwnLeft: Bool = false) throws {
        RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        lock.lock(); let human = interrupted; lock.unlock()
        let left = Date().timeIntervalSince1970 - CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown)
        guard !human, abs(nonLeftInputAt() - baselineOther) < 0.05, ignoreOwnLeft || abs(left - expectedLeft) < 0.05 else {
            throw ReviewError(code: "USER_ACTIVE", message: "사용자 입력이 감지되어 자동 이동을 중지했습니다. 진행 중인 수집은 전달하지 않았습니다.")
        }
        if ignoreOwnLeft { expectedLeft = left }
    }
}

func axPoint(_ element: AXUIElement, name: String) -> CGPoint? {
    guard let raw = attribute(element, name), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    let value = unsafeBitCast(raw, to: AXValue.self)
    var point = CGPoint.zero
    return AXValueGetValue(value, .cgPoint, &point) ? point : nil
}

func axSize(_ element: AXUIElement) -> CGSize? {
    guard let raw = attribute(element, kAXSizeAttribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
    let value = unsafeBitCast(raw, to: AXValue.self)
    var size = CGSize.zero
    return AXValueGetValue(value, .cgSize, &size) ? size : nil
}

func frame(_ element: AXUIElement) -> CGRect? {
    guard let point = axPoint(element, name: kAXPositionAttribute), let size = axSize(element),
          point.x.isFinite, point.y.isFinite, size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: point, size: size)
}

func hitMatches(_ root: AXUIElement, point: CGPoint, title: AXUIElement, row: AXUIElement) -> Bool {
    var found: AXUIElement?
    guard AXUIElementCopyElementAtPosition(root, Float(point.x), Float(point.y), &found) == .success, let hit = found,
          [kAXStaticTextRole, kAXCellRole, kAXRowRole].contains(role(hit)) else { return false }
    var current = hit
    for _ in 0..<5 {
        if CFEqual(current, title) || CFEqual(current, row) { return true }
        guard let raw = attribute(current, kAXParentAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return false }
        current = unsafeBitCast(raw, to: AXUIElement.self)
    }
    return false
}

func clickReadRoomTitle(_ root: AXUIElement, expected: ListRoom, guard input: ReviewInputGuard) throws {
    try input.check()
    let main = try mainWindow(root)
    let app = try runningApp()
    guard actionNames(main).contains("AXRaise"), AXUIElementPerformAction(main, "AXRaise" as CFString) == .success else {
        throw ReviewError(code: "ROOM_OPEN_UNSUPPORTED", message: "대화방 목록 창을 안전하게 표시하지 못했습니다.")
    }
    try input.check()
    let room = try freshRoom(root, expected: expected), texts = directCellChildren(room.row).filter(staticText)
    guard texts.count == 1, let titleRect = frame(texts[0]), let rowRect = frame(room.row), let windowRect = frame(main),
          rowRect.contains(titleRect), windowRect.contains(titleRect), titleRect.width >= 8, titleRect.height >= 8 else {
        throw ReviewError(code: "ROOM_TARGET_UNKNOWN", message: "검증된 방 제목 영역을 확인하지 못해 이동하지 않았습니다.")
    }
    let point = CGPoint(x: titleRect.midX, y: titleRect.midY)
    var displayIDs = [CGDirectDisplayID](repeating: 0, count: 1), displayCount: UInt32 = 0
    guard CGGetDisplaysWithPoint(point, 1, &displayIDs, &displayCount) == .success, displayCount == 1,
          let source = CGEventSource(stateID: .combinedSessionState) else {
        throw ReviewError(code: "ROOM_TARGET_UNKNOWN", message: "화면 안의 검증된 제목 좌표가 없어 이동하지 않았습니다.")
    }
    let latest = try freshRoom(root, expected: room); try input.check()
    let latestTexts = directCellChildren(latest.row).filter(staticText)
    guard latestTexts.count == 1, frame(latestTexts[0]) == titleRect, frame(latest.row) == rowRect, frame(main) == windowRect,
          hitMatches(root, point: point, title: latestTexts[0], row: latest.row) else {
        throw ReviewError(code: "ROOM_TARGET_CHANGED", message: "진입 직전 방의 위치나 클릭 대상이 달라져 이동하지 않았습니다.")
    }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
          let focused = attribute(root, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, main) else {
        throw ReviewError(code: "ROOM_TARGET_UNKNOWN", message: "방 목록이 실제 앞 창인지 확인하지 못해 이동하지 않았습니다.")
    }
    for click in 1...2 {
        guard let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
            throw ReviewError(code: "ROOM_OPEN_UNSUPPORTED", message: "방 제목 클릭을 준비하지 못했습니다.")
        }
        down.setIntegerValueField(.eventSourceUserData, value: reviewMouseTag); up.setIntegerValueField(.eventSourceUserData, value: reviewMouseTag)
        down.setIntegerValueField(.mouseEventClickState, value: Int64(click)); up.setIntegerValueField(.mouseEventClickState, value: Int64(click))
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
    }
    try input.check(ignoreOwnLeft: true)
}

func mainWindow(_ root: AXUIElement) throws -> AXUIElement {
    let windows = (attribute(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    guard let window = windows.first(where: { string($0, kAXIdentifierAttribute) == "Main Window" }),
          (attribute(window, kAXMinimizedAttribute) as? Bool) != true else {
        throw ReviewError(code: "LIST_UNAVAILABLE", message: "최소화되지 않은 카카오톡 대화방 목록이 필요합니다.")
    }
    return window
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

func allRows(_ table: AXUIElement) -> [AXUIElement] {
    children(table).filter { role($0) == kAXRowRole }
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
        guard let parsed = parseListHeader(header, now: Date()), headerMatchesTitle(parsed.0, title) else { return nil }
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

func headerMatchesTitle(_ prefix: String, _ title: String) -> Bool {
    if prefix == title { return true }
    guard prefix.hasPrefix(title + " ") else { return false }
    let suffix = String(prefix.dropFirst(title.count + 1))
    return suffix.range(of: #"^[0-9]{1,6}$"#, options: .regularExpression) != nil
}

func matchParts(_ pattern: String, _ text: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
    return (1..<match.numberOfRanges).map { index in
        guard let range = Range(match.range(at: index), in: text) else { return "" }
        return String(text[range])
    }
}

func koreanCalendar() -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return calendar
}

func listDate(_ suffix: String, now: Date) -> (Date, String)? {
    let calendar = koreanCalendar()
    if let parts = matchParts(#"^(오전|오후)\s*(\d{1,2}):(\d{2})$"#, suffix),
       let hour = Int(parts[1]), let minute = Int(parts[2]), (1...12).contains(hour), minute < 60,
       let date = calendar.date(bySettingHour: hour % 12 + (parts[0] == "오후" ? 12 : 0), minute: minute, second: 0, of: now), date <= now {
        return (date, "minute")
    }
    if suffix == "어제", let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now)) {
        return (yesterday, "day")
    }
    if let parts = matchParts(#"^(\d{1,2})월\s*(\d{1,2})일$"#, suffix), let month = Int(parts[0]), let day = Int(parts[1]) {
        let year = calendar.component(.year, from: now)
        for candidateYear in [year, year - 1] {
            if let date = calendar.date(from: DateComponents(year: candidateYear, month: month, day: day)), date <= now,
               calendar.component(.month, from: date) == month, calendar.component(.day, from: date) == day { return (date, "candidate-day") }
        }
    }
    let formats = ["yyyy. M. d.", "yyyy. MM. dd.", "yyyy년 M월 d일", "yyyy-MM-dd"]
    for format in formats {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = format
        formatter.isLenient = false
        if let date = formatter.date(from: suffix), formatter.string(from: date) == suffix, date <= now { return (date, "day") }
    }
    return nil
}

func parseListHeader(_ header: String, now: Date) -> (String, Date, String)? {
    guard let parts = matchParts(#"^(.+?)\s+((?:오전|오후)\s*\d{1,2}:\d{2}|어제|\d{1,2}월\s*\d{1,2}일|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{4}-\d{2}-\d{2})$"#, header),
          let date = listDate(parts[1], now: now), date.0 >= now.addingTimeInterval(-7 * 86400) else { return nil }
    return (parts[0].trimmingCharacters(in: .whitespaces), date.0, date.1)
}

func listRoom(_ row: AXUIElement, now: Date) -> ListRoom? {
    let fields = directCellChildren(row), texts = fields.filter(staticText)
    guard texts.count == 1, fields.filter({ role($0) == kAXScrollAreaRole }).count == 1,
          fields.filter({ role($0) == kAXButtonRole }).count == 1 else { return nil }
    let images = fields.filter { role($0) == kAXImageRole }.map { string($0, kAXDescriptionAttribute) + " " + string($0, kAXIdentifierAttribute) }
    guard !images.contains(where: { $0.contains("unread") || $0.contains("mention") }) else { return nil }
    let header = metadataText(texts[0])
    guard let parsed = parseListHeader(header, now: now) else { return nil }
    return ListRoom(row: row, header: header, titlePrefix: parsed.0, date: parsed.1, precision: parsed.2, id: digest(kakaoBundle + "|read-list|" + parsed.0))
}

func listRooms(_ root: AXUIElement) throws -> [ListRoom] {
    let main = try mainWindow(root), all = tables(main).flatMap(allRows)
    guard !all.isEmpty else { throw ReviewError(code: "LIST_UNAVAILABLE", message: "대화방 목록을 표시한 뒤 다시 검토해 주세요.") }
    return all.prefix(maxRows).compactMap { listRoom($0, now: Date()) }
}

func freshRoom(_ root: AXUIElement, expected: ListRoom) throws -> ListRoom {
    let matching = try listRooms(root).filter { CFEqual($0.row, expected.row) && $0.id == expected.id && $0.header == expected.header }
    guard matching.count == 1 else { throw ReviewError(code: "UNREAD_OR_UNKNOWN", message: "진입 직전 방의 미읽음·날짜·식별 상태가 바뀌어 건너뜁니다.") }
    return matching[0]
}

func scrollBars(_ element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    if depth > 3 { return [] }
    if role(element) == kAXScrollBarRole { return [element] }
    if [kAXCellRole, kAXTextAreaRole, kAXTextFieldRole, "AXWebArea"].contains(role(element)) { return [] }
    return children(element).flatMap { scrollBars($0, depth: depth + 1) }
}

func scrollPage(_ container: AXUIElement, up: Bool) -> Bool {
    let subrole = up ? "AXDecrementPage" : "AXIncrementPage"
    for bar in scrollBars(container) where string(bar, kAXOrientationAttribute) == "AXVerticalOrientation" {
        if let button = children(bar).first(where: { role($0) == kAXButtonRole && string($0, kAXSubroleAttribute) == subrole }), actionNames(button).contains("AXPress") {
            return AXUIElementPerformAction(button, "AXPress" as CFString) == .success
        }
        let action = up ? "AXDecrement" : "AXIncrement"
        if actionNames(bar).contains(action) { return AXUIElementPerformAction(bar, action as CFString) == .success }
    }
    return false
}

func openReadRoom(_ root: AXUIElement, expected: ListRoom, input: ReviewInputGuard) throws {
    try input.check()
    let room = try freshRoom(root, expected: expected)
    let cell = children(room.row).first { role($0) == kAXCellRole }
    for target in [room.row] + (cell.map { [$0] } ?? []) {
        let allowed = actionNames(target).first { ["AXOpen", "AXPress", "AXConfirm"].contains($0) }
        if let action = allowed {
            try input.check()
            _ = try freshRoom(root, expected: room)
            guard AXUIElementPerformAction(target, action as CFString) == .success else { break }
            return
        }
    }
    try clickReadRoomTitle(root, expected: room, guard: input)
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

func qualifiedRows(_ window: AXUIElement, limit: Int = maxRows) throws -> [(fields: [AXUIElement], date: Date, precision: String)] {
    let cutoff = Date().addingTimeInterval(-7 * 86400)
    let found = tables(window).flatMap { allRows($0).suffix(limit) }.compactMap { row -> ([AXUIElement], Date, String)? in
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
    let loaded = tables(window).flatMap(allRows)
    let boundary = "\(loaded.count)|\(loaded.last.map { String(CFHash($0)) } ?? "none")"
    let signature = digest(boundary + qualified.map { "\(iso($0.date))|\($0.precision)|\($0.fields.map { String(CFHash($0)) }.joined(separator: ","))" }.joined(separator: ";"))
    return ["id": id, "title": title, "unreadCount": 0, "layoutVerified": true, "verifiedAt": iso(Date()), last.precision == "day" ? "lastActivityOn" : "lastActivityAt": last.precision == "day" ? dayString(last.date) : iso(last.date), "activitySignature": signature, "lastInputAt": lastInputAt()]
}

func captureCurrent(limit: Int = maxRows) throws -> [String: Any] {
    let (root, window, title) = try currentContext()
    let before = try metadata(root, window, title)
    let qualified = try qualifiedRows(window, limit: limit)
    let messages = qualified.enumerated().compactMap { index, row -> [String: Any]? in
        let textFields = row.fields.filter { staticText($0) && string($0, kAXHelpAttribute).isEmpty }
        // Continuous rows without an explicit sender are not attributed by guesswork.
        guard textFields.count == 2 else { return nil }
        let sender = metadataText(textFields[0])
        let text = metadataText(textFields[1])
        guard !sender.isEmpty, sender.utf16.count <= 100, !text.isEmpty, text.utf16.count <= 4000 else {
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

func waitForRoom(_ root: AXUIElement, candidate: ListRoom, input: ReviewInputGuard) throws -> (AXUIElement, String) {
    for _ in 0..<12 {
        try input.check()
        if let context = try? currentContext(), headerMatchesTitle(candidate.titlePrefix, context.2) {
            try readState(root, title: context.2)
            return (context.1, context.2)
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    throw ReviewError(code: "ROOM_NOT_OPEN", message: "선택한 읽은 방의 창이 열리지 않아 본문을 수집하지 않았습니다.")
}

func stableMessages(_ roomID: String, messages: [[String: Any]]) -> [[String: Any]] {
    var occurrences: [String: Int] = [:]
    return messages.map { message in
        let parts = [roomID, message["sentAt"] as? String ?? message["sentOn"] as? String ?? "", message["sender"] as? String ?? "", message["text"] as? String ?? ""]
        let base = digest((try? String(data: JSONSerialization.data(withJSONObject: parts), encoding: .utf8)) ?? "")
        let occurrence = occurrences[base] ?? 0
        occurrences = occurrences.merging([base: occurrence + 1]) { _, new in new }
        return message.merging(["id": digest(base + "|" + String(occurrence))]) { _, new in new }
    }
}

func messageSlice(_ messages: [[String: Any]], reviewed: Set<String>, remaining: Int, byteBudget: Int = 60000) -> (messages: [[String: Any]], partial: Bool) {
    let fresh = messages.filter { !reviewed.contains($0["id"] as! String) }
    var limited: [[String: Any]] = [], bytes = 0
    for message in fresh.reversed().prefix(max(0, remaining)) {
        let count = (try? JSONSerialization.data(withJSONObject: message).count) ?? Int.max
        if count > max(0, byteBudget - bytes) { break }
        limited = [message] + limited; bytes += count
    }
    return (limited, limited.count < fresh.count)
}

func primaryScrollArea(_ window: AXUIElement) -> AXUIElement? {
    let candidates = tables(window)
    guard candidates.count == 1, let raw = attribute(candidates[0], kAXParentAttribute), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    let parent = unsafeBitCast(raw, to: AXUIElement.self)
    return role(parent) == kAXScrollAreaRole ? parent : nil
}

func scrollAtBoundary(_ container: AXUIElement, up: Bool) -> Bool {
    let bars = scrollBars(container).filter { string($0, kAXOrientationAttribute) == "AXVerticalOrientation" }
    guard bars.count == 1, let value = attribute(bars[0], kAXValueAttribute) as? NSNumber,
          let edge = attribute(bars[0], up ? kAXMinValueAttribute : kAXMaxValueAttribute) as? NSNumber else { return false }
    return abs(value.doubleValue - edge.doubleValue) < 0.000001
}

func historyReachedBoundary(_ window: AXUIElement) -> Bool {
    let loaded = tables(window).flatMap(allRows)
    guard loaded.count <= 5000 else { return false }
    let dates = loaded.compactMap { timestamp(directCellChildren($0))?.date }
    if dates.contains(where: { $0 < Date().addingTimeInterval(-7 * 86400) }) { return true }
    return primaryScrollArea(window).map { scrollAtBoundary($0, up: true) } ?? false
}

func capturePage(_ root: AXUIElement, candidate: ListRoom, window: AXUIElement, title: String, input: ReviewInputGuard) throws -> ([String: Any], [[String: Any]]) {
    try input.check(); _ = try freshRoom(root, expected: candidate)
    let before = try metadata(root, window, title), body = try captureCurrent(limit: 5000)
    try input.check(); _ = try freshRoom(root, expected: candidate)
    let after = try metadata(root, window, title)
    guard before["activitySignature"] as? String == after["activitySignature"] as? String,
          body["roomId"] as? String == before["id"] as? String,
          let current = try? currentContext(), CFEqual(current.1, window), current.2 == title,
          let messages = body["messages"] as? [[String: Any]], !messages.isEmpty else {
        throw ReviewError(code: "ROOM_CHANGED", message: "새 메시지나 방 상태 변화가 감지되어 해당 방의 수집을 폐기했습니다.")
    }
    return (after, stableMessages(candidate.id, messages: messages))
}

func captureCandidate(_ root: AXUIElement, candidate: ListRoom, input: ReviewInputGuard, remaining: Int, byteBudget: Int, reviewedMessages: Set<String>, deadline: Date) throws -> [String: Any] {
    try openReadRoom(root, expected: candidate, input: input)
    let opened: (AXUIElement, String)
    do { opened = try waitForRoom(root, candidate: candidate, input: input) }
    catch let error as ReviewError where error.code == "ROOM_NOT_OPEN" {
        try clickReadRoomTitle(root, expected: candidate, guard: input)
        opened = try waitForRoom(root, candidate: candidate, input: input)
    }
    var collected: [[String: Any]] = [], seen = reviewedMessages, complete = false, actualMetadata: [String: Any] = [:]
    for _ in 0..<4 {
        guard Date() < deadline else { break }
        let page = try capturePage(root, candidate: candidate, window: opened.0, title: opened.1, input: input)
        actualMetadata = page.0
        let usedBytes = (try? JSONSerialization.data(withJSONObject: collected).count) ?? byteBudget
        let slice = messageSlice(page.1, reviewed: seen, remaining: remaining - collected.count, byteBudget: max(0, byteBudget - usedBytes))
        collected = collected + slice.messages; seen = seen.union(slice.messages.map { $0["id"] as! String })
        if slice.partial { break }
        if historyReachedBoundary(opened.0) { complete = true; break }
        guard collected.count < remaining, let area = primaryScrollArea(opened.0), scrollPage(area, up: true) else { break }
        RunLoop.current.run(until: Date().addingTimeInterval(0.06)); try input.check()
    }
    guard let checkedAt = actualMetadata["verifiedAt"], opened.1.utf16.count <= 160 else { throw ReviewError(code: "SCAN_LIMIT", message: "검토 시간이나 방 식별 범위를 넘어 수집을 중단했습니다.") }
    return ["id": candidate.id, "title": opened.1, "unreadCount": 0, "verifiedAt": checkedAt, "layoutVerified": true,
        actualMetadata["lastActivityAt"] == nil ? "lastActivityOn" : "lastActivityAt": actualMetadata["lastActivityAt"] ?? actualMetadata["lastActivityOn"]!, "messages": collected, "historyComplete": complete]
}

func scanInput() throws -> (rooms: Set<String>, messages: Set<String>) {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty { return ([], []) }
    guard data.count <= 800000, let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys).isSubset(of: ["reviewedRoomIds", "reviewedMessageIds"]),
          let ids = object["reviewedRoomIds"] as? [String], ids.count <= 1000,
          let messages = object["reviewedMessageIds"] as? [String], messages.count <= 10000,
          (ids + messages).allSatisfy({ $0.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }) else {
        throw ReviewError(code: "SCAN_INPUT", message: "이어가기 식별 목록을 확인하지 못했습니다. 좌표·키 입력·임의 대상은 받을 수 없습니다.")
    }
    return (Set(ids), Set(messages))
}

func listSnapshot(_ window: AXUIElement) -> String {
    tables(window).flatMap(allRows).map { row in
        let header = directCellChildren(row).first { staticText($0) }.map(metadataText) ?? ""
        return String(CFHash(row)) + "|" + header
    }.joined(separator: ";")
}

func scrollValue(_ container: AXUIElement) -> Double? {
    let bars = scrollBars(container).filter { string($0, kAXOrientationAttribute) == "AXVerticalOrientation" }
    guard bars.count == 1 else { return nil }
    return (attribute(bars[0], kAXValueAttribute) as? NSNumber)?.doubleValue
}

func nextListPage(_ root: AXUIElement, input: ReviewInputGuard) throws -> String {
    try input.check()
    let main = try mainWindow(root)
    guard let area = primaryScrollArea(main) else { return "unsupported" }
    if scrollAtBoundary(area, up: false) { return "end" }
    let before = listSnapshot(main), beforeValue = scrollValue(area)
    guard scrollPage(area, up: false) else { return "unsupported" }
    RunLoop.current.run(until: Date().addingTimeInterval(0.08))
    try input.check()
    if before != listSnapshot(main) || beforeValue != scrollValue(area) { return "advanced" }
    return scrollAtBoundary(area, up: false) ? "end" : "unsupported"
}

func scanRecent() throws -> [String: Any] {
    let already = try scanInput(), app = try runningApp(), root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 1.0)
    let input = try ReviewInputGuard(), deadline = Date().addingTimeInterval(110)
    var rooms: [[String: Any]] = [], skipped: [[String: String]] = [], seen = already.rooms, seenMessages = already.messages
    var visited = 0, messageCount = 0, complete = false, limited = false
    for page in 0..<scanPageLimit {
        try input.check()
        let candidates = try listRooms(root)
        for candidate in candidates where !seen.contains(candidate.id) {
            if rooms.count >= scanRoomLimit || messageCount >= scanMessageLimit || visited >= 500 || skipped.count >= 100 || Date() >= deadline { limited = true; break }
            if candidates.filter({ $0.titlePrefix == candidate.titlePrefix }).count != 1 { skipped = skipped + [["reason": "같은 이름의 방이 여러 개여서 식별이 불확실한 방을 건너뛰었습니다."]]; continue }
            visited += 1
            do {
                let usedBytes = try JSONSerialization.data(withJSONObject: rooms).count
                let captured = try captureCandidate(root, candidate: candidate, input: input, remaining: scanMessageLimit - messageCount, byteBudget: max(0, scanByteLimit - usedBytes - 2000), reviewedMessages: seenMessages, deadline: deadline)
                let messages = captured["messages"] as? [[String: Any]] ?? [], historyComplete = captured["historyComplete"] as? Bool ?? false
                let proposed = messages.isEmpty ? rooms : rooms + [captured]
                guard try JSONSerialization.data(withJSONObject: proposed).count <= scanByteLimit else { limited = true; break }
                rooms = proposed; if historyComplete { seen = seen.union([candidate.id]) }
                seenMessages = seenMessages.union(messages.compactMap { $0["id"] as? String }); messageCount += messages.count
                if !historyComplete { limited = true; break }
            } catch let error as ReviewError {
                if error.code == "USER_ACTIVE" { throw error }
                skipped = skipped + [["reason": error.message]]
            }
        }
        if limited { break }
        guard Date() < deadline else { break }
        let next = try nextListPage(root, input: input)
        if next == "end" { complete = true; break }
        if next == "unsupported" { skipped = skipped + [["reason": "목록의 끝이나 안전한 다음 페이지 이동을 확인하지 못해 부분 검토로 남겼습니다."]]; break }
        if page == scanPageLimit - 1 { limited = true }
    }
    try input.check()
    return ["rooms": rooms, "skipped": skipped, "complete": complete && !limited, "visited": visited,
        "reviewedRoomIds": Array(seen.subtracting(already.rooms)).sorted(),
        "reviewedMessageIds": rooms.flatMap { ($0["messages"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String } }]
}

func selfTestNavigation() throws -> [String: Any] {
    let now = ISO8601DateFormatter().date(from: "2026-11-01T10:00:00Z")!
    let valid = parseListHeader("검증용 업무방 3 오후 2:41", now: now)
    let many = stableMessages("synthetic-room", messages: (0..<300).map { ["sender": "synthetic", "text": "message \($0)", "sentOn": "2026-11-01", "timePrecision": "day"] })
    let first = messageSlice(many, reviewed: [], remaining: 250)
    let firstIDs = Set(first.messages.map { $0["id"] as! String })
    let second = messageSlice(many, reviewed: firstIDs, remaining: 250)
    let secondIDs = Set(second.messages.map { $0["id"] as! String })
    let checks = [
        valid?.0 == "검증용 업무방 3",
        valid?.2 == "minute",
        valid.map { koreanCalendar().component(.hour, from: $0.1) == 14 } ?? false,
        parseListHeader("검증용 방 오후 11:59", now: now) == nil,
        parseListHeader("검증용 방 어제", now: now)?.2 == "day",
        parseListHeader("검증용 방 2026. 10. 31.", now: now)?.2 == "day",
        parseListHeader("검증용 방 2026. 10. 1.", now: now) == nil,
        parseListHeader("검증용 방 10월 31일", now: now)?.2 == "candidate-day",
        parseListHeader("검증용 방 unknown", now: now) == nil,
        parseListHeader("검증용 방 오후 13:20", now: now) == nil,
        parseListHeader("검증용 방 오전 12:00", now: now).map { koreanCalendar().component(.hour, from: $0.1) == 0 } ?? false,
        !headerMatchesTitle("업무 고객 3", "업무"),
        headerMatchesTitle("업무 고객 3", "업무 고객"),
        !headerMatchesTitle("업무 고객 3", "업무 고객 2"),
        headerMatchesTitle("개인 업무방", "개인 업무방"),
        first.messages.count == 250 && first.partial,
        second.messages.count == 50 && !second.partial,
        firstIDs.intersection(secondIDs).isEmpty,
        firstIDs.union(secondIDs).count == 300,
        messageSlice(many, reviewed: firstIDs.union(secondIDs), remaining: 250).messages.isEmpty,
        parseListHeader("검증용 방 12월 31일", now: ISO8601DateFormatter().date(from: "2027-01-02T10:00:00Z")!).map { dayString($0.1) == "2026-12-31" && $0.2 == "candidate-day" } ?? false,
        messageSlice(many, reviewed: [], remaining: 250, byteBudget: 2000).partial,
    ]
    guard checks.allSatisfy({ $0 }) else { throw ReviewError(code: "NAVIGATION_TEST", message: "순수 날짜·후보 정책 검사 실패") }
    return ["passed": checks.count, "failed": 0, "realAppAccess": false]
}

func withNavigationCancellation(_ operation: () throws -> [String: Any]) throws -> [String: Any] {
    // Main-queue handling cannot interrupt the four synchronous down/up posts halfway.
    let previous = Darwin.signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler {
        FileHandle.standardOutput.write(Data("{\"error\":\"자동 검토를 중지했습니다.\",\"code\":\"STOPPED\"}".utf8))
        exit(2)
    }
    source.resume()
    defer { source.cancel(); Darwin.signal(SIGTERM, previous) }
    return try operation()
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
        let message = !running ? "카카오톡을 직접 열어 주세요." : !trusted ? "손쉬운 사용 권한이 없어 수집할 수 없습니다. 권한은 자동으로 변경하지 않습니다." : !supported ? "이 카카오톡 버전의 읽음 표시 구조를 검증하지 못해 수집할 수 없습니다." : "최근 7일에 교신한 읽은 방을 자동으로 이동하며 검토합니다. 미읽음·날짜·방 식별이 불확실하면 건너뜁니다. 카카오톡 자체의 새 도착 자동 읽음 경쟁은 남아 있습니다."
        return ["connected": running && trusted && supported, "accessibility": trusted, "layoutSupported": supported, "navigationSupported": running && trusted && supported, "mode": "read_rooms", "message": message]
    case "inspect-current":
        let (root, window, title) = try currentContext()
        return try metadata(root, window, title)
    case "capture-current": return try captureCurrent()
    case "scan-recent": return try withNavigationCancellation { try scanRecent() }
    case "self-test-navigation": return try selfTestNavigation()
    default: throw ReviewError(code: "OPERATION", message: "검증된 읽은 방 조회·자동 검토 외 입력·전송은 지원하지 않습니다.")
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
