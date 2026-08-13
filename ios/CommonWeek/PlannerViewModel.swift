import Foundation

@MainActor
final class PlannerViewModel: ObservableObject {
    @Published var data: WeeklyPlannerData?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var toast: String?
    @Published var searchResults: [PlanningItem] = []
    @Published var isSearching = false

    private let api: APIClient
    private var toastTask: Task<Void, Never>?
    private let isDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] == "1"

    init(api: APIClient = .shared) {
        self.api = api
        if ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] == "1" {
            data = PreviewData.planner
        }
    }

    func load(week: String? = nil, quietly: Bool = false) async {
        if isDemo { data = PreviewData.planner(weekStart: week ?? PreviewData.planner.weekStart); return }
        if !quietly { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }
        do {
            let selected = week ?? data?.weekStart ?? WeekDate.string(WeekDate.monday())
            data = try await api.planner(week: selected).planner
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func moveWeek(by days: Int) async {
        guard let current = data?.weekStart else { return }
        await load(week: WeekDate.addDays(days, to: current))
    }

    func toggle(_ item: PlanningItem) async {
        mutateItem(id: item.id) { $0.isCompleted.toggle() }
        guard !isDemo else { return }
        do {
            _ = try await api.toggleItem(id: item.id, completed: !item.isCompleted)
        } catch {
            mutateItem(id: item.id) { $0.isCompleted = item.isCompleted }
            show(error.localizedDescription)
        }
    }

    func saveItem(_ draft: PlanningItemDraft) async -> Bool {
        if isDemo {
            if let id = draft.id { mutateItem(id: id) { item in
                item.text = draft.text
                item.type = draft.type
            }} else {
                let item = PlanningItem(id: UUID().uuidString, planningDate: draft.planningDate, weekStartDate: draft.weekStartDate, type: draft.type, text: draft.text, isCompleted: false, sortOrder: 0, createdBy: "demo-jim", createdByName: "Jim", updatedAt: ISO8601DateFormatter().string(from: Date()), saveState: "saved")
                insert(item)
            }
            return true
        }
        do {
            if draft.id == nil { _ = try await api.createItem(draft) }
            else { _ = try await api.updateItem(draft) }
            await load(week: draft.weekStartDate, quietly: true)
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func deleteItem(_ item: PlanningItem) async -> Bool {
        if isDemo { removeItem(id: item.id); return true }
        do {
            _ = try await api.deleteItem(id: item.id)
            removeItem(id: item.id)
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func setLocation(_ location: HouseholdLocation, for date: String, scope: String) async -> Bool {
        if isDemo {
            guard var planner = data else { return false }
            let end = scope == "day" ? date : WeekDate.addDays(6, to: planner.weekStart)
            let start = scope == "week" ? planner.weekStart : date
            for index in planner.days.indices where planner.days[index].date >= start && planner.days[index].date <= end {
                planner.days[index].location = location
            }
            data = planner
            return true
        }
        do {
            _ = try await api.setLocation(date: date, locationId: location.id, scope: scope)
            await load(week: data?.weekStart, quietly: true)
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func hideEvent(_ event: CalendarEvent) async -> Bool {
        if isDemo {
            guard var planner = data else { return false }
            for index in planner.days.indices { planner.days[index].events.removeAll { $0.id == event.id } }
            data = planner
            show("Event hidden from Week of Us")
            return true
        }
        do {
            _ = try await api.hideEvent(event)
            await load(week: data?.weekStart, quietly: true)
            show("Event hidden from Week of Us")
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func saveEvent(_ draft: CalendarEventDraft, editing: Bool) async -> Bool {
        if isDemo { show(editing ? "Demo event updated" : "Demo event added"); return true }
        do {
            _ = try await api.saveEvent(draft, editing: editing)
            await load(week: data?.weekStart, quietly: true)
            show(editing ? "Calendar event updated" : "Calendar event added")
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func deleteEvent(_ event: CalendarEvent) async -> Bool {
        if isDemo { return await hideEvent(event) }
        do {
            _ = try await api.deleteEvent(event)
            await load(week: data?.weekStart, quietly: true)
            show("Calendar event deleted")
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func search(_ query: String) async {
        guard query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else { searchResults = []; return }
        isSearching = true
        defer { isSearching = false }
        if isDemo {
            guard let data else { return }
            searchResults = (data.days.flatMap(\.items) + data.weeklyItems).filter { $0.text.localizedCaseInsensitiveContains(query) }
            return
        }
        do { searchResults = try await api.search(query) }
        catch { show(error.localizedDescription) }
    }

    func updateHousehold(_ household: HouseholdSummary) async -> Bool {
        if isDemo {
            updateLocalHousehold(household)
            show("Preferences saved")
            return true
        }
        do {
            _ = try await api.updateHousehold(household)
            updateLocalHousehold(household)
            show("Preferences saved")
            return true
        } catch { show(error.localizedDescription); return false }
    }

    private func mutateItem(id: String, mutation: (inout PlanningItem) -> Void) {
        guard var planner = data else { return }
        for dayIndex in planner.days.indices {
            if let itemIndex = planner.days[dayIndex].items.firstIndex(where: { $0.id == id }) {
                mutation(&planner.days[dayIndex].items[itemIndex])
            }
        }
        if let index = planner.weeklyItems.firstIndex(where: { $0.id == id }) { mutation(&planner.weeklyItems[index]) }
        data = planner
    }

    private func updateLocalHousehold(_ household: HouseholdSummary) {
        guard var planner = data else { return }
        planner.household = household
        data = planner
    }

    private func insert(_ item: PlanningItem) {
        guard var planner = data else { return }
        if let date = item.planningDate, let index = planner.days.firstIndex(where: { $0.date == date }) {
            planner.days[index].items.append(item)
        } else { planner.weeklyItems.append(item) }
        data = planner
    }

    private func removeItem(id: String) {
        guard var planner = data else { return }
        for index in planner.days.indices { planner.days[index].items.removeAll { $0.id == id } }
        planner.weeklyItems.removeAll { $0.id == id }
        data = planner
    }

    private func show(_ message: String) {
        toastTask?.cancel()
        toast = message
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }
}
