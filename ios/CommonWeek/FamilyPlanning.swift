import Foundation

struct ChildProfile: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var color: String
    var calendarPreferenceIds: [String]
}

struct AdultCalendarAssignment: Codable, Identifiable, Equatable {
    var id: String { userId }
    let userId: String
    let displayName: String
    var calendarPreferenceIds: [String]
}

struct TaskRoutine: Codable, Identifiable, Hashable {
    var assignedMemberIds: [String]? = nil
    let id: String
    var text: String
    var childId: String?
    var frequency: String
    var interval: Int
    var weekdays: [Int]
    var startsOn: String
    var endsOn: String?
    var active: Bool

    var scheduleDescription: String {
        let cadence = frequency == "daily"
            ? (interval == 1 ? "Every day" : "Every \(interval) days")
            : (interval == 1 ? "Every week" : "Every \(interval) weeks")
        guard !weekdays.isEmpty else { return frequency == "daily" ? cadence : "\(cadence) · whole-week task" }
        let days = weekdays.sorted().compactMap { Self.weekdayNames.indices.contains($0) ? Self.weekdayNames[$0] : nil }
        return "\(cadence) · \(days.joined(separator: ", "))"
    }

    static let weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
}

struct WeekTemplate: Codable, Identifiable, Hashable {
    struct Item: Codable, Hashable {
        let dayOffset: Int?
        let type: PlanningItemType
        let text: String
        let childId: String?
        var assignedMemberIds: [String]? = nil
    }
    let id: String
    let name: String
    let items: [Item]
    let appliedToWeek: Bool
}

struct WeeklyReview: Codable, Equatable {
    struct Reviewer: Codable, Identifiable, Equatable {
        var id: String { userId }
        let userId: String
        let displayName: String
        let reviewedAt: String

        var date: Date? {
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fractional.date(from: reviewedAt) ?? WeekDate.iso8601.date(from: reviewedAt)
        }
    }
    let weekStart: String
    var priorities: String
    var meals: String
    var logistics: String
    let revision: Int
    let reviewedBy: [Reviewer]
}

struct FamilyPlanningData: Codable, Equatable {
    let weekStart: String
    let currentUserId: String
    let canEdit: Bool
    var children: [ChildProfile]
    var routines: [TaskRoutine]
    var templates: [WeekTemplate]
    var review: WeeklyReview
    var openTasks: [PlanningItem]? = nil
    var adults: [AdultCalendarAssignment]? = nil
}

struct FamilyPlanningMutation: Encodable {
    let action: String
    let weekStart: String
    var id: String? = nil
    var child: ChildProfile? = nil
    var routine: TaskRoutine? = nil
    var name: String? = nil
    var priorities: String? = nil
    var meals: String? = nil
    var logistics: String? = nil
    var revision: Int? = nil
    var reviewed: Bool? = nil
    var sourceItemId: String? = nil
    var userId: String? = nil
    var calendarPreferenceIds: [String]? = nil
}

enum ChildSchedule {
    static func events(for child: ChildProfile, in day: DayPlan) -> [CalendarEvent] {
        day.events.filter { event in
            event.assignedMemberIds?.contains(child.id) ?? (event.calendarPreferenceId.map(child.calendarPreferenceIds.contains) ?? false)
        }
    }

    static func items(for child: ChildProfile, in items: [PlanningItem]) -> [PlanningItem] {
        items.filter { ($0.assignedMemberIds ?? $0.childId.map { [$0] } ?? []).contains(child.id) }
    }
}

@MainActor
final class FamilyPlanningStore: ObservableObject {
    @Published private(set) var data: FamilyPlanningData?
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published var error: String?
    @Published private(set) var notice: String?
    let weekStart: String
    private let api: APIClient
    private let isDemo: Bool
    private weak var plannerViewModel: PlannerViewModel?

    init(weekStart: String, isDemo: Bool = false, api: APIClient = .shared, plannerViewModel: PlannerViewModel? = nil) {
        self.weekStart = weekStart
        self.isDemo = isDemo
        self.api = api
        self.plannerViewModel = plannerViewModel
    }

