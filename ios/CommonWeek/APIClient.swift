import Foundation
import Security

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Week of Us returned an unexpected response."
        case .server(let message): message
        case .unauthorized: "Your session expired. Sign in again."
        }
    }
}

struct RealtimeChange: Equatable {
    let table: String?
}

final class APIClient {
    static let shared = APIClient()
    static let authorizationExpired = Notification.Name("CommonWeekAuthorizationExpired")

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let session: URLSession

    var token: String? {
        get { KeychainStore.read("sessionToken") }
        set {
            if let newValue { KeychainStore.write(newValue, key: "sessionToken") }
            else { KeychainStore.delete("sessionToken") }
        }
    }

    let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL? = nil) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
        let configured = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        self.baseURL = baseURL ?? URL(string: configured ?? "https://weekofus.com")!
    }

    func exchange(code: String, state: String) async throws -> NativeSession {
        try await send(path: "/api/ios/auth/exchange", method: "POST", body: ["code": code, "state": state], authenticated: false)
    }

    func signInWithApple(identityToken: String, authorizationCode: String, nonce: String, displayName: String?) async throws -> NativeSession {
        try await send(path: "/api/ios/auth/apple", method: "POST", body: AppleSignInRequest(identityToken: identityToken, authorizationCode: authorizationCode, nonce: nonce, displayName: displayName), authenticated: false)
    }

    func beginGoogleConnection(state: String, calendarWrite: Bool) async throws -> GoogleConnectionStart {
        try await send(path: "/api/ios/google-connect", method: "POST", body: GoogleConnectionRequest(state: state, calendarWrite: calendarWrite))
    }

    func restoreSession() async throws -> SessionIdentity {
        try await send(path: "/api/ios/session")
    }

    func signOut() async {
        let _: EmptyResponse? = try? await send(path: "/api/ios/session", method: "DELETE")
        token = nil
    }

    func deleteAccount() async throws -> EmptyResponse {
        let result: EmptyResponse = try await send(path: "/api/ios/session", method: "POST", body: ["action": "delete-account", "confirmation": "DELETE"])
        token = nil
        await OfflineStore.shared.clearAll()
        return result
    }

    func planner(week: String) async throws -> PlannerPayload {
        try await send(path: "/api/ios/planner", query: [URLQueryItem(name: "week", value: week)])
    }

    func createItem(_ draft: PlanningItemDraft) async throws -> PlanningItem {
        try await send(path: "/api/ios/planning-items", method: "POST", body: draft)
    }

    func updateItem(_ draft: PlanningItemDraft) async throws -> EmptyResponse {
        try await send(path: "/api/ios/planning-items", method: "PATCH", body: draft)
    }

    func toggleItem(id: String, completed: Bool) async throws -> EmptyResponse {
        try await send(path: "/api/ios/planning-items", method: "PATCH", body: ToggleItemRequest(action: "toggle", id: id, completed: completed))
    }

    func deleteItem(id: String) async throws -> EmptyResponse {
        try await send(path: "/api/ios/planning-items", method: "DELETE", body: ["id": id])
    }

    func setLocation(date: String, locationId: String, scope: String) async throws -> EmptyResponse {
        try await send(path: "/api/ios/locations", method: "PATCH", body: ["startDate": date, "locationId": locationId, "scope": scope])
    }

    func setLocation(date: String, result: GeocodingResult, saveForReuse: Bool, scope: String) async throws -> HouseholdLocation {
        try await send(
            path: "/api/ios/locations",
            method: "PATCH",
            body: GeocodedLocationAssignmentRequest(
                date: date,
                scope: scope,
                result: result,
                saveForReuse: saveForReuse
            )
        )
    }

    func searchLocations(_ query: String) async throws -> [GeocodingResult] {
        try await send(path: "/api/ios/locations", query: [URLQueryItem(name: "q", value: query)])
    }

    func hideEvent(_ event: CalendarEvent) async throws -> EmptyResponse {
        let body = HideEventRequest(action: "hide", eventId: event.id, title: event.title, calendarName: event.calendarAlias, eventStart: event.start)
        return try await send(path: "/api/ios/calendar-events", method: "PATCH", body: body)
    }

    func saveEvent(_ draft: CalendarEventDraft, editing: Bool) async throws -> EmptyResponse {
        try await send(path: "/api/ios/calendar-events", method: editing ? "PATCH" : "POST", body: draft)
    }

    func deleteEvent(_ event: CalendarEvent, scope: String = "occurrence") async throws -> EmptyResponse {
        try await send(path: "/api/ios/calendar-events", method: "DELETE", body: DeleteEventRequest(calendarPreferenceId: event.calendarPreferenceId ?? "", providerEventId: event.providerEventId ?? "", etag: event.etag ?? "", recurringEventId: event.recurringEventId, recurringScope: scope))
    }

    func respondToEvent(_ event: CalendarEvent, responseStatus: String) async throws -> EmptyResponse {
        try await send(path: "/api/ios/calendar-events", method: "PATCH", body: EventResponseRequest(action: "respond", calendarPreferenceId: event.calendarPreferenceId ?? "", providerEventId: event.providerEventId ?? "", etag: event.etag ?? "", responseStatus: responseStatus))
    }

    func search(_ query: String) async throws -> [PlannerSearchResult] {
        try await send(path: "/api/ios/search", query: [URLQueryItem(name: "q", value: query)])
    }

    func notificationPreferences() async throws -> NotificationPreferences {
        try await send(path: "/api/ios/notifications")
    }

    func updateNotificationPreferences(_ preferences: NotificationPreferences) async throws -> NotificationPreferences {
        try await send(path: "/api/ios/notifications", method: "PATCH", body: preferences)
    }

    func registerPushDevice(token: String, environment: String) async throws -> EmptyResponse {
        try await send(path: "/api/ios/notifications", method: "POST", body: PushDeviceRequest(deviceToken: token, environment: environment))
    }

    func unregisterPushDevice(token: String) async throws -> EmptyResponse {
        try await send(path: "/api/ios/notifications", method: "DELETE", body: PushDeviceRemovalRequest(deviceToken: token))
    }

    func setCalendarReminder(_ event: CalendarEvent, remindAt: String?) async throws -> NotificationReminder? {
        let response: CalendarReminderResponse = try await send(path: "/api/ios/notifications", method: "PATCH", body: CalendarReminderRequest(action: "calendarReminder", calendarPreferenceId: event.calendarPreferenceId ?? "", providerEventId: event.providerEventId ?? "", remindAt: remindAt))
        return response.reminder
    }

    func updateHousehold(_ household: HouseholdSummary) async throws -> EmptyResponse {
        try await send(path: "/api/ios/settings", method: "PATCH", body: household)
    }

    func householdAction(_ action: String, id: String? = nil, email: String? = nil) async throws -> EmptyResponse {
        try await send(path: "/api/ios/settings", method: "PATCH", body: HouseholdActionRequest(action: action, id: id, email: email))
    }

    func calendarSettings() async throws -> CalendarSettings {
        try await send(path: "/api/ios/settings")
    }

    func refreshGoogleCalendars() async throws -> EmptyResponse {
        try await send(path: "/api/ios/settings", method: "PATCH", body: ["action": "refreshCalendars"])
    }

    func updateCalendarPreference(_ preference: CalendarPreference) async throws -> EmptyResponse {
        try await send(path: "/api/ios/settings", method: "PATCH", body: CalendarPreferenceUpdate(preference))
    }

    func realtimeChanges() -> AsyncThrowingStream<RealtimeChange, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let token else { throw APIError.unauthorized }
                    var request = URLRequest(url: baseURL.appending(path: "/api/realtime"))
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    request.cachePolicy = .reloadIgnoringLocalCacheData
                    request.timeoutInterval = 60 * 60
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
                    if http.statusCode == 401 {
                        self.token = nil
                        NotificationCenter.default.post(name: Self.authorizationExpired, object: nil)
                        throw APIError.unauthorized
                    }
                    guard (200..<300).contains(http.statusCode) else { throw APIError.invalidResponse }

                    var eventName: String?
                    var dataLines: [String] = []
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        if line.isEmpty {
                            if eventName == "change" {
                                let payload = dataLines.joined(separator: "\n").data(using: .utf8) ?? Data()
                                let table = (try? decoder.decode(RealtimePayload.self, from: payload))?.table
                                continuation.yield(RealtimeChange(table: table))
                            }
                            eventName = nil
                            dataLines.removeAll(keepingCapacity: true)
                        } else if line.hasPrefix("event:") {
                            eventName = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataLines.append(line.dropFirst(5).trimmingCharacters(in: .whitespaces))
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    static func isConnectivityFailure(_ error: Error) -> Bool {
        if case APIError.invalidResponse = error { return true }
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .cancelled, .badURL, .unsupportedURL, .userAuthenticationRequired:
            return false
        default:
            return true
        }
    }

    private func send<Response: Decodable>(
        path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: (any Encodable)? = nil,
        authenticated: Bool = true
    ) async throws -> Response {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if authenticated {
            guard let token else { throw APIError.unauthorized }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            token = nil
            NotificationCenter.default.post(name: Self.authorizationExpired, object: nil)
            throw APIError.unauthorized
        }
        let envelope = try decoder.decode(APIEnvelope<Response>.self, from: data)
        guard envelope.ok, let value = envelope.data else {
            if Response.self == EmptyResponse.self, envelope.ok { return EmptyResponse() as! Response }
            throw APIError.server(envelope.error ?? "Week of Us could not complete that request.")
        }
        return value
    }
}

