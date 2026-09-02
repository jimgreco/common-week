import Foundation

struct APIEnvelope<Value: Decodable>: Decodable {
    let ok: Bool
    let data: Value?
    let error: String?
}

struct EmptyResponse: Codable {}

struct NativeSession: Codable {
    let token: String
    let expiresAt: String
}

struct GoogleConnectionStart: Codable {
    let path: String
}

struct SessionIdentity: Codable, Equatable {
    let userId: String
    let email: String
    let displayName: String
    let avatarUrl: URL?
    let householdId: String?
    let role: String?
}

struct PlannerPayload: Codable {
    let planner: WeeklyPlannerData
    let user: SessionIdentity
}

struct WeeklyPlannerData: Codable {
    var household: HouseholdSummary
    let members: [HouseholdMember]
    let weekStart: String
    var days: [DayPlan]
    var weeklyItems: [PlanningItem]
    var locations: [HouseholdLocation]
    let visibleCalendars: [EditableCalendar]?
    let editableCalendars: [EditableCalendar]
    let calendarState: PlannerSourceState
    let weatherState: PlannerSourceState
    let isDemo: Bool
}

struct HouseholdSummary: Codable, Equatable {
    let id: String
    var name: String
    var timezone: String
    var temperatureUnit: TemperatureUnit
}

enum TemperatureUnit: String, Codable, CaseIterable, Identifiable {
    case fahrenheit
    case celsius
    var id: String { rawValue }
    var symbol: String { self == .fahrenheit ? "°F" : "°C" }
}

struct HouseholdMember: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let displayName: String
    let email: String
    let role: String
}

struct PlanningItem: Codable, Identifiable, Hashable {
    let id: String
    var planningDate: String?
    var weekStartDate: String
    var type: PlanningItemType
    var text: String
    var isCompleted: Bool
    var sortOrder: Int
    let createdBy: String
    let createdByName: String?
    let updatedAt: String
    var originalPlanningDate: String? = nil
    var originalWeekStartDate: String? = nil
    var carryoverCount: Int? = nil
    var lastCarriedAt: String? = nil
    let saveState: String?
    let reminder: NotificationReminder?
}

struct NotificationReminder: Codable, Hashable {
    let id: String
    let resourceKind: String
    let remindAt: String
}

struct NotificationPreferences: Codable, Equatable {
    var emailEnabled: Bool
    var pushEnabled: Bool
    var morningDigestEnabled: Bool
    var morningDigestTime: String
    var sundayPlanningEnabled: Bool
    var sundayPlanningTime: String
    var householdChangeAlerts: Bool
}

enum NotificationDeliveryStatus: String, Codable, Hashable {
    case pending
    case sending
    case delivered
    case failed
    case skipped
}

struct NotificationChannelState: Codable, Hashable {
    let status: NotificationDeliveryStatus
    let attempts: Int
    let deliveredAt: String?
    let lastError: String?
}

struct NotificationChannels: Codable, Hashable {
    let email: NotificationChannelState
    let push: NotificationChannelState
}

struct NotificationInboxTarget: Codable, Hashable {
    let kind: String
    let weekStart: String
    let planningItemId: String?
    let calendarPreferenceId: String?
    let providerEventId: String?
}

struct NotificationInboxItem: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let title: String
    let body: String
    let deepLink: String
    let scheduledFor: String
    let createdAt: String
    var readAt: String?
    let channels: NotificationChannels
    let target: NotificationInboxTarget?
}

struct NotificationInbox: Codable, Equatable {
    var items: [NotificationInboxItem]
    var unreadCount: Int
}

enum PlanningItemType: String, Codable, CaseIterable, Identifiable {
    case note
    case task
    var id: String { rawValue }
    var title: String { self == .note ? "Plan" : "Task" }
}

struct HouseholdLocation: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let latitude: Double
    let longitude: Double
    let timezone: String
    let isSaved: Bool
    let isDefault: Bool?
}

struct GeocodingResult: Codable, Identifiable, Hashable, Equatable {
    let id: String
    let name: String
    let admin1: String?
    let country: String?
    let latitude: Double
    let longitude: Double
    let timezone: String

    var assignmentName: String {
        [name, admin1 ?? country]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
            .prefix(120)
            .description
    }

