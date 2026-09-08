import Foundation

struct ChildProfile: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var color: String
    var calendarPreferenceIds: [String]
}

struct TaskRoutine: Codable, Identifiable, Hashable {
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
}

enum ChildSchedule {
    static func events(for child: ChildProfile, in day: DayPlan) -> [CalendarEvent] {
        day.events.filter { event in
            event.calendarPreferenceId.map(child.calendarPreferenceIds.contains) ?? false
        }
    }

    static func items(for child: ChildProfile, in items: [PlanningItem]) -> [PlanningItem] {
        items.filter { $0.childId == child.id }
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
