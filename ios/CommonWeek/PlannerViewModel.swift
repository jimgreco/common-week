import Foundation

@MainActor
final class PlannerViewModel: ObservableObject {
    @Published var data: WeeklyPlannerData?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var toast: String?
    @Published var searchResults: [PlannerSearchResult] = []
    @Published var isSearching = false
    @Published private(set) var isOffline = false
    @Published private(set) var pendingChangeCount = 0

    private let api: APIClient
    private let offlineStore: OfflineStore
    private var activeUser: SessionIdentity?
    private var toastTask: Task<Void, Never>?
    private var liveTask: Task<Void, Never>?
    private var liveRefreshTask: Task<Void, Never>?
    private var syncInProgress = false
    private var followsCurrentWeek = true
    private let isDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] == "1"

    var syncStatusText: String? {
        if pendingChangeCount > 0 {
            return isOffline
                ? "Offline · \(pendingChangeCount) change\(pendingChangeCount == 1 ? "" : "s") waiting to sync"
                : "Syncing \(pendingChangeCount) change\(pendingChangeCount == 1 ? "" : "s")…"
        }
        return isOffline ? "Offline · showing the last saved planner" : nil
    }

    init(api: APIClient = .shared, offlineStore: OfflineStore = OfflineStore()) {
        self.api = api
        self.offlineStore = offlineStore
        if isDemo { data = PreviewData.planner }
    }

    func activate(user: SessionIdentity) async {
        guard !isDemo else { return }
        if activeUser?.userId != user.userId {
            stopLiveUpdates()
            data = nil
            errorMessage = nil
            followsCurrentWeek = true
        }
        activeUser = user
        let latest: WeeklyPlannerData?
        if let data {
            latest = data
        } else {
            latest = await offlineStore.latestCachedPlanner(userId: user.userId, before: nil)
        }
        let timeZone = latest?.household.timezone ?? TimeZone.current.identifier
        let selectedWeek = followsCurrentWeek
            ? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
            : data?.weekStart ?? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
        if data == nil {
            if let cached = await offlineStore.cachedPlanner(userId: user.userId, weekStart: selectedWeek) {
                let current = WeekDate.currentWeekStart(timeZoneIdentifier: cached.household.timezone)
                data = selectedWeek == current
                    ? cached.carryingOpenTasks(to: WeekDate.today(timeZoneIdentifier: cached.household.timezone))
                    : cached
            } else if followsCurrentWeek, let latest {
                data = latest.carryingOpenTasks(
                    to: WeekDate.today(timeZoneIdentifier: latest.household.timezone)
                )
            }
        }
        if data != nil {
            isOffline = true
        }
        pendingChangeCount = await offlineStore.pendingMutations(userId: user.userId).count
        await load(week: selectedWeek, quietly: data != nil)
        if followsCurrentWeek,
           let planner = data,
           planner.weekStart != WeekDate.currentWeekStart(timeZoneIdentifier: planner.household.timezone) {
            await load(
                week: WeekDate.currentWeekStart(timeZoneIdentifier: planner.household.timezone),
                quietly: true
            )
        }
        startLiveUpdates()
    }

    func deactivate() {
        stopLiveUpdates()
        activeUser = nil
        data = nil
        errorMessage = nil
        isOffline = false
        pendingChangeCount = 0
        followsCurrentWeek = true
    }

    func load(week: String? = nil, quietly: Bool = false) async {
        if isDemo { data = PreviewData.planner(weekStart: week ?? PreviewData.planner.weekStart); return }
        guard let user = activeUser else { return }
        if syncInProgress { return }
        let selected = week ?? data?.weekStart ?? WeekDate.string(WeekDate.monday())
        if data?.weekStart != selected {
            if let cached = await offlineStore.cachedPlanner(userId: user.userId, weekStart: selected) {
                let current = WeekDate.currentWeekStart(timeZoneIdentifier: cached.household.timezone)
                data = selected == current
                    ? cached.carryingOpenTasks(to: WeekDate.today(timeZoneIdentifier: cached.household.timezone))
                    : cached
            } else if followsCurrentWeek,
                      let latest = await offlineStore.latestCachedPlanner(userId: user.userId, before: selected),
                      selected == WeekDate.currentWeekStart(timeZoneIdentifier: latest.household.timezone) {
                data = latest.carryingOpenTasks(
                    to: WeekDate.today(timeZoneIdentifier: latest.household.timezone)
                )
            } else {
                data = nil
            }
        }
        if !quietly && data == nil { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        guard await flushPendingChanges() else {
            isOffline = true
            if data == nil { errorMessage = PlatformCopy.offlinePlannerUnavailable }
            return
        }
        do {
            let planner = try await api.planner(week: selected).planner
            data = planner
            try? await offlineStore.savePlanner(planner, userId: user.userId)
            isOffline = false
        } catch {
            if APIClient.isConnectivityFailure(error) {
                isOffline = true
                if data == nil,
                   let cached = await offlineStore.cachedPlanner(userId: user.userId, weekStart: selected) {
                    data = cached
                }
            }
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    func moveWeek(by days: Int) async {
        guard let current = data?.weekStart else { return }
        await move(toWeek: WeekDate.addDays(days, to: current))
    }

    func move(toWeek target: String) async {
        let timeZone = data?.household.timezone ?? TimeZone.current.identifier
        followsCurrentWeek = target == WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
        await load(week: target)
    }

    func moveToCurrentWeek() async {
        followsCurrentWeek = true
        let timeZone = data?.household.timezone ?? TimeZone.current.identifier
        await load(week: WeekDate.currentWeekStart(timeZoneIdentifier: timeZone))
    }

    func toggle(_ item: PlanningItem) async {
        mutateItem(id: item.id) { $0.isCompleted.toggle() }
        persistCurrentPlanner()
        guard !isDemo else { return }
        do {
            _ = try await api.toggleItem(id: item.id, completed: !item.isCompleted)
            await refreshAfterMutation(week: item.weekStartDate)
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .toggleItem, itemId: item.id, completed: !item.isCompleted)
            if await enqueue(mutation) { markSavedOffline() }
            else { mutateItem(id: item.id) { $0.isCompleted = item.isCompleted } }
        } catch {
            mutateItem(id: item.id) { $0.isCompleted = item.isCompleted }
            show(error.localizedDescription)
        }
    }

    func saveItem(_ draft: PlanningItemDraft) async -> Bool {
        if isDemo {
            applyDraft(draft, id: draft.id ?? UUID().uuidString, saveState: "saved")
            return true
        }
        let onlineDraft = PlanningItemDraft(
            id: draft.id ?? UUID().uuidString,
            text: draft.text,
            type: draft.type,
            planningDate: draft.planningDate,
            weekStartDate: draft.weekStartDate,
            remindAt: draft.remindAt
        )
        let previous = onlineDraft.id.flatMap(item(withId:))
        applyDraft(onlineDraft, id: onlineDraft.id!, saveState: "saving")
        persistCurrentPlanner()
        do {
            if draft.id == nil { _ = try await api.createItem(onlineDraft) }
            else { _ = try await api.updateItem(onlineDraft) }
            applyDraft(onlineDraft, id: onlineDraft.id!, saveState: "saved")
            persistCurrentPlanner()
            show(onlineDraft.type == .task ? "Task saved" : "Plan saved")
            scheduleRefreshAfterMutation(week: draft.weekStartDate)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: draft.id == nil ? .createItem : .updateItem, draft: onlineDraft)
            if await enqueue(mutation) {
                markSavedOffline()
                return true
            }
        } catch {
            show(error.localizedDescription)
            removeItem(id: onlineDraft.id!)
            if let previous { insert(previous) }
            persistCurrentPlanner()
            return false
        }
        removeItem(id: onlineDraft.id!)
        if let previous { insert(previous) }
        persistCurrentPlanner()
        return false
    }

    func deleteItem(_ item: PlanningItem) async -> Bool {
        removeItem(id: item.id)
        persistCurrentPlanner()
        if isDemo { return true }
        do {
            _ = try await api.deleteItem(id: item.id)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            if await enqueue(OfflineMutation(kind: .deleteItem, itemId: item.id)) {
                markSavedOffline()
                return true
            }
        } catch {
            show(error.localizedDescription)
        }
        insert(item)
        persistCurrentPlanner()
        return false
    }

    func setLocation(_ location: HouseholdLocation, for date: String, memberIds: [String], scope: String) async -> Bool {
        let previous = data
        applyLocation(location, for: date, memberIds: memberIds, scope: scope)
        persistCurrentPlanner()
        if isDemo { return true }
        do {
            _ = try await api.setLocation(date: date, locationId: location.id, memberIds: memberIds, scope: scope)
            await refreshAfterMutation(week: data?.weekStart)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .assignSavedLocation, startDate: date, scope: scope, locationId: location.id, memberIds: memberIds)
            if await enqueue(mutation) { markSavedOffline(); return true }
        } catch { show(error.localizedDescription) }
        data = previous
        return false
    }

    func setLocation(_ result: GeocodingResult, for date: String, memberIds: [String], scope: String, saveForReuse: Bool) async -> Bool {
        let previous = data
        let localLocation = HouseholdLocation(
            id: "offline-\(UUID().uuidString)",
            name: result.assignmentName,
            latitude: result.latitude,
            longitude: result.longitude,
            timezone: result.timezone,
            isSaved: false,
            isDefault: false
        )
        applyLocation(localLocation, for: date, memberIds: memberIds, scope: scope)
        persistCurrentPlanner()
        if isDemo { return true }
        do {
            _ = try await api.setLocation(date: date, result: result, memberIds: memberIds, saveForReuse: saveForReuse, scope: scope)
            await refreshAfterMutation(week: data?.weekStart)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .assignGeocodedLocation, startDate: date, scope: scope, memberIds: memberIds, location: result, saveForReuse: saveForReuse)
            if await enqueue(mutation) { markSavedOffline(); return true }
        } catch { show(error.localizedDescription) }
        data = previous
        return false
    }

    func findLocations(matching query: String) async throws -> [GeocodingResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }
        if isDemo {
            return PreviewData.locationSearchResults.filter {
                $0.assignmentName.localizedCaseInsensitiveContains(trimmed)
                    || $0.detailName.localizedCaseInsensitiveContains(trimmed)
            }
        }
        return try await api.searchLocations(trimmed)
    }

    func findEventLocations(matching query: String, sessionToken: String, bias: HouseholdLocation?) async throws -> [EventLocationSuggestion] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }
        if isDemo {
            let normalizedQuery = trimmed.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            return PreviewData.eventLocationSuggestions.filter {
                $0.fullText
                    .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                    .contains(normalizedQuery)
            }
        }
        return try await api.searchEventLocations(trimmed, sessionToken: sessionToken, bias: bias)
    }

    func resolveEventLocation(_ suggestion: EventLocationSuggestion, sessionToken: String) async throws -> ResolvedEventLocation {
        if isDemo {
            return ResolvedEventLocation(placeId: suggestion.placeId, location: suggestion.fullText, formattedAddress: suggestion.secondaryText)
        }
        return try await api.resolveEventLocation(suggestion, sessionToken: sessionToken)
    }

    // Google Calendar mutations stay online-only: queuing stale ETags could
    // overwrite a provider-side change made while this device was offline.
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
            await refreshAfterMutation(week: data?.weekStart)
            show("Event hidden from Week of Us")
            return true
        } catch { show(APIClient.isConnectivityFailure(error) ? "Connect to the internet to change calendar events." : error.localizedDescription); return false }
    }

    func saveEvent(_ draft: CalendarEventDraft, editing: Bool) async -> Bool {
        if isDemo { show(editing ? "Demo event updated" : "Demo event added"); return true }
        do {
            _ = try await api.saveEvent(draft, editing: editing)
            await refreshAfterMutation(week: data?.weekStart)
            show(editing ? "Calendar event updated" : "Calendar event added")
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            // For calendar events, we don't queue them offline since they're tied to Google Calendar
            show("Connect to the internet to change calendar events.")
            return false
        } catch {
            show(APIClient.isConnectivityFailure(error) ? "Connect to the internet to change calendar events." : error.localizedDescription)
            return false
        }
    }

    func deleteEvent(_ event: CalendarEvent, scope: String = "occurrence") async -> Bool {
        if isDemo { return await hideEvent(event) }
        do {
            _ = try await api.deleteEvent(event, scope: scope)
            await refreshAfterMutation(week: data?.weekStart)
            show("Calendar event deleted")
            return true
        } catch { show(APIClient.isConnectivityFailure(error) ? "Connect to the internet to change calendar events." : error.localizedDescription); return false }
    }

    func respondToEvent(_ event: CalendarEvent, responseStatus: String) async -> Bool {
        if isDemo { show("Calendar response saved"); return true }
        do {
            _ = try await api.respondToEvent(event, responseStatus: responseStatus)
            await refreshAfterMutation(week: data?.weekStart)
            show("Calendar response saved")
            return true
        } catch { show(APIClient.isConnectivityFailure(error) ? "Connect to the internet to respond." : error.localizedDescription); return false }
    }

    func setCalendarReminder(_ event: CalendarEvent, remindAt: String?) async -> NotificationReminder? {
        if isDemo { return remindAt.map { NotificationReminder(id: "demo-reminder", resourceKind: "calendar_event", remindAt: $0) } }
        do {
            let reminder = try await api.setCalendarReminder(event, remindAt: remindAt)
            show(remindAt == nil ? "Reminder removed" : "Reminder saved")
            return reminder
        } catch { show(error.localizedDescription); return event.reminder }
    }

    func search(_ query: String) async {
        guard query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else { searchResults = []; return }
        isSearching = true
        defer { isSearching = false }
        if isDemo {
            guard let data else { return }
            searchResults = data.days.flatMap(\.events).filter { $0.title.localizedCaseInsensitiveContains(query) }.map(PlannerSearchResult.calendarEvent)
                + (data.days.flatMap(\.items) + data.weeklyItems).filter { $0.text.localizedCaseInsensitiveContains(query) }.map(PlannerSearchResult.planningItem)
            return
        }
        do { searchResults = try await api.search(query) }
        catch { show(error.localizedDescription) }
    }

    func updateHousehold(_ household: HouseholdSummary) async -> Bool {
        if isDemo { updateLocalHousehold(household); show("Preferences saved"); return true }
        do {
            _ = try await api.updateHousehold(household)
            updateLocalHousehold(household)
            persistCurrentPlanner()
            show("Preferences saved")
            return true
        } catch { show(error.localizedDescription); return false }
    }

    func startLiveUpdates() {
        guard !isDemo, liveTask == nil, let userId = activeUser?.userId else { return }
        liveTask = Task { [weak self] in
            var retryDelay = 1.0
            while !Task.isCancelled, self?.activeUser?.userId == userId {
                do {
                    guard let self else { return }
                    for try await _ in api.realtimeChanges() {
                        guard !Task.isCancelled else { return }
                        retryDelay = 1
                        scheduleLiveRefresh()
                    }
                } catch is CancellationError {
                    return
                } catch APIError.unauthorized {
                    return
                } catch {
                    try? await Task.sleep(for: .seconds(retryDelay))
                    retryDelay = min(retryDelay * 2, 30)
                }
            }
        }
    }

    func stopLiveUpdates() {
        liveTask?.cancel()
        liveTask = nil
        liveRefreshTask?.cancel()
        liveRefreshTask = nil
    }

    func applicationDidBecomeActive() {
        guard activeUser != nil else { return }
        startLiveUpdates()
        Task {
            let timeZone = data?.household.timezone ?? TimeZone.current.identifier
            let week = followsCurrentWeek
                ? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
                : data?.weekStart
            await load(week: week, quietly: true)
        }
    }

    func applicationDidEnterBackground() {
        stopLiveUpdates()
    }

    func performBackgroundRefresh() async -> Bool {
        guard !isDemo else { return true }
        if activeUser == nil {
            guard let restored = try? await api.restoreSession(), restored.householdId != nil else { return false }
            activeUser = restored
        }
        guard let user = activeUser, await flushPendingChanges() else { return false }
        do {
            let timeZone = data?.household.timezone ?? TimeZone.current.identifier
            let week = followsCurrentWeek
                ? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
                : data?.weekStart ?? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
            let planner = try await api.planner(week: week).planner
            data = planner
            try await offlineStore.savePlanner(planner, userId: user.userId)
            isOffline = false
            return true
        } catch {
            if APIClient.isConnectivityFailure(error) { isOffline = true }
            return false
        }
    }

    private func scheduleLiveRefresh() {
        liveRefreshTask?.cancel()
        liveRefreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let self else { return }
            await load(week: data?.weekStart, quietly: true)
        }
    }

    private func refreshAfterMutation(week: String?) async {
        await load(week: week ?? data?.weekStart, quietly: true)
    }

    private func scheduleRefreshAfterMutation(week: String?) {
        Task { [weak self] in
            await self?.refreshAfterMutation(week: week)
        }
    }

    private func flushPendingChanges() async -> Bool {
        guard !syncInProgress, let user = activeUser else { return syncInProgress }
        syncInProgress = true
        defer { syncInProgress = false }
        let mutations = await offlineStore.pendingMutations(userId: user.userId)
        pendingChangeCount = mutations.count
        for mutation in mutations {
            do {
                try await execute(mutation)
                try await offlineStore.removeMutation(mutation.id, userId: user.userId)
                pendingChangeCount -= 1
            } catch where APIClient.isConnectivityFailure(error) {
                isOffline = true
                return false
            } catch APIError.unauthorized {
                return false
            } catch {
                try? await offlineStore.removeMutation(mutation.id, userId: user.userId)
                pendingChangeCount -= 1
                show("One offline change could not be applied.")
            }
        }
        return true
    }

    private func execute(_ mutation: OfflineMutation) async throws {
        switch mutation.kind {
        case .createItem:
            guard let draft = mutation.draft else { throw APIError.invalidResponse }
            _ = try await api.createItem(draft)
        case .updateItem:
            guard let draft = mutation.draft else { throw APIError.invalidResponse }
            _ = try await api.updateItem(draft)
        case .toggleItem:
            guard let id = mutation.itemId, let completed = mutation.completed else { throw APIError.invalidResponse }
            _ = try await api.toggleItem(id: id, completed: completed)
        case .deleteItem:
            guard let id = mutation.itemId else { throw APIError.invalidResponse }
            _ = try await api.deleteItem(id: id)
        case .assignSavedLocation:
            guard let date = mutation.startDate, let scope = mutation.scope, let id = mutation.locationId else { throw APIError.invalidResponse }
            let memberIds = mutation.memberIds ?? data?.members.map(\.id) ?? []
            _ = try await api.setLocation(date: date, locationId: id, memberIds: memberIds, scope: scope)
        case .assignGeocodedLocation:
            guard let date = mutation.startDate, let scope = mutation.scope, let location = mutation.location else { throw APIError.invalidResponse }
            let memberIds = mutation.memberIds ?? data?.members.map(\.id) ?? []
            _ = try await api.setLocation(date: date, result: location, memberIds: memberIds, saveForReuse: mutation.saveForReuse ?? true, scope: scope)
        }
    }

    private func enqueue(_ mutation: OfflineMutation) async -> Bool {
        guard let user = activeUser else { return false }
        do {
            try await offlineStore.enqueue(mutation, userId: user.userId)
            pendingChangeCount = await offlineStore.pendingMutations(userId: user.userId).count
            return true
        } catch {
            show("This change could not be saved offline.")
            return false
        }
    }

    private func markSavedOffline() {
        isOffline = true
        persistCurrentPlanner()
        show("Saved offline · will sync automatically")
    }

    private func persistCurrentPlanner() {
        guard let user = activeUser, let data else { return }
        let savedAt = Date()
        Task { try? await offlineStore.savePlanner(data, userId: user.userId, savedAt: savedAt) }
    }

    private func item(withId id: String) -> PlanningItem? {
        guard let data else { return nil }
        return (data.days.flatMap(\.items) + data.weeklyItems).first { $0.id == id }
    }

    private func applyDraft(_ draft: PlanningItemDraft, id: String, saveState: String) {
        let previous = item(withId: id)
        removeItem(id: id)
        let item = PlanningItem(
            id: id,
            planningDate: draft.planningDate,
            weekStartDate: draft.weekStartDate,
            type: draft.type,
            text: draft.text,
            isCompleted: previous?.isCompleted ?? false,
            sortOrder: previous?.sortOrder ?? 0,
            createdBy: previous?.createdBy ?? activeUser?.userId ?? "local",
            createdByName: previous?.createdByName ?? activeUser?.displayName,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            originalPlanningDate: previous?.originalPlanningDate,
            originalWeekStartDate: previous?.originalWeekStartDate,
            carryoverCount: previous?.carryoverCount,
            lastCarriedAt: previous?.lastCarriedAt,
            saveState: saveState,
            reminder: draft.remindAt.map { NotificationReminder(id: previous?.reminder?.id ?? "pending", resourceKind: "planning_item", remindAt: $0) }
        )
        insert(item)
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

    private func applyLocation(_ location: HouseholdLocation, for date: String, memberIds: [String], scope: String) {
        guard var planner = data else { return }
        let end = scope == "day" ? date : WeekDate.addDays(6, to: planner.weekStart)
        let start = scope == "week" ? planner.weekStart : date
        for index in planner.days.indices where planner.days[index].date >= start && planner.days[index].date <= end {
            for assignmentIndex in planner.days[index].memberLocations.indices where memberIds.contains(planner.days[index].memberLocations[assignmentIndex].memberId) {
                planner.days[index].memberLocations[assignmentIndex].location = location
                planner.days[index].memberLocations[assignmentIndex].weather = nil
            }
            let assignments = planner.days[index].memberLocations
            let sharedId = assignments.first?.location?.id
            let shared = sharedId != nil && assignments.allSatisfy { $0.location?.id == sharedId }
            planner.days[index].location = shared ? assignments.first?.location : nil
            planner.days[index].weather = shared ? assignments.first?.weather : nil
        }
        data = planner
    }

    private func insert(_ item: PlanningItem) {
        guard var planner = data else { return }
        if let date = item.planningDate {
            if let index = planner.days.firstIndex(where: { $0.date == date }) {
                planner.days[index].items.append(item)
            }
        } else if item.weekStartDate == planner.weekStart {
            planner.weeklyItems.append(item)
        }
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