    var detailName: String {
        [admin1, country]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

struct EventLocationSuggestion: Codable, Identifiable, Hashable, Equatable {
    let placeId: String
    let primaryText: String
    let secondaryText: String
    let fullText: String

    var id: String { placeId }
}

struct ResolvedEventLocation: Codable, Equatable {
    let placeId: String
    let location: String
    let formattedAddress: String
}

struct DayPlan: Codable, Identifiable, Hashable {
    var id: String { date }
    let date: String
    var location: HouseholdLocation?
    var weather: DailyWeather?
    var memberLocations: [DayMemberLocation]
    var events: [CalendarEvent]
    var items: [PlanningItem]
}

struct DayMemberLocation: Codable, Hashable, Identifiable {
    var id: String { memberId }
    let memberId: String
    let userId: String
    let displayName: String
    var location: HouseholdLocation?
    var weather: DailyWeather?
}

struct DailyWeather: Codable, Hashable {
    let date: String
    let locationId: String
    let conditionCode: Int
    let highF: Double
    let lowF: Double
    let precipitationProbability: Int
    let precipitationAmount: Double
    let windSpeedMph: Double
    let sunrise: String
    let sunset: String
    let hourly: [HourlyWeather]
    let status: String
    let errorMessage: String?
}

struct HourlyWeather: Codable, Hashable, Identifiable {
    var id: String { time }
    let time: String
    let temperatureF: Double
    let precipitationProbability: Int
    let precipitationAmount: Double
    let windSpeedMph: Double
    let conditionCode: Int
}

struct CalendarEvent: Codable, Identifiable, Hashable {
    let id: String
    let providerEventId: String?
    let sourceUserId: String?
    let calendarPreferenceId: String?
    let etag: String?
    let recurringEventId: String?
    let originalStartTime: String?
    let canEdit: Bool?
    let title: String
    let description: String?
    let location: String?
    let googleUrl: String?
    let start: String
    let end: String
    let allDay: Bool
    let calendarId: String
    let calendarName: String
    let calendarAlias: String
    let calendarColor: String
    let attribution: String
    let sectionGroup: String
    let isConflict: Bool?
    let attendees: [CalendarAttendee]?
    let canRespond: Bool?
    let reminder: NotificationReminder?
}

struct CalendarAttendee: Codable, Hashable, Identifiable {
    var id: String { email }
    let email: String
    let displayName: String?
    let responseStatus: String
    let `self`: Bool?
    let organizer: Bool?
}

struct EditableCalendar: Codable, Identifiable, Hashable {
    let id: String
    let sourceUserId: String?
    let name: String
    let color: String
    let sectionGroup: String
}

struct CalendarSettings: Codable, Equatable {
    var calendars: [CalendarPreference]
    let connected: Bool
    let writeEnabled: Bool
}

struct CalendarPreference: Codable, Identifiable, Equatable {
    let id: String
    let userId: String
    let googleCalendarId: String
    let calendarName: String
    var displayAlias: String?
    var displayAbbreviation: String?
    let color: String
    var visibility: CalendarVisibility
    let isPrimary: Bool
    var sectionGroup: CalendarSectionGroup
    let accessRole: String
}

enum CalendarVisibility: String, Codable, CaseIterable, Identifiable {
    case hide
    case `private`
    case share

    var id: String { rawValue }
    var title: String {
        switch self {
        case .hide: "Hide"
        case .private: "Private"
        case .share: "Share"
        }
    }
}

enum CalendarSectionGroup: String, Codable, CaseIterable, Identifiable {
    case critical
    case supplemental

    var id: String { rawValue }
    var title: String { self == .critical ? "Critical" : "Supplemental" }
}

struct PlannerSourceState: Codable {
    let status: String
    let message: String?
}

struct CalendarEventDraft: Encodable {
    let requestId: String
    let calendarPreferenceId: String
    let sourceCalendarPreferenceId: String?
    let providerEventId: String?
    let etag: String?
    let title: String
    let description: String
    let location: String
    let allDay: Bool
    let startDate: String
    let endDate: String
    let startTime: String
    let endTime: String
    let recurringEventId: String?
    let recurringScope: String?
    let recurrence: CalendarRecurrenceRule?
    let guestEmails: [String]?
}

enum CalendarRecurrenceFrequency: String, Codable, CaseIterable, Identifiable {
    case daily
    case weekly
    case monthly
    case yearly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }

    func unit(interval: Int) -> String {
        let singular = switch self {
        case .daily: "day"
        case .weekly: "week"
        case .monthly: "month"
        case .yearly: "year"
        }
        return interval == 1 ? singular : "\(singular)s"
    }
}

enum CalendarRecurrenceWeekday: String, Codable, CaseIterable, Identifiable {
    case monday = "MO"
    case tuesday = "TU"
    case wednesday = "WE"
    case thursday = "TH"
    case friday = "FR"
    case saturday = "SA"
    case sunday = "SU"

    var id: String { rawValue }