    func load() async {
        guard !isLoading, !isSaving else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let result = isDemo ? Self.demo(weekStart: weekStart) : try await api.familyPlanning(week: weekStart)
            guard result.weekStart == weekStart else { throw APIError.invalidResponse }
            data = result
            error = nil
        } catch {
            self.error = APIClient.isConnectivityFailure(error)
                ? "Connect to the internet to load family planning. Shared tasks still support offline editing in your planner."
                : error.localizedDescription
        }
    }

    @discardableResult
    func save(_ mutation: FamilyPlanningMutation) async -> Bool {
        guard mutation.weekStart == weekStart, !isSaving else { return false }
        guard data?.canEdit == true else { error = "You do not have permission to change family planning."; return false }
        isSaving = true
        notice = nil
        defer { isSaving = false }
        do {
            let result = isDemo ? try applyDemo(mutation) : try await api.mutateFamilyPlanning(mutation)
            guard result.weekStart == weekStart, result.currentUserId == data?.currentUserId else { throw APIError.invalidResponse }
            data = result
            error = nil
            notice = "Saved to your household"
            return true
        } catch {
            self.error = APIClient.isConnectivityFailure(error)
                ? "This change has not been confirmed. Reconnect and try again; your entries are still here."
                : error.localizedDescription
            return false
        }
    }

    private func applyDemo(_ mutation: FamilyPlanningMutation) throws -> FamilyPlanningData {
        FamilyPlanningDemo.shared.capture(plannerViewModel?.data)
        let result = try FamilyPlanningDemo.shared.apply(mutation)
        plannerViewModel?.data = FamilyPlanningDemo.shared.planner(weekStart: weekStart)
        return result
    }

    static func demo(weekStart: String) -> FamilyPlanningData {
        FamilyPlanningDemo.shared.data(weekStart: weekStart)
    }
}

enum WorkspaceTaskSort: String, CaseIterable, Identifiable {
    case defaultOrder = "Default order", deadline = "Deadline", planned = "Planned date", name = "Task name"
    var id: String { rawValue }
}

struct WorkspaceTask: Codable, Identifiable, Hashable {
    let id: String
    var text: String
    var type: String
    var responsibleMemberId: String?
    var deadline: String?
    var isBacklog: Bool
    var planningDate: String?
    var weekStartDate: String
    var isCompleted: Bool

    static func deadlineDate(daysFromToday: Int, timeZoneIdentifier: String, now: Date = Date()) -> String {
        WeekDate.addDays(daysFromToday, to: WeekDate.string(now, timeZoneIdentifier: timeZoneIdentifier))
    }

    static func sorted(_ tasks: [WorkspaceTask], by sort: WorkspaceTaskSort) -> [WorkspaceTask] {
        guard sort != .defaultOrder else { return tasks }
        func dateKey(_ task: WorkspaceTask) -> String? {
            sort == .deadline ? task.deadline : task.isBacklog ? nil : task.planningDate ?? task.weekStartDate
        }
        return tasks.sorted { left, right in
            if sort != .name {
                let a = dateKey(left), b = dateKey(right)
                if a != b {
                    guard let a else { return false }
                    guard let b else { return true }
                    return a < b
                }
            }
            let nameOrder = left.text.trimmingCharacters(in: .whitespacesAndNewlines).compare(
                right.text.trimmingCharacters(in: .whitespacesAndNewlines),
                options: [.caseInsensitive, .diacriticInsensitive, .numeric], locale: Locale(identifier: "en"))
            if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
            return left.id < right.id
        }
    }

    func matches(_ filter: String, userId: String, today: String, query: String = "") -> Bool {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard search.isEmpty || text.lowercased().contains(search) else { return false }
        if filter == "Completed" { return isCompleted }
        if isCompleted { return false }
        switch filter {
        case "Mine": return responsibleMemberId == userId
        case "Unassigned": return responsibleMemberId == nil
        case "Backlog": return isBacklog
        case "No deadline": return deadline == nil
        case "Overdue": return deadline.map { $0 < today } ?? false
        case "Due today": return deadline == today
        case "Due soon": return deadline.map { $0 >= today && $0 <= WeekDate.addDays(6, to: today) } ?? false
        default: return true
        }
    }
}
struct WorkspaceEntry: Codable, Identifiable {
    let id: String
    let kind: String
    let text: String
    var completed: Bool
    let createdBy: String?
    let author: String
    let createdAt: String
}
struct TaskWorkspacePayload: Codable {
    var tasks: [WorkspaceTask]
    var entries: [WorkspaceEntry]
    var task: WorkspaceTask?
}
enum WorkspaceValue: Encodable {
    case string(String), bool(Bool), null, object([String: WorkspaceValue])
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .object(let value): try container.encode(value)
        }
    }
    var stringValue: String? { if case .string(let value) = self { return value }; return nil }
    var boolValue: Bool? { if case .bool(let value) = self { return value }; return nil }
}

/// An interrupted response must not turn a retry into another task, comment, or file.
struct WorkspaceCreateAttempts {
    private var attempts: [Data: String] = [:]

    mutating func prepare(_ input: [String: WorkspaceValue]) throws -> [String: WorkspaceValue] {
        guard ["capture", "add"].contains(input["action"]?.stringValue ?? "") else { return input }
        let signature = try signature(input)
        let id = attempts[signature] ?? input["id"]?.stringValue ?? UUID().uuidString
        attempts[signature] = id
        var body = input
        body["id"] = .string(id)
        return body
    }

    mutating func complete(_ input: [String: WorkspaceValue]) {
        guard let signature = try? signature(input), attempts[signature] == input["id"]?.stringValue else { return }
        attempts[signature] = nil
    }

    private func signature(_ input: [String: WorkspaceValue]) throws -> Data {
        var body = input
        body["id"] = nil
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return try encoder.encode(body)
    }
}