private struct RealtimePayload: Decodable {
    let table: String?
}

private struct AppleSignInRequest: Encodable {
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let displayName: String?
}

private struct GoogleConnectionRequest: Encodable {
    let state: String
    let calendarWrite: Bool
}

private struct HouseholdActionRequest: Encodable {
    let action: String
    let id: String?
    let email: String?
}

private struct HideEventRequest: Encodable {
    let action: String
    let eventId: String
    let title: String
    let calendarName: String
    let eventStart: String
}

private struct ToggleItemRequest: Encodable {
    let action: String
    let id: String
    let completed: Bool
}

private struct DeleteEventRequest: Encodable {
    let calendarPreferenceId: String
    let providerEventId: String
    let etag: String
    let recurringEventId: String?
    let recurringScope: String
}

private struct EventResponseRequest: Encodable {
    let action: String
    let calendarPreferenceId: String
    let providerEventId: String
    let etag: String
    let responseStatus: String
}

private struct PushDeviceRequest: Encodable {
    let deviceToken: String
    let environment: String
}

private struct PushDeviceRemovalRequest: Encodable {
    let deviceToken: String
}

private struct CalendarReminderRequest: Encodable {
    let action: String
    let calendarPreferenceId: String
    let providerEventId: String
    let remindAt: String?
}

private struct CalendarReminderResponse: Decodable {
    let reminder: NotificationReminder?
}

struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = value.encode
    }

    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

private enum KeychainStore {
    static func write(_ value: String, key: String) {
        delete(key)
        let data = Data(value.utf8)
        SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.jimgreco.commonweek",
            kSecAttrAccount: key,
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ] as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.jimgreco.commonweek",
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ] as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: "com.jimgreco.commonweek",
            kSecAttrAccount: key,
        ] as CFDictionary)
    }
}