    var shortTitle: String {
        switch self {
        case .monday: "M"
        case .tuesday: "T"
        case .wednesday: "W"
        case .thursday: "T"
        case .friday: "F"
        case .saturday: "S"
        case .sunday: "S"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .monday: "Monday"
        case .tuesday: "Tuesday"
        case .wednesday: "Wednesday"
        case .thursday: "Thursday"
        case .friday: "Friday"
        case .saturday: "Saturday"
        case .sunday: "Sunday"
        }
    }

    static func weekday(for date: Date, timeZoneIdentifier: String) -> CalendarRecurrenceWeekday {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        return switch calendar.component(.weekday, from: date) {
        case 1: .sunday
        case 2: .monday
        case 3: .tuesday
        case 4: .wednesday
        case 5: .thursday
        case 6: .friday
        default: .saturday
        }
    }
}

enum CalendarRecurrenceEnd: String, Codable, CaseIterable, Identifiable {
    case never
    case onDate
    case afterCount

    var id: String { rawValue }

    var title: String {
        switch self {
        case .never: "Never"
        case .onDate: "On date"
        case .afterCount: "After number of events"
        }
    }
}

struct CalendarRecurrenceRule: Codable, Equatable {
    var frequency: CalendarRecurrenceFrequency
    var interval: Int
    var weekdays: [CalendarRecurrenceWeekday]?
    var ends: CalendarRecurrenceEnd
    var untilDate: String?
    var count: Int?
}

enum CalendarGuestEmailError: LocalizedError, Equatable {
    case invalid(String)
    case tooMany

    var errorDescription: String? {
        switch self {
        case .invalid(let email): "Check the guest email address: \(email)"
        case .tooMany: "Invite no more than 200 guests at a time."
        }
    }
}

enum CalendarGuestEmails {
    static func normalize(_ value: String) throws -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        for part in value.split(separator: ",") {
            let email = part.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !email.isEmpty else { continue }
            guard email.range(
                of: #"^[^\s@,]+@[^\s@,]+\.[^\s@,]+$"#,
                options: .regularExpression
            ) != nil else {
                throw CalendarGuestEmailError.invalid(email)
            }
            if seen.insert(email).inserted { result.append(email) }
        }
        guard result.count <= 200 else { throw CalendarGuestEmailError.tooMany }
        return result
    }
}

enum CalendarEventFilter {
    static let allCalendars = "all-calendars"
    static let allPeople = "all-people"

    static func matches(_ event: CalendarEvent, calendarId: String, personId: String) -> Bool {
        let eventCalendarId = event.calendarPreferenceId ?? event.calendarId
        return (calendarId == allCalendars || eventCalendarId == calendarId)
            && (personId == allPeople || event.sourceUserId == personId)
    }

    static func calendars(in data: WeeklyPlannerData) -> [EditableCalendar] {
        if let visibleCalendars = data.visibleCalendars { return visibleCalendars }

        var calendars = data.editableCalendars
        var seen = Set(calendars.map(\.id))
        for event in data.days.flatMap(\.events) {
            let id = event.calendarPreferenceId ?? event.calendarId
            guard seen.insert(id).inserted else { continue }
            calendars.append(EditableCalendar(
                id: id,
                sourceUserId: event.sourceUserId,
                name: event.calendarAlias,
                color: event.calendarColor,
                sectionGroup: event.sectionGroup
            ))
        }
        return calendars
    }
}

struct CalendarPreferenceUpdate: Encodable {
    let action = "updateCalendar"
    let id: String
    let visibility: CalendarVisibility
    let displayAlias: String?
    let displayAbbreviation: String?
    let sectionGroup: CalendarSectionGroup

    init(_ preference: CalendarPreference) {
        id = preference.id
        visibility = preference.visibility
        displayAlias = preference.displayAlias
        displayAbbreviation = preference.displayAbbreviation
        sectionGroup = preference.sectionGroup
    }
}

struct GeocodedLocationAssignmentRequest: Encodable {
    struct Location: Encodable {
        let name: String
        let latitude: Double
        let longitude: Double
        let timezone: String
    }

    let startDate: String
    let memberIds: [String]
    let scope: String
    let saveForReuse: Bool
    let location: Location

    init(date: String, memberIds: [String], scope: String, result: GeocodingResult, saveForReuse: Bool) {
        startDate = date
        self.memberIds = memberIds
        self.scope = scope
        self.saveForReuse = saveForReuse
        location = Location(
            name: result.assignmentName,
            latitude: result.latitude,
            longitude: result.longitude,
            timezone: result.timezone
        )
    }
}

