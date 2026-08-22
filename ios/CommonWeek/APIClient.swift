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
        self.session = session
        let configured = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        self.baseURL = baseURL ?? URL(string: configured ?? "https://weekofus.com")!
    }

    func exchange(code: String, state: String) async throws -> NativeSession {
        try await send(path: "/api/ios/auth/exchange", method: "POST", body: ["code": code, "state": state], authenticated: false)
    }

    func restoreSession() async throws -> SessionIdentity {
        try await send(path: "/api/ios/session")
    }

    func signOut() async {
        let _: EmptyResponse? = try? await send(path: "/api/ios/session", method: "DELETE")
        token = nil
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

    func deleteEvent(_ event: CalendarEvent) async throws -> EmptyResponse {
        try await send(path: "/api/ios/calendar-events", method: "DELETE", body: DeleteEventRequest(calendarPreferenceId: event.calendarPreferenceId ?? "", providerEventId: event.providerEventId ?? "", etag: event.etag ?? ""))
    }

    func search(_ query: String) async throws -> [PlanningItem] {
        try await send(path: "/api/ios/search", query: [URLQueryItem(name: "q", value: query)])
    }

    func updateHousehold(_ household: HouseholdSummary) async throws -> EmptyResponse {
        try await send(path: "/api/ios/settings", method: "PATCH", body: household)
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
