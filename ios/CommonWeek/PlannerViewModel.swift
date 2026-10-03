import Foundation

@MainActor
final class PlannerViewModel: ObservableObject {
    var workspaceUserId: String { activeUser?.userId ?? data?.members.first?.userId ?? "demo-user" }
    var canEditHousehold: Bool { data?.isDemo == true || (activeUser != nil && activeUser?.role != "viewer") }
    @Published var data: WeeklyPlannerData? { didSet { WidgetPublisher.publish(data, userId: workspaceUserId) } }
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var toast: String?
    @Published var searchResults: [PlannerSearchResult] = []
    @Published var isSearching = false
    @Published private(set) var isOffline = false
    @Published private(set) var pendingChangeCount = 0
    @Published private(set) var heldOfflineChangeCount = 0

    private var currentOfflineIdentity: OfflineIdentity? {
        guard let user = activeUser, let householdId = user.householdId else { return nil }
        return OfflineIdentity(userId: user.userId, householdId: householdId)
    }

    private let api: APIClient
    private let offlineStore: OfflineStore
    private var activeUser: SessionIdentity?
    private var toastTask: Task<Void, Never>?
    private var liveTask: Task<Void, Never>?
    private var liveRefreshTask: Task<Void, Never>?
    private var loadGeneration = 0
    private var syncInProgress = false
    private var followsCurrentWeek = true
    private let isDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] == "1"

    var syncStatusText: String? {
        if heldOfflineChangeCount > 0 {
            return "Saved offline changes need review and remain on this device. Rejoin the original household to sync; older or unreadable drafts stay preserved."
        }
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
        if isDemo { data = FamilyPlanningDemo.shared.planner(weekStart: PreviewData.planner.weekStart) }
    }

    func activate(user: SessionIdentity) async {
        guard !isDemo else { return }
        guard let householdId = user.householdId else {
            deactivate()
            errorMessage = "Household setup is required. Any saved offline changes are kept on this device."
            return
        }
        if activeUser?.userId != user.userId || activeUser?.householdId != householdId {
            loadGeneration += 1
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
            latest = await offlineStore.latestCachedPlanner(userId: user.userId, householdId: householdId, before: nil)
        }
        let timeZone = latest?.household.timezone ?? TimeZone.current.identifier
        let selectedWeek = followsCurrentWeek
            ? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
            : data?.weekStart ?? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
        if data == nil {
            if let cached = await offlineStore.cachedPlanner(userId: user.userId, householdId: householdId, weekStart: selectedWeek) {
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
        pendingChangeCount = await offlineStore.pendingMutations(userId: user.userId, householdId: householdId).count
        heldOfflineChangeCount = await offlineStore.heldMutationCount(userId: user.userId, householdId: householdId)
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
        loadGeneration += 1
        stopLiveUpdates()
        activeUser = nil
        data = nil
        errorMessage = nil
        isOffline = false
        pendingChangeCount = 0
        heldOfflineChangeCount = 0
        followsCurrentWeek = true
    }

    func load(week: String? = nil, quietly: Bool = false, refreshSources: Bool = true) async {
        if isDemo { data = WorkspaceAccess.applying(to: FamilyPlanningDemo.shared.planner(weekStart: week ?? data?.weekStart ?? PreviewData.planner.weekStart, capturing: data)); return }
        guard let user = activeUser, let householdId = user.householdId else { return }
        if syncInProgress { return }
        loadGeneration += 1
        let generation = loadGeneration
        let selected = week ?? data?.weekStart ?? WeekDate.string(WeekDate.monday())
        if data?.weekStart != selected {
            if let cached = await offlineStore.cachedPlanner(userId: user.userId, householdId: householdId, weekStart: selected) {
                let current = WeekDate.currentWeekStart(timeZoneIdentifier: cached.household.timezone)
                data = selected == current
                    ? cached.carryingOpenTasks(to: WeekDate.today(timeZoneIdentifier: cached.household.timezone))
                    : cached
            } else if followsCurrentWeek,
                      let latest = await offlineStore.latestCachedPlanner(userId: user.userId, householdId: householdId, before: selected),
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
        defer { if generation == loadGeneration { isLoading = false } }

        guard await flushPendingChanges() else {
            if data == nil && errorMessage == nil { errorMessage = PlatformCopy.offlinePlannerUnavailable }
            return
        }
        do {
            let payload = try await api.planner(week: selected, coreOnly: true)
            guard generation == loadGeneration, activeUser?.userId == user.userId, activeUser?.householdId == householdId, !Task.isCancelled else { return }
            guard payload.user.userId == user.userId, payload.user.householdId == householdId, payload.planner.household.id == householdId else {
                await preserveChangesAfterIdentityChange(payload.user)
                return
            }
            var planner = payload.planner
            if let previous = data, previous.weekStart == selected {
                planner.calendarState = previous.calendarState
                planner.weatherState = previous.weatherState
                for index in planner.days.indices {
                    guard let old = previous.days.first(where: { $0.date == planner.days[index].date }) else { continue }
                    planner.days[index].events = old.events.filter { event in planner.visibleCalendars?.contains(where: { $0.id == (event.calendarPreferenceId ?? event.calendarId) }) ?? false }
                    if planner.days[index].location?.id == old.location?.id { planner.days[index].weather = old.weather }
                    for memberIndex in planner.days[index].memberLocations.indices {
                        let member = planner.days[index].memberLocations[memberIndex]
                        if let prior = old.memberLocations.first(where: { $0.memberId == member.memberId && $0.location?.id == member.location?.id }) {
                            planner.days[index].memberLocations[memberIndex].weather = prior.weather
                        }
                    }
                }
            }
            data = planner
            isLoading = false
            isOffline = false
            try? await offlineStore.savePlanner(planner, userId: user.userId)
            if refreshSources || planner.calendarState.status == "loading" || planner.weatherState.status == "loading" {
                async let calendar: Void = loadSource("calendar", week: selected, userId: user.userId, generation: generation)
                async let weather: Void = loadSource("weather", week: selected, userId: user.userId, generation: generation)
                _ = await (calendar, weather)
            }
        } catch {
            guard generation == loadGeneration, activeUser?.userId == user.userId, activeUser?.householdId == householdId, !Task.isCancelled else { return }
            if APIClient.isConnectivityFailure(error) {
                isOffline = true
                if data == nil,
                   let cached = await offlineStore.cachedPlanner(userId: user.userId, householdId: householdId, weekStart: selected) {
                    data = cached
                }
            }
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    private func loadSource(_ source: String, week: String, userId: String, generation: Int) async {
        do {
            let payload = try await api.plannerSource(source, week: week)
            guard generation == loadGeneration, activeUser?.userId == userId, var planner = data, planner.weekStart == week, !Task.isCancelled else { return }
            for index in planner.days.indices {
                guard let day = payload.days.first(where: { $0.date == planner.days[index].date }) else { continue }
                if source == "calendar" { planner.days[index].events = day.events }
                else {
                    planner.days[index].location = day.location
                    planner.days[index].weather = day.weather
                    planner.days[index].memberLocations = day.memberLocations
                }
            }
            if source == "calendar" { planner.calendarState = payload.calendarState }
            else { planner.weatherState = payload.weatherState }
            data = planner
            try? await offlineStore.savePlanner(planner, userId: userId)
        } catch {
            guard generation == loadGeneration, activeUser?.userId == userId, data?.weekStart == week, !Task.isCancelled else { return }
            let state = PlannerSourceState(status: "error", message: "\(source == "calendar" ? "Calendar" : "Weather") could not refresh. Pull to refresh and try again.")
            if source == "calendar" { data?.calendarState = state }
            else { data?.weatherState = state }
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
        let identity = currentOfflineIdentity
        let visibleWeek = data?.weekStart ?? item.weekStartDate
        mutateItem(id: item.id) { $0.isCompleted.toggle() }
        persistCurrentPlanner()
        guard !isDemo else { return }
        do {
            _ = try await api.toggleItem(id: item.id, completed: !item.isCompleted, expectedIdentity: identity)
            await refreshAfterMutation(week: visibleWeek)
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .toggleItem, identity: identity, itemId: item.id, completed: !item.isCompleted)
            if await enqueue(mutation) { markSavedOffline() }
            else { mutateItem(id: item.id) { $0.isCompleted = item.isCompleted } }
        } catch {
            mutateItem(id: item.id) { $0.isCompleted = item.isCompleted }
            show(error.localizedDescription)
        }
    }

    func saveItem(_ draft: PlanningItemDraft, originalItem: PlanningItem? = nil, creating: Bool = false) async -> Bool {
        let identity = currentOfflineIdentity
        let isNew = creating || draft.id == nil
        let visibleWeek = data?.weekStart ?? draft.weekStartDate
        if isDemo {
            applyDraft(draft, id: draft.id ?? UUID().uuidString, saveState: "saved", originalItem: originalItem)
            return true
        }
        let onlineDraft = PlanningItemDraft(
            id: draft.id ?? UUID().uuidString,
            text: draft.text,
            type: draft.type,
            planningDate: draft.planningDate,
            weekStartDate: draft.weekStartDate,
            remindAt: draft.remindAt,
            childId: draft.childId,
            childAssignmentIsSet: draft.childAssignmentIsSet,
            assignedMemberIds: draft.assignedMemberIds,
            afterItemId: draft.afterItemId
        )
        let previous = onlineDraft.id.flatMap(item(withId:)) ?? originalItem
        applyDraft(onlineDraft, id: onlineDraft.id!, saveState: "saving", originalItem: originalItem)
        persistCurrentPlanner()
        do {
            if isNew { _ = try await api.createItem(onlineDraft, expectedIdentity: identity) }
            else { _ = try await api.updateItem(onlineDraft, expectedIdentity: identity) }
            applyDraft(onlineDraft, id: onlineDraft.id!, saveState: "saved", originalItem: previous)
            persistCurrentPlanner()
            show(onlineDraft.type == .task ? "Task saved" : "Plan saved")
            scheduleRefreshAfterMutation(week: visibleWeek)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: isNew ? .createItem : .updateItem, identity: identity, draft: onlineDraft)
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
        let identity = currentOfflineIdentity
        removeItem(id: item.id)
        persistCurrentPlanner()
        if isDemo { return true }
        do {
            _ = try await api.deleteItem(id: item.id, expectedIdentity: identity)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            if await enqueue(OfflineMutation(kind: .deleteItem, identity: identity, itemId: item.id)) {
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
        let identity = currentOfflineIdentity
        let previous = data
        applyLocation(location, for: date, memberIds: memberIds, scope: scope)
        persistCurrentPlanner()
        if isDemo { return true }
        do {
            _ = try await api.setLocation(date: date, locationId: location.id, memberIds: memberIds, scope: scope, expectedIdentity: identity)
            await refreshAfterMutation(week: data?.weekStart)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .assignSavedLocation, identity: identity, startDate: date, scope: scope, locationId: location.id, memberIds: memberIds)
            if await enqueue(mutation) { markSavedOffline(); return true }
        } catch { show(error.localizedDescription) }
        data = previous
        return false
    }

    func setLocation(_ result: GeocodingResult, for date: String, memberIds: [String], scope: String, saveForReuse: Bool) async -> Bool {
        let identity = currentOfflineIdentity
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
            _ = try await api.setLocation(date: date, result: result, memberIds: memberIds, saveForReuse: saveForReuse, scope: scope, expectedIdentity: identity)
            await refreshAfterMutation(week: data?.weekStart)
            return true
        } catch where APIClient.isConnectivityFailure(error) {
            let mutation = OfflineMutation(kind: .assignGeocodedLocation, identity: identity, startDate: date, scope: scope, memberIds: memberIds, location: result, saveForReuse: saveForReuse)
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
        if isDemo {
            guard let planner = data else { return false }
            do {
                data = try CalendarInteraction.applyingDemo(draft, to: planner)
                FamilyPlanningDemo.shared.capture(data)
                show(editing ? "Demo event updated" : "Demo event added")
                return true
            } catch { show(error.localizedDescription); return false }
        }
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
                    for try await change in api.realtimeChanges() {
                        guard !Task.isCancelled else { return }
                        retryDelay = 1
                        scheduleLiveRefresh(table: change.table)
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
        guard await flushPendingChanges(), let user = activeUser, let householdId = user.householdId else { return false }
        do {
            let timeZone = data?.household.timezone ?? TimeZone.current.identifier
            let week = followsCurrentWeek
                ? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
                : data?.weekStart ?? WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
            let payload = try await api.planner(week: week)
            guard payload.user.userId == user.userId, payload.user.householdId == householdId, payload.planner.household.id == householdId else {
                await preserveChangesAfterIdentityChange(payload.user)
                return false
            }
            let planner = payload.planner
            data = planner
            try await offlineStore.savePlanner(planner, userId: user.userId)
            isOffline = false
            return true
        } catch {
            if APIClient.isConnectivityFailure(error) { isOffline = true }
            return false
        }
    }

    private func scheduleLiveRefresh(table: String?) {
        liveRefreshTask?.cancel()
        liveRefreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let self else { return }
            await load(week: data?.weekStart, quietly: true, refreshSources: !["planning_items", "task_checklist_items", "item_comments", "item_attachments", "event_coverage", "weekly_reviews"].contains(table ?? ""))
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

    private func preserveChangesAfterIdentityChange(_ identity: SessionIdentity) async {
        loadGeneration += 1
        stopLiveUpdates()
        activeUser = identity
        data = nil
        isLoading = false
        pendingChangeCount = 0
        heldOfflineChangeCount = await offlineStore.heldMutationCount(userId: identity.userId, householdId: identity.householdId)
        errorMessage = "Your account or household changed. Earlier offline changes are kept on this device and were not sent. Refresh to load your current household."
    }

    private func flushPendingChanges() async -> Bool {
        guard !syncInProgress, let user = activeUser, let householdId = user.householdId else { return false }
        syncInProgress = true
        defer { syncInProgress = false }
        do {
            // activeUser can be stale after another device changes membership.
            let current = try await api.restoreSession()
            guard activeUser?.userId == user.userId, activeUser?.householdId == householdId else { return false }
            guard current.userId == user.userId, current.householdId == householdId else {
                await preserveChangesAfterIdentityChange(current)
                return false
            }
            activeUser = current
        } catch {
            if APIClient.isConnectivityFailure(error) { isOffline = true }
            return false
        }
        let mutations = await offlineStore.pendingMutations(userId: user.userId, householdId: householdId)
        pendingChangeCount = mutations.count
        heldOfflineChangeCount = await offlineStore.heldMutationCount(userId: user.userId, householdId: householdId)
        for mutation in mutations {
            do {
                guard activeUser?.userId == user.userId, activeUser?.householdId == householdId else { return false }
                try await execute(mutation)
                try await offlineStore.removeMutation(mutation.id, userId: user.userId, householdId: householdId)
                pendingChangeCount -= 1
            } catch where APIClient.isConnectivityFailure(error) {
                isOffline = true
                return false
            } catch APIError.unauthorized {
                return false
            } catch {
                // Failed or mismatched drafts remain recoverable; only confirmed
                // successful mutations may be removed from the durable queue.
                errorMessage = "An offline change could not be applied. It is still saved on this device for retry or review."
                return false
            }
        }
        return true
    }

    private func execute(_ mutation: OfflineMutation) async throws {
        guard let identity = mutation.identity,
              identity.userId == activeUser?.userId, identity.householdId == activeUser?.householdId else {
            throw APIError.server("This saved change belongs to another account or household.")
        }
        switch mutation.kind {
        case .createItem:
            guard let draft = mutation.draft else { throw APIError.invalidResponse }
            _ = try await api.createItem(draft, expectedIdentity: identity)
        case .updateItem:
            guard let draft = mutation.draft else { throw APIError.invalidResponse }
            _ = try await api.updateItem(draft, expectedIdentity: identity)
        case .toggleItem:
            guard let id = mutation.itemId, let completed = mutation.completed else { throw APIError.invalidResponse }
            _ = try await api.toggleItem(id: id, completed: completed, expectedIdentity: identity)
        case .deleteItem:
            guard let id = mutation.itemId else { throw APIError.invalidResponse }
            _ = try await api.deleteItem(id: id, expectedIdentity: identity)
        case .assignSavedLocation:
            guard let date = mutation.startDate, let scope = mutation.scope, let id = mutation.locationId else { throw APIError.invalidResponse }
            let memberIds = mutation.memberIds ?? data?.members.map(\.id) ?? []
            _ = try await api.setLocation(date: date, locationId: id, memberIds: memberIds, scope: scope, expectedIdentity: identity)
        case .assignGeocodedLocation:
            guard let date = mutation.startDate, let scope = mutation.scope, let location = mutation.location else { throw APIError.invalidResponse }
            let memberIds = mutation.memberIds ?? data?.members.map(\.id) ?? []
            _ = try await api.setLocation(date: date, result: location, memberIds: memberIds, saveForReuse: mutation.saveForReuse ?? true, scope: scope, expectedIdentity: identity)
        }
    }

    private func enqueue(_ mutation: OfflineMutation) async -> Bool {
        guard let identity = mutation.identity else { return false }
        do {
            // Capture identity before the network await; a late failure must not
            // rebind the draft to whichever account is now active.
            try await offlineStore.enqueue(mutation, userId: identity.userId, householdId: identity.householdId)
            if identity == currentOfflineIdentity {
                pendingChangeCount = await offlineStore.pendingMutations(userId: identity.userId, householdId: identity.householdId).count
            }
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
        guard let user = activeUser, let data, user.householdId == data.household.id else { return }
        let savedAt = Date()
        Task { try? await offlineStore.savePlanner(data, userId: user.userId, savedAt: savedAt) }
    }

    private func item(withId id: String) -> PlanningItem? {
        guard let data else { return nil }
        return (data.days.flatMap(\.items) + data.weeklyItems).first { $0.id == id }
    }

    private func applyDraft(_ draft: PlanningItemDraft, id: String, saveState: String, originalItem: PlanningItem? = nil) {
        let previous = item(withId: id) ?? originalItem
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
            reminder: draft.remindAt.map { NotificationReminder(id: previous?.reminder?.id ?? "pending", resourceKind: "planning_item", remindAt: $0) },
            childId: draft.childAssignmentIsSet ? draft.childId : previous?.childId,
            assignedMemberIds: draft.assignedMemberIds ?? previous?.assignedMemberIds,
            routineId: previous?.routineId,
            routineOccurrenceDate: previous?.routineOccurrenceDate
        )
        insert(item, after: draft.afterItemId)
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

    private func insert(_ item: PlanningItem, after anchorId: String? = nil) {
        guard var planner = data else { return }
        if let date = item.planningDate {
            if let index = planner.days.firstIndex(where: { $0.date == date }) {
                if let anchorId, let anchor = planner.days[index].items.firstIndex(where: { $0.id == anchorId }) {
                    planner.days[index].items.insert(item, at: anchor + 1)
                } else { planner.days[index].items.append(item) }
            }
        } else if item.weekStartDate == planner.weekStart {
            if let anchorId, let anchor = planner.weeklyItems.firstIndex(where: { $0.id == anchorId }) {
                planner.weeklyItems.insert(item, at: anchor + 1)
            } else { planner.weeklyItems.append(item) }
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