struct SavedLocationAssignmentRequest: Encodable {
    let startDate: String
    let locationId: String
    let memberIds: [String]
    let scope: String
}

struct PlanningItemDraft: Codable, Equatable {
    let id: String?
    let text: String
    let type: PlanningItemType
    let planningDate: String?
    let weekStartDate: String
    let remindAt: String?
}

enum PlannerSearchResult: Codable, Identifiable {
    case planningItem(PlanningItem)
    case calendarEvent(CalendarEvent)

    var id: String {
        switch self {
        case .planningItem(let item): "item:\(item.id)"
        case .calendarEvent(let event): "event:\(event.id)"
        }
    }

    private enum CodingKeys: String, CodingKey { case kind, item, event }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "calendar_event": self = .calendarEvent(try container.decode(CalendarEvent.self, forKey: .event))
        default: self = .planningItem(try container.decode(PlanningItem.self, forKey: .item))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .planningItem(let item):
            try container.encode("planning_item", forKey: .kind)
            try container.encode(item, forKey: .item)
        case .calendarEvent(let event):
            try container.encode("calendar_event", forKey: .kind)
            try container.encode(event, forKey: .event)
        }
    }
}

enum WeekDate {
    private static let utc = TimeZone(secondsFromGMT: 0)!

    static let dateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = utc
        formatter.dateFormat = format
        return formatter
    }

    private static let monthDay = formatter("MMMM d")
    private static let dayOnly = formatter("d")
    private static let longDayStyle = formatter("EEEE, MMMM d")
    private static let shortDayStyle = formatter("EEE d")

    static let iso8601 = ISO8601DateFormatter()

    static func calendarEventDate(_ value: String, timeZoneIdentifier: String) -> Date {
        iso8601.date(from: value)
            ?? calendarDate(value, hour: 12, timeZoneIdentifier: timeZoneIdentifier)
    }

    static func parse(_ value: String) -> Date {
        dateOnly.date(from: String(value.prefix(10))) ?? Date()
    }

    static func string(_ date: Date) -> String { dateOnly.string(from: date) }

    static func calendarDate(
        _ value: String,
        hour: Int = 0,
        minute: Int = 0,
        timeZoneIdentifier: String? = nil
    ) -> Date {
        let values = String(value.prefix(10)).split(separator: "-").compactMap { Int($0) }
        guard values.count == 3 else { return parse(value) }
        var calendar = Calendar(identifier: .iso8601)
        let timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(
            timeZone: timeZone,
            year: values[0],
            month: values[1],
            day: values[2],
            hour: hour,
            minute: minute
        )) ?? parse(value)
    }

    static func string(_ date: Date, timeZoneIdentifier: String) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func isToday(_ value: String, timeZoneIdentifier: String? = nil) -> Bool {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        return String(value.prefix(10)) == formatter.string(from: Date())
    }

    static func monday(containing date: Date = Date()) -> Date {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        return calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
    }

    static func weekStart(for value: String) -> String {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = utc
        return string(calendar.dateInterval(of: .weekOfYear, for: parse(value))?.start ?? parse(value))
    }

    static func today(timeZoneIdentifier: String, now: Date = Date()) -> String {
        string(now, timeZoneIdentifier: timeZoneIdentifier)
    }

    static func currentWeekStart(timeZoneIdentifier: String, now: Date = Date()) -> String {
        weekStart(for: today(timeZoneIdentifier: timeZoneIdentifier, now: now))
    }

    static func addDays(_ days: Int, to value: String) -> String {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = utc
        let date = calendar.date(byAdding: .day, value: days, to: parse(value)) ?? parse(value)
        return string(date)
    }

    static func daysBetween(_ start: String, _ end: String) -> Int {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = utc
        return calendar.dateComponents([.day], from: parse(start), to: parse(end)).day ?? 0
    }

    static func weekTitle(_ value: String) -> String {
        let start = parse(value)
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = utc
        let end = calendar.date(byAdding: .day, value: 6, to: start) ?? start
        let sameMonth = calendar.component(.month, from: start) == calendar.component(.month, from: end)
        let first = monthDay.string(from: start)
        let second = sameMonth ? dayOnly.string(from: end) : monthDay.string(from: end)
        return "\(first)–\(second)"
    }

    static func longDay(_ value: String) -> String {
        longDayStyle.string(from: parse(value))
    }

    static func shortDay(_ value: String) -> String {
        shortDayStyle.string(from: parse(value))
    }

    static func eventTime(_ value: String) -> String {
        guard let date = iso8601.date(from: value) else { return value }
        return date.formatted(date: .omitted, time: .shortened)
    }
}
