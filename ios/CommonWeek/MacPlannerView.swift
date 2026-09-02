#if targetEnvironment(macCatalyst)
import Combine
import SwiftUI
import UIKit

enum MacPlannerCommand {
    case newItem
    case search
    case refresh
    case save
    case toggleCompletion
    case delete
    case settings
}

fileprivate struct MacPlannerCommandAvailability: Equatable {
    let canCreate: Bool
    let canSave: Bool
    let canToggleCompletion: Bool
    let canDelete: Bool
}

@MainActor
final class MacPlannerCommandRouter: ObservableObject {
    @Published private(set) var revision = 0
    @Published fileprivate private(set) var availability = MacPlannerCommandAvailability(
        canCreate: true,
        canSave: false,
        canToggleCompletion: false,
        canDelete: false
    )
    private(set) var command: MacPlannerCommand?

    func perform(_ command: MacPlannerCommand) {
        self.command = command
        revision += 1
    }

    fileprivate func updateAvailability(_ availability: MacPlannerCommandAvailability) {
        guard self.availability != availability else { return }
        self.availability = availability
    }
}

private struct MacPlannerCommandRouterKey: FocusedValueKey {
    typealias Value = MacPlannerCommandRouter
}

fileprivate struct MacPlannerCommandAvailabilityKey: FocusedValueKey {
    typealias Value = MacPlannerCommandAvailability
}

extension FocusedValues {
    var macPlannerCommandRouter: MacPlannerCommandRouter? {
        get { self[MacPlannerCommandRouterKey.self] }
        set { self[MacPlannerCommandRouterKey.self] = newValue }
    }

    fileprivate var macPlannerCommandAvailability: MacPlannerCommandAvailability? {
        get { self[MacPlannerCommandAvailabilityKey.self] }
        set { self[MacPlannerCommandAvailabilityKey.self] = newValue }
    }
}

struct MacPlannerCommands: Commands {
    @FocusedValue(\.macPlannerCommandRouter) private var router
    @FocusedValue(\.macPlannerCommandAvailability) private var availability

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Item") { router?.perform(.newItem) }
                .keyboardShortcut("n", modifiers: .command)
                .disabled(!(availability?.canCreate ?? false))
        }
        CommandMenu("Week of Us") {
            Button("Find") { router?.perform(.search) }
                .keyboardShortcut("f", modifiers: .command)
            Button("Refresh") { router?.perform(.refresh) }
                .keyboardShortcut("r", modifiers: .command)
            Divider()
            Button("Save") { router?.perform(.save) }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!(availability?.canSave ?? false))
            Button("Complete or Reopen") { router?.perform(.toggleCompletion) }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!(availability?.canToggleCompletion ?? false))
            Button("Delete") { router?.perform(.delete) }
                .keyboardShortcut(.delete, modifiers: [])
                .disabled(!(availability?.canDelete ?? false))
            Divider()
            Button("Settings…") { router?.perform(.settings) }
                .keyboardShortcut(",", modifiers: .command)
        }
    }
}

private enum MacPlannerSheet: Identifiable {
    case item(date: String?, type: PlanningItemType)
    case reminder(date: String)
    case event(date: String)
    case search
    case weather(DayPlan)
    case location(DayPlan)

    var id: String {
        switch self {
        case .item(let date, let type): "item-\(date ?? "weekly")-\(type.rawValue)"
        case .reminder(let date): "reminder-\(date)"
        case .event(let date): "event-\(date)"
        case .search: "search"
        case .weather(let day): "weather-\(day.date)-\(day.location?.id ?? "household")"
        case .location(let day): "location-\(day.date)"
        }
    }
}

private enum MacDeletionTarget: Identifiable {
    case planningItem(PlanningItem)
    case reminder(AppleReminderTask)

    var id: String {
        switch self {
        case .planningItem(let item): "item-\(item.id)"
        case .reminder(let reminder): "reminder-\(reminder.id)"
        }
    }
}

struct MacPlannerView: View {
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var auth: AuthStore
    let user: SessionIdentity
    @StateObject private var navigation: MacPlannerNavigation
    @StateObject private var commandRouter = MacPlannerCommandRouter()
    @StateObject private var unsavedChanges = MacUnsavedChangesCoordinator()
    @StateObject private var appleReminders = AppleRemindersStore.shared
    @ObservedObject private var notifications = NotificationCoordinator.shared
    @State private var sheet: MacPlannerSheet?
    @State private var deletionTarget: MacDeletionTarget?
    @State private var searchText = ""
    @State private var hasCapturedAppStoreScreenshot = false
    @FocusState private var searchFocused: Bool
    @Environment(\.openWindow) private var openWindow
    @SceneStorage("mac-planner-column-visibility") private var columnVisibilityValue = "all"
    @SceneStorage("mac-calendar-filter") private var calendarFilterId = CalendarEventFilter.allCalendars
    @SceneStorage("mac-person-filter") private var personFilterId = CalendarEventFilter.allPeople

    init(viewModel: PlannerViewModel, auth: AuthStore, user: SessionIdentity) {
        self.viewModel = viewModel
        self.auth = auth
        self.user = user
        let screenshot = MacAppStoreScreenshot.current
        _navigation = StateObject(wrappedValue: MacPlannerNavigation(
            section: screenshot?.section ?? .week,
            selection: screenshot?.selection,
            defaults: screenshot == nil ? .standard : nil,
            persistenceKey: screenshot == nil ? "mac-planner-navigation.\(user.userId)" : nil
        ))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            AppBackground()
            plannerContent
            if let toast = viewModel.toast ?? appleReminders.notice {
                Label(toast, systemImage: "checkmark.circle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(CWTheme.accentStrong)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
                    .padding(.bottom, 18)
            }
        }
        .frame(minWidth: 980, minHeight: 640)
        .focusedSceneValue(\.macPlannerCommandRouter, commandRouter)
        .focusedSceneValue(\.macPlannerCommandAvailability, commandAvailability)
        .searchable(text: $searchText, prompt: "Search this week")
        .searchFocused($searchFocused)
        .sheet(item: $sheet) { sheet in
            sheetView(sheet)
                .frame(minWidth: 520, idealWidth: 620, minHeight: 520, idealHeight: 700)
        }
        .confirmationDialog(
            deletionTitle,
            isPresented: Binding(
                get: { deletionTarget != nil },
                set: { if !$0 { deletionTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(deletionButtonTitle, role: .destructive) { performDeletion() }
            Button("Cancel", role: .cancel) { deletionTarget = nil }
        } message: {
            Text(deletionMessage)
        }
        .confirmationDialog(
            "Discard unsaved changes?",
            isPresented: Binding(
                get: { unsavedChanges.requiresConfirmation },
                set: { if !$0 { unsavedChanges.cancelNavigation() } }
            ),
            titleVisibility: .visible
        ) {
            Button("Discard Changes", role: .destructive) {
                if let intent = unsavedChanges.discardChanges() { execute(intent) }
            }
            Button("Keep Editing", role: .cancel) { unsavedChanges.cancelNavigation() }
        } message: {
            Text("Save the selected item first, or discard the edits before changing sections, weeks, or selections.")
        }
        .onChange(of: commandRouter.revision) { _, _ in handleCommand() }
        .onChange(of: navigation.selection) { _, _ in updateCommandAvailability() }
        .onChange(of: navigation.selections) { _, _ in updateCommandAvailability() }
        .onChange(of: navigation.section) { _, _ in updateCommandAvailability() }
        .onChange(of: unsavedChanges.isDirty) { _, _ in updateCommandAvailability() }
        .task { updateCommandAvailability() }
        .task(id: notifications.pendingDestination) { await openPendingNotification() }
        .task(id: appStoreScreenshotRevision) { await captureAppStoreScreenshotIfNeeded() }
    }

    private var appStoreScreenshotRevision: String {
        guard let screenshot = MacAppStoreScreenshot.current else { return "disabled" }
        return "\(screenshot.rawValue):\(viewModel.data?.weekStart ?? "loading")"
    }

    private func captureAppStoreScreenshotIfNeeded() async {
        guard !hasCapturedAppStoreScreenshot,
              viewModel.data != nil,
              let screenshot = MacAppStoreScreenshot.current,
              let outputPath = ProcessInfo.processInfo.environment["APP_STORE_MAC_SCREENSHOT_OUTPUT"] else { return }

        hasCapturedAppStoreScreenshot = true
        try? await Task.sleep(for: .seconds(2))
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: \.isKeyWindow) ?? scene.windows.first else {
            fputs("Unable to find the Week of Us window for \(screenshot.rawValue).\n", stderr)
            exit(2)
        }

        let format = UIGraphicsImageRendererFormat()
        format.scale = window.screen.scale
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: format)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }

        do {
            guard let data = image.pngData() else { throw CocoaError(.fileWriteUnknown) }
            try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
            exit(0)
        } catch {
            fputs("Unable to write the \(screenshot.rawValue) screenshot: \(error)\n", stderr)
            exit(3)
        }
    }

    @ViewBuilder
    private var plannerContent: some View {
        if viewModel.isLoading && viewModel.data == nil {
            ProgressView("Bringing your week together…")
                .controlSize(.large)
        } else if let error = viewModel.errorMessage, viewModel.data == nil {
            ContentUnavailableView(
                "The planner didn’t load",
                systemImage: "calendar.badge.exclamationmark",
                description: Text(error)
            )
            .overlay(alignment: .bottom) {
                Button("Try Again") { Task { await viewModel.load() } }
                    .buttonStyle(.borderedProminent)
                    .padding(.bottom, 80)
            }
        } else if let data = viewModel.data {
            NavigationSplitView(columnVisibility: columnVisibility) {
                sidebar(data)
                    .navigationSplitViewColumnWidth(min: 190, ideal: 220, max: 260)
            } content: {
                mainColumn(data)
                    .navigationSplitViewColumnWidth(min: 390, ideal: 520)
            } detail: {
                inspector(data)
                    .navigationSplitViewColumnWidth(min: 330, ideal: 420)
            }
            .task(id: "\(user.userId):\(data.weekStart):\(data.household.timezone)") {
                synchronizeDay(with: data)
                await appleReminders.activate(
                    userId: user.userId,
                    weekStart: data.weekStart,
                    timeZoneIdentifier: data.household.timezone
                )
            }
            .task(id: filterRevision(data)) { normalizeFilters(in: data) }
            .onChange(of: data.weekStart) { _, _ in
                synchronizeDay(with: data)
                navigation.clearSelection()
                unsavedChanges.setDirty(false)
            }
        }
    }

    private func sidebar(_ data: WeeklyPlannerData) -> some View {
        List(selection: sidebarSelection) {
            Section("Planner") {
                sidebarRow(.week)
                sidebarRow(.events)
                sidebarRow(.plans)
                sidebarRow(.weekOfUsTasks)
            }
            Section("On This Mac") {
                sidebarRow(.appleReminders)
            }
            Section("Account") {
                sidebarRow(.notifications, badge: notifications.inbox.unreadCount)
                sidebarRow(.settings)
            }
            Section {
                VStack(alignment: .leading, spacing: 5) {
                    BrandMark()
                    Text(data.household.name)
                        .font(.caption.weight(.semibold))
                    Text(user.email)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.vertical, 8)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Week of Us")
    }

    private func sidebarRow(_ section: MacPlannerSection, badge: Int = 0) -> some View {
        Label {
            HStack {
                Text(section.title)
                Spacer()
                if badge > 0 {
                    Text("\(min(badge, 99))")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red, in: Capsule())
                }
            }
        } icon: {
            Image(systemName: section.icon)
        }
        .contentShape(Rectangle())
        .tag(section)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("mac-sidebar-\(section.rawValue)")
    }

    private var sidebarSelection: Binding<MacPlannerSection?> {
        Binding(
            get: { navigation.section },
            set: { if let section = $0 { request(.section(section)) } }
        )
    }

    @ViewBuilder
    private func mainColumn(_ data: WeeklyPlannerData) -> some View {
        switch navigation.section {
        case .notifications:
            MacNotificationsView(coordinator: notifications)
        case .settings:
            SettingsView(
                data: data,
                viewModel: viewModel,
                auth: auth,
                appleReminders: appleReminders,
                showsDoneButton: false
            )
        default:
            VStack(spacing: 0) {
                MacWeekHeader(
                    data: data,
                    section: navigation.section,
                    selectedDay: navigation.selectedDay,
                    selectDay: { request(.day($0)) },
                    previousWeek: { request(.weekOffset(-7)) },
                    currentWeek: { request(.currentWeek) },
                    nextWeek: { request(.weekOffset(7)) },
                    refresh: { commandRouter.perform(.refresh) },
                    create: { commandRouter.perform(.newItem) },
                    dropOnDay: reschedule(_:to:)
                )
                if navigation.section == .week || navigation.section == .events {
                    CalendarFilterControls(
                        calendars: CalendarEventFilter.calendars(in: data),
                        members: data.members,
                        calendarId: $calendarFilterId,
                        personId: $personFilterId
                    )
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(uiColor: .secondarySystemBackground))
                    .overlay(alignment: .bottom) { Divider() }
                }
                if navigation.section == .week,
                   let day = data.days.first(where: { $0.date == navigation.selectedDay }) {
                    MacDayContextBar(
                        day: day,
                        unit: data.household.temperatureUnit,
                        weatherState: data.weatherState,
                        openLocation: { sheet = .location(day) },
                        openWeather: { sheet = .weather($0) }
                    )
                }
                if let syncStatus = viewModel.syncStatusText {
                    Label(syncStatus, systemImage: viewModel.isOffline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(viewModel.isOffline ? Color.orange : CWTheme.secondaryInk)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(uiColor: .secondarySystemBackground))
                }
                MacPlannerListPane(
                    data: data,
                    section: navigation.section,
                    selectedDay: navigation.selectedDay,
                    selections: Binding(
                        get: { navigation.selections },
                        set: { request(.selections($0)) }
                    ),
                    searchText: searchText,
                    calendarFilterId: calendarFilterId,
                    personFilterId: personFilterId,
                    toggleItem: { item in Task { await viewModel.toggle(item) } },
                    reminders: appleReminders,
                    deleteItem: { deletionTarget = .planningItem($0) },
                    deleteReminder: { deletionTarget = .reminder($0) },
                    reschedule: reschedule(_:to:)
                )
            }
            .navigationTitle(navigation.section.title)
        }
    }

    @ViewBuilder
    private func inspector(_ data: WeeklyPlannerData) -> some View {
        switch navigation.selection {
        case .planningItem(let id):
            if let item = planningItem(id: id, in: data) {
                MacPlanningItemInspector(
                    item: item,
                    data: data,
                    viewModel: viewModel,
                    appleReminders: appleReminders,
                    commandRouter: commandRouter,
                    requestDelete: { deletionTarget = .planningItem(item) },
                    dirtyChanged: { unsavedChanges.setDirty($0) }
                )
                .id(item.id)
            } else {
                MacEmptyInspector(section: navigation.section)
            }
        case .event(let id):
            if let event = calendarEvent(id: id, in: data) {
                MacEventInspector(
                    event: event,
                    data: data,
                    viewModel: viewModel,
                    commandRouter: commandRouter,
                    dirtyChanged: { unsavedChanges.setDirty($0) },
                    deleted: { navigation.clearSelection() }
                )
                .id(event.id)
            } else {
                MacEmptyInspector(section: navigation.section)
            }
        case .appleReminder(let id):
            if let reminder = appleReminders.tasks.first(where: { $0.id == id }) {
                MacAppleReminderInspector(
                    task: reminder,
                    data: data,
                    store: appleReminders,
                    commandRouter: commandRouter,
                    requestDelete: { deletionTarget = .reminder(reminder) },
                    dirtyChanged: { unsavedChanges.setDirty($0) }
                )
                .id(reminder.id)
            } else {
                MacEmptyInspector(section: navigation.section)
            }
        case nil:
            MacEmptyInspector(section: navigation.section)
        }
    }

    @ViewBuilder
    private func sheetView(_ sheet: MacPlannerSheet) -> some View {
        if let data = viewModel.data {
            switch sheet {
            case .item(let date, let type):
                ItemEditorView(
                    item: nil,
                    planningDate: date,
                    defaultType: type,
                    data: data,
                    viewModel: viewModel,
                    appleReminders: appleReminders,
                    allowsAppleReminderDestination: false
                )
            case .reminder(let date):
                MacNewAppleReminderView(date: date, data: data, store: appleReminders)
            case .event(let date):
                CalendarEventEditorView(event: nil, date: date, data: data, viewModel: viewModel)
            case .search:
                MacPlannerSearchView(viewModel: viewModel) { result in
                    openSearchResult(result)
                }
            case .weather(let day):
                WeatherDetailView(day: day, unit: data.household.temperatureUnit)
            case .location(let day):
                LocationPickerView(day: day, locations: data.locations, viewModel: viewModel)
            }
        }
    }

    private func handleCommand() {
        guard let command = commandRouter.command else { return }
        switch command {
        case .newItem:
            let date = navigation.selectedDay.isEmpty
                ? viewModel.data?.weekStart ?? WeekDate.string(Date())
                : navigation.selectedDay
            switch navigation.section {
            case .events: sheet = .event(date: date)
            case .plans: sheet = .item(date: date, type: .note)
            case .appleReminders:
                if appleReminders.writableSelectedLists.isEmpty {
                    appleReminders.notice = "Choose a writable Reminders list before creating a reminder."
                } else {
                    sheet = .reminder(date: date)
                }
            case .week, .weekOfUsTasks: sheet = .item(date: date, type: .task)
            case .notifications, .settings: break
            }
        case .search:
            sheet = .search
        case .refresh:
            guard let data = viewModel.data else { return }
            Task {
                async let plannerRefresh: Void = viewModel.load(week: data.weekStart, quietly: true)
                async let remindersRefresh: Void = appleReminders.refresh(
                    weekStart: data.weekStart,
                    timeZoneIdentifier: data.household.timezone
                )
                async let notificationRefresh: Void = notifications.refreshInbox()
                _ = await (plannerRefresh, remindersRefresh, notificationRefresh)
            }
        case .toggleCompletion:
            toggleSelectedItem()
        case .delete:
            beginDeleteSelectedItem()
        case .save:
            break // The selected inspector handles Command-S using the same router revision.
        case .settings:
            openWindow(id: "settings")
        }
    }

    private func toggleSelectedItem() {
        guard let data = viewModel.data else { return }
        let selections = navigation.selections.isEmpty
            ? Set(navigation.selection.map { [$0] } ?? [])
            : navigation.selections
        Task {
            for selection in selections {
                switch selection {
                case .planningItem(let id):
                    if let item = planningItem(id: id, in: data), item.type == .task {
                        await viewModel.toggle(item)
                    }
                case .appleReminder(let id):
                    if let task = appleReminders.tasks.first(where: { $0.id == id }), task.canModify {
                        await appleReminders.toggle(task)
                    }
                case .event:
                    break
                }
            }
        }
    }

    private func beginDeleteSelectedItem() {
        guard let data = viewModel.data else { return }
        switch navigation.selection {
        case .planningItem(let id):
            if let item = planningItem(id: id, in: data) { deletionTarget = .planningItem(item) }
        case .appleReminder(let id):
            if let reminder = appleReminders.tasks.first(where: { $0.id == id }) {
                deletionTarget = .reminder(reminder)
            }
        default:
            break
        }
    }

    private func performDeletion() {
        guard let deletionTarget else { return }
        self.deletionTarget = nil
        Task {
            switch deletionTarget {
            case .planningItem(let item):
                if await viewModel.deleteItem(item) {
                    unsavedChanges.setDirty(false)
                    navigation.clearSelection()
                }
            case .reminder(let reminder):
                do {
                    try await appleReminders.delete(reminder)
                    unsavedChanges.setDirty(false)
                    navigation.clearSelection()
                } catch {
                    appleReminders.notice = error.localizedDescription
                }
            }
        }
    }

    private var deletionTitle: String {
        switch deletionTarget {
        case .planningItem: "Delete this Week of Us item?"
        case .reminder(let reminder): reminder.isRecurring ? "Delete this recurring reminder?" : "Delete this reminder?"
        case nil: "Delete item?"
        }
    }

    private var deletionButtonTitle: String {
        switch deletionTarget {
        case .reminder(let reminder) where reminder.isRecurring: "Delete recurring series"
        case .reminder: "Delete reminder"
        default: "Delete item"
        }
    }

    private var deletionMessage: String {
        switch deletionTarget {
        case .planningItem:
            "This removes the item from the shared Week of Us planner."
        case .reminder(let reminder) where reminder.isRecurring:
            "This deletes the entire recurring series from Apple Reminders, not just the reminder shown here. This cannot be undone."
        case .reminder:
            "This deletes it for everyone who shares the Apple Reminders list. This cannot be undone."
        case nil:
            ""
        }
    }

    private func synchronizeDay(with data: WeeklyPlannerData) {
        guard !data.days.isEmpty else { return }
        if !data.days.contains(where: { $0.date == navigation.selectedDay }) {
            navigation.selectedDay = data.days.first(where: {
                WeekDate.isToday($0.date, timeZoneIdentifier: data.household.timezone)
            })?.date ?? data.days[0].date
        }
    }

    private func filterRevision(_ data: WeeklyPlannerData) -> String {
        let calendarIds = CalendarEventFilter.calendars(in: data).map(\.id).joined(separator: ",")
        let memberIds = data.members.map(\.userId).joined(separator: ",")
        return "\(calendarIds)|\(memberIds)"
    }

    private func normalizeFilters(in data: WeeklyPlannerData) {
        if calendarFilterId != CalendarEventFilter.allCalendars,
           !CalendarEventFilter.calendars(in: data).contains(where: { $0.id == calendarFilterId }) {
            calendarFilterId = CalendarEventFilter.allCalendars
        }
        if personFilterId != CalendarEventFilter.allPeople,
           !data.members.contains(where: { $0.userId == personFilterId }) {
            personFilterId = CalendarEventFilter.allPeople
        }
    }

    private var columnVisibility: Binding<NavigationSplitViewVisibility> {
        Binding(
            get: {
                switch columnVisibilityValue {
                case "detail-only": .detailOnly
                case "double-column": .doubleColumn
                default: .all
                }
            },
            set: { value in
                switch value {
                case .detailOnly: columnVisibilityValue = "detail-only"
                case .doubleColumn: columnVisibilityValue = "double-column"
                default: columnVisibilityValue = "all"
                }
            }
        )
    }

    private func request(_ intent: MacNavigationIntent) {
        if let approved = unsavedChanges.request(intent) { execute(approved) }
    }

    private func execute(_ intent: MacNavigationIntent) {
        switch intent {
        case .section(let section):
            navigation.select(section)
        case .day(let date):
            navigation.selectDay(date)
        case .selection(let selection):
            switch selection {
            case .planningItem(let id): navigation.selectPlanningItem(id)
            case .event(let id): navigation.selectEvent(id)
            case .appleReminder(let id): navigation.selectAppleReminder(id)
            }
        case .selections(let selections):
            navigation.selectMany(selections)
        case .weekOffset(let days):
            Task { await viewModel.moveWeek(by: days) }
        case .currentWeek:
            Task { await viewModel.moveToCurrentWeek() }
        }
    }

    private func openSearchResult(_ result: PlannerSearchResult) {
        sheet = nil
        unsavedChanges.setDirty(false)
        switch result {
        case .planningItem(let item):
            Task {
                await viewModel.move(toWeek: item.weekStartDate)
                navigation.select(item.type == .task ? .weekOfUsTasks : .plans)
                navigation.selectPlanningItem(item.id)
            }
        case .calendarEvent(let event):
            let week = WeekDate.weekStart(for: String(event.start.prefix(10)))
            Task {
                await viewModel.move(toWeek: week)
                navigation.select(.events)
                navigation.selectEvent(event.id)
            }
        }
    }

    @discardableResult
    private func reschedule(_ payload: MacPlannerDragPayload, to date: String) -> Bool {
        guard !unsavedChanges.isDirty else {
            viewModel.toast = "Save or discard the selected edits before rescheduling."
            return false
        }
        guard let data = viewModel.data else { return false }
        switch payload {
        case .planningItem(let id):
            guard let item = planningItem(id: id, in: data) else { return false }
            let draft = PlanningItemDraft(
                id: item.id,
                text: item.text,
                type: item.type,
                planningDate: date,
                weekStartDate: WeekDate.weekStart(for: date),
                remindAt: item.reminder?.remindAt
            )
            Task { _ = await viewModel.saveItem(draft) }
        case .appleReminder(let id):
            guard let task = appleReminders.tasks.first(where: { $0.id == id }), task.canModify else { return false }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: data.household.timezone) ?? .current
            let original = task.dueAt ?? WeekDate.calendarDate(task.dueDate, hour: 9, timeZoneIdentifier: data.household.timezone)
            let targetDay = WeekDate.calendarDate(date, hour: 9, timeZoneIdentifier: data.household.timezone)
            let time = calendar.dateComponents([.hour, .minute], from: original)
            let dueDate = calendar.date(bySettingHour: time.hour ?? 9, minute: time.minute ?? 0, second: 0, of: targetDay) ?? targetDay
            Task {
                try? await appleReminders.update(
                    task,
                    title: task.title,
                    notes: task.notes ?? "",
                    url: task.url.flatMap(URL.init(string:)),
                    priority: task.priority,
                    listId: task.listId,
                    dueDate: dueDate,
                    includesTime: !task.isAllDay,
                    timeZoneIdentifier: data.household.timezone
                )
            }
        case .event(let id):
            guard let event = calendarEvent(id: id, in: data), event.canEdit == true,
                  let originalStart = WeekDate.iso8601.date(from: event.start),
                  let originalEnd = WeekDate.iso8601.date(from: event.end),
                  let calendarId = event.calendarPreferenceId else { return false }
            let duration = originalEnd.timeIntervalSince(originalStart)
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: data.household.timezone) ?? .current
            let time = calendar.dateComponents([.hour, .minute], from: originalStart)
            let targetDay = WeekDate.calendarDate(date, hour: time.hour ?? 9, timeZoneIdentifier: data.household.timezone)
            let newStart = calendar.date(bySettingHour: time.hour ?? 9, minute: time.minute ?? 0, second: 0, of: targetDay) ?? targetDay
            let newEnd = newStart.addingTimeInterval(duration)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = calendar.timeZone
            formatter.dateFormat = "HH:mm"
            let draft = CalendarEventDraft(
                requestId: UUID().uuidString,
                calendarPreferenceId: calendarId,
                sourceCalendarPreferenceId: calendarId,
                providerEventId: event.providerEventId,
                etag: event.etag,
                title: event.title,
                description: event.description ?? "",
                location: event.location ?? "",
                allDay: event.allDay,
                startDate: WeekDate.string(newStart, timeZoneIdentifier: data.household.timezone),
                endDate: WeekDate.string(newEnd, timeZoneIdentifier: data.household.timezone),
                startTime: formatter.string(from: newStart),
                endTime: formatter.string(from: newEnd),
                recurringEventId: event.recurringEventId,
                recurringScope: event.recurringEventId == nil ? nil : "occurrence",
                recurrence: nil,
                guestEmails: nil
            )
            Task { _ = await viewModel.saveEvent(draft, editing: true) }
        }
        return true
    }

    private func updateCommandAvailability() {
        let canToggleCompletion = navigation.selections.contains { selection in
            switch selection {
            case .planningItem(let id):
                return viewModel.data.map { planningItem(id: id, in: $0)?.type == .task } ?? false
            case .appleReminder(let id):
                return appleReminders.tasks.first(where: { $0.id == id })?.canModify == true
            case .event:
                return false
            }
        }
        let canDelete: Bool
        switch navigation.selection {
        case .planningItem: canDelete = true
        case .appleReminder(let id): canDelete = appleReminders.tasks.first(where: { $0.id == id })?.canDelete == true
        case .event(let id):
            canDelete = viewModel.data.flatMap { calendarEvent(id: id, in: $0) }?.canEdit == true
        default: canDelete = false
        }
        commandRouter.updateAvailability(MacPlannerCommandAvailability(
            canCreate: ![.notifications, .settings].contains(navigation.section),
            canSave: unsavedChanges.isDirty,
            canToggleCompletion: canToggleCompletion,
            canDelete: canDelete
        ))
    }

    private var commandAvailability: MacPlannerCommandAvailability {
        MacPlannerCommandAvailability(
            canCreate: commandRouter.availability.canCreate,
            canSave: commandRouter.availability.canSave,
            canToggleCompletion: commandRouter.availability.canToggleCompletion,
            canDelete: commandRouter.availability.canDelete
        )
    }

    private func planningItem(id: String, in data: WeeklyPlannerData) -> PlanningItem? {
        (data.weeklyItems + data.days.flatMap(\.items)).first(where: { $0.id == id })
    }

    private func calendarEvent(id: String, in data: WeeklyPlannerData) -> CalendarEvent? {
        data.days.lazy.flatMap(\.events).first(where: { $0.id == id })
    }

    private func openPendingNotification() async {
        guard let destination = notifications.pendingDestination else { return }
        if case .inbox = destination.target {
            navigation.select(.notifications)
            notifications.consume(destination)
            return
        }
        guard let weekStart = destination.weekStart else { return }
        await viewModel.move(toWeek: weekStart)
        guard let data = viewModel.data, data.weekStart == weekStart else { return }
        switch destination.target {
        case .planningItem(let id):
            if let item = planningItem(id: id, in: data) {
                navigation.select(item.type == .task ? .weekOfUsTasks : .plans)
                navigation.selectPlanningItem(id)
            }
        case .calendarReminder(let id):
            if let event = data.days.lazy.flatMap(\.events).first(where: { $0.reminder?.id == id }) {
                navigation.select(.events)
                navigation.selectEvent(event.id)
            }
        case .inbox:
            break
        }
        notifications.consume(destination)
    }
}

private struct MacWeekHeader: View {
    let data: WeeklyPlannerData
    let section: MacPlannerSection
    let selectedDay: String
    let selectDay: (String) -> Void
    let previousWeek: () -> Void
    let currentWeek: () -> Void
    let nextWeek: () -> Void
    let refresh: () -> Void
    let create: () -> Void
    let dropOnDay: (MacPlannerDragPayload, String) -> Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Eyebrow(text: section.title)
                    Text(WeekDate.weekTitle(data.weekStart))
                        .font(CWTheme.display(30))
                        .tracking(-0.8)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                Spacer()
                if data.isDemo {
                    Label("Device-only preview", systemImage: "sparkles")
                        .font(.caption)
                        .foregroundStyle(CWTheme.accentStrong)
                }
            }
            HStack(spacing: 8) {
                Button(action: previousWeek) { Image(systemName: "chevron.left") }
                    .accessibilityLabel("Previous Week")
                Button("Today", action: currentWeek)
                Button(action: nextWeek) { Image(systemName: "chevron.right") }
                    .accessibilityLabel("Next Week")
                Spacer()
                Button(action: refresh) { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh")
                Button(action: create) { Label("New", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("New Item")
            }
            if section == .week || section == .appleReminders {
                HStack(spacing: 6) {
                    ForEach(data.days) { day in
                        Button {
                            selectDay(day.date)
                        } label: {
                            VStack(spacing: 2) {
                                Text(WeekDate.shortDay(day.date).split(separator: " ").first.map(String.init) ?? "")
                                    .font(.caption2.bold())
                                Text(WeekDate.shortDay(day.date).split(separator: " ").last.map(String.init) ?? "")
                                    .font(.caption)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .foregroundStyle(selectedDay == day.date ? Color.white : CWTheme.secondaryInk)
                            .background(selectedDay == day.date ? CWTheme.brand : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .dropDestination(for: String.self) { values, _ in
                            values.compactMap(MacPlannerDragPayload.init(encoded:)).contains {
                                dropOnDay($0, day.date)
                            }
                        } isTargeted: { _ in }
                        .accessibilityIdentifier("mac-day-\(day.date)")
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(Color(uiColor: .secondarySystemBackground))
        .overlay(alignment: .bottom) { Divider() }
    }
}

private struct MacDayContextBar: View {
    let day: DayPlan
    let unit: TemperatureUnit
    let weatherState: PlannerSourceState
    let openLocation: () -> Void
    let openWeather: (DayPlan) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                if day.location != nil || day.memberLocations.count <= 1 {
                    Button(action: openLocation) {
                        Label(
                            day.location?.name ?? day.memberLocations.first?.location?.name ?? "Set location",
                            systemImage: "location.fill"
                        )
                    }
                    .buttonStyle(.bordered)
                    if let weather = day.weather ?? day.memberLocations.first?.weather,
                       weather.status == "available" {
                        Button { openWeather(weatherDay(location: day.location ?? day.memberLocations.first?.location, weather: weather)) } label: {
                            weatherLabel(weather)
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    ForEach(day.memberLocations) { assignment in
                        Button(action: openLocation) {
                            Label(
                                "\(assignment.displayName): \(assignment.location?.name ?? "Set location")",
                                systemImage: "location.fill"
                            )
                        }
                        .buttonStyle(.bordered)
                        if let weather = assignment.weather, weather.status == "available" {
                            Button { openWeather(weatherDay(location: assignment.location, weather: weather)) } label: {
                                HStack(spacing: 6) {
                                    Text(assignment.displayName).fontWeight(.semibold)
                                    weatherLabel(weather)
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
                if day.location == nil && day.memberLocations.isEmpty {
                    Text("Set a location to add a forecast for this day.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if day.weather == nil && day.memberLocations.allSatisfy({ $0.weather == nil }) {
                    if weatherState.status == "loading" {
                        Label("Updating forecast…", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Label(weatherState.message ?? "Forecast unavailable", systemImage: "cloud.slash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
        }
        .background(Color(uiColor: .secondarySystemBackground))
        .overlay(alignment: .bottom) { Divider() }
        .accessibilityIdentifier("mac-day-context-\(day.date)")
    }

    private func weatherLabel(_ weather: DailyWeather) -> some View {
        HStack(spacing: 6) {
            Image(systemName: weatherIcon(weather.conditionCode)).symbolRenderingMode(.multicolor)
            Text("\(temperature(weather.highF))° / \(temperature(weather.lowF))°")
            if weather.precipitationProbability >= 35 {
                Label("\(weather.precipitationProbability)%", systemImage: "umbrella.fill")
                    .foregroundStyle(.blue)
            }
        }
    }

    private func weatherDay(location: HouseholdLocation?, weather: DailyWeather) -> DayPlan {
        var detail = day
        detail.location = location
        detail.weather = weather
        return detail
    }

    private func temperature(_ fahrenheit: Double) -> Int {
        unit == .fahrenheit
            ? Int(fahrenheit.rounded())
            : Int(((fahrenheit - 32) * 5 / 9).rounded())
    }
}

private struct MacPlannerListPane: View {
    let data: WeeklyPlannerData
    let section: MacPlannerSection
    let selectedDay: String
    @Binding var selections: Set<MacPlannerSelection>
    let searchText: String
    let calendarFilterId: String
    let personFilterId: String
    let toggleItem: (PlanningItem) -> Void
    @ObservedObject var reminders: AppleRemindersStore
    let deleteItem: (PlanningItem) -> Void
    let deleteReminder: (AppleReminderTask) -> Void
    let reschedule: (MacPlannerDragPayload, String) -> Bool

    var body: some View {
        Group {
            if section == .appleReminders {
                reminderContent
            } else {
                plannerList
            }
        }
    }

    private var plannerList: some View {
        List(selection: $selections) {
            switch section {
            case .week:
                if let day = data.days.first(where: { $0.date == selectedDay }) {
                    eventSection(day.events, title: "Events")
                    itemSection(day.items.filter { $0.type == .note }, title: "Plans")
                    itemSection(day.items.filter { $0.type == .task }, title: "Week of Us Tasks")
                    reminderSection(reminders.tasks(for: day.date), title: "Apple Reminders")
                }
            case .events:
                ForEach(data.days) { day in
                    eventSection(day.events, title: WeekDate.longDay(day.date))
                }
            case .plans:
                itemSection(data.weeklyItems.filter { $0.type == .note }, title: "This Week")
                ForEach(data.days) { day in
                    itemSection(day.items.filter { $0.type == .note }, title: WeekDate.longDay(day.date))
                }
            case .weekOfUsTasks:
                itemSection(data.weeklyItems.filter { $0.type == .task }, title: "This Week")
                ForEach(data.days) { day in
                    itemSection(day.items.filter { $0.type == .task }, title: WeekDate.longDay(day.date))
                }
            default:
                EmptyView()
            }
        }
        .listStyle(.inset)
        .overlay {
            if isPlannerSectionEmpty {
                ContentUnavailableView(
                    "Nothing here yet",
                    systemImage: section.icon,
                    description: Text(emptyDescription)
                )
            }
        }
    }

    private var reminderContent: some View {
        VStack(spacing: 0) {
            MacReminderAccessBanner(data: data, store: reminders)
            if reminders.access == .fullAccess {
                List(selection: $selections) {
                    if reminders.selectedLists.isEmpty {
                        Section {
                            Text("Choose at least one Reminders list above. Undated reminders are intentionally excluded.")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(data.days) { day in
                            reminderSection(reminders.tasks(for: day.date), title: WeekDate.longDay(day.date))
                        }
                    }
                }
                .listStyle(.inset)
                .overlay {
                    if !reminders.selectedLists.isEmpty && filteredReminders.isEmpty {
                        ContentUnavailableView(
                            "No due-dated reminders",
                            systemImage: "checklist",
                            description: Text(searchText.isEmpty
                                              ? "This week has no due-dated reminders in the selected lists."
                                              : "No reminders match your search.")
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func itemSection(_ items: [PlanningItem], title: String) -> some View {
        let matches = items.filter(matches)
        if !matches.isEmpty {
            Section(title) {
                ForEach(matches) { item in
                    MacPlanningItemRow(
                        item: item,
                        toggle: { toggleItem(item) },
                        select: { select(.planningItem(item.id)) },
                        delete: { deleteItem(item) }
                    )
                    .tag(MacPlannerSelection.planningItem(item.id))
                    .draggable(MacPlannerDragPayload.planningItem(item.id).encoded)
                }
            }
        }
    }

    @ViewBuilder
    private func eventSection(_ events: [CalendarEvent], title: String) -> some View {
        let matches = events.filter(matches)
        if !matches.isEmpty {
            Section(title) {
                ForEach(matches) { event in
                    HStack(spacing: 10) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color(hex: event.calendarColor))
                            .frame(width: 5, height: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title).foregroundStyle(.primary)
                            Text(event.allDay ? "All day · \(event.calendarAlias)" : "\(eventTimeRange(event)) · \(event.calendarAlias)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                    .tag(MacPlannerSelection.event(event.id))
                    .draggable(MacPlannerDragPayload.event(event.id).encoded)
                    .contextMenu {
                        Button("Open") { select(.event(event.id)) }
                        if event.canEdit == true {
                            Button("Move to Selected Day") {
                                _ = reschedule(.event(event.id), selectedDay)
                            }
                        }
                    }
                    .accessibilityIdentifier("mac-event-\(event.id)")
                }
            }
        }
    }

    @ViewBuilder
    private func reminderSection(_ tasks: [AppleReminderTask], title: String) -> some View {
        let matches = tasks.filter(matches)
        if !matches.isEmpty {
            Section(title) {
                ForEach(matches) { task in
                    MacAppleReminderRow(
                        task: task,
                        toggle: { Task { await reminders.toggle(task) } }
                    )
                        .tag(MacPlannerSelection.appleReminder(task.id))
                        .draggable(MacPlannerDragPayload.appleReminder(task.id).encoded)
                        .contextMenu {
                            Button("Open") { select(.appleReminder(task.id)) }
                            Button(task.isCompleted ? "Reopen Reminder" : "Complete Reminder") {
                                Task { await reminders.toggle(task) }
                            }
                            .disabled(!task.canModify)
                            if task.canModify {
                                Menu("Move to List") {
                                    ForEach(reminders.writableSelectedLists) { list in
                                        Button(list.title) { move(task, to: list.id) }
                                            .disabled(list.id == task.listId)
                                    }
                                }
                                Button("Delete Reminder", role: .destructive) { deleteReminder(task) }
                            }
                        }
                        .accessibilityIdentifier("mac-apple-reminder-\(task.id)")
                }
            }
        }
    }

    private var filteredReminders: [AppleReminderTask] { reminders.tasks.filter(matches) }

    private func select(_ selection: MacPlannerSelection) {
        selections = [selection]
    }

    private var emptyDescription: String {
        if !searchText.isEmpty { return "No items match your search." }
        if section == .events,
           calendarFilterId != CalendarEventFilter.allCalendars || personFilterId != CalendarEventFilter.allPeople {
            return "No events match the selected calendar and person filters."
        }
        return "Use Command-N to add an item."
    }

    private var isPlannerSectionEmpty: Bool {
        switch section {
        case .week:
            guard let day = data.days.first(where: { $0.date == selectedDay }) else { return true }
            return day.events.filter(matches).isEmpty
                && day.items.filter(matches).isEmpty
                && reminders.tasks(for: day.date).filter(matches).isEmpty
        case .events: return data.days.flatMap(\.events).filter(matches).isEmpty
        case .plans: return (data.weeklyItems + data.days.flatMap(\.items)).filter { $0.type == .note && matches($0) }.isEmpty
        case .weekOfUsTasks: return (data.weeklyItems + data.days.flatMap(\.items)).filter { $0.type == .task && matches($0) }.isEmpty
        default: return false
        }
    }

    private func matches(_ item: PlanningItem) -> Bool {
        searchText.isEmpty || item.text.localizedCaseInsensitiveContains(searchText)
    }

    private func matches(_ event: CalendarEvent) -> Bool {
        CalendarEventFilter.matches(event, calendarId: calendarFilterId, personId: personFilterId)
            && (searchText.isEmpty
                || event.title.localizedCaseInsensitiveContains(searchText)
                || event.calendarAlias.localizedCaseInsensitiveContains(searchText))
    }

    private func matches(_ task: AppleReminderTask) -> Bool {
        searchText.isEmpty
            || task.title.localizedCaseInsensitiveContains(searchText)
            || (task.notes?.localizedCaseInsensitiveContains(searchText) ?? false)
            || task.listTitle.localizedCaseInsensitiveContains(searchText)
    }

    private func move(_ task: AppleReminderTask, to listId: String) {
        guard task.canModify else { return }
        let dueDate = task.dueAt ?? WeekDate.calendarDate(
            task.dueDate,
            hour: 9,
            timeZoneIdentifier: data.household.timezone
        )
        Task {
            try? await reminders.update(
                task,
                title: task.title,
                notes: task.notes ?? "",
                url: task.url.flatMap(URL.init(string:)),
                priority: task.priority,
                listId: listId,
                dueDate: dueDate,
                includesTime: !task.isAllDay,
                timeZoneIdentifier: data.household.timezone
            )
        }
    }
}

private struct MacPlanningItemRow: View {
    let item: PlanningItem
    let toggle: () -> Void
    let select: () -> Void
    let delete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if item.type == .task {
                Button(action: toggle) {
                    Image(systemName: item.isCompleted ? "checkmark.square.fill" : "square")
                        .font(.system(size: 18))
                        .foregroundStyle(item.isCompleted ? CWTheme.accent : .secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.isCompleted ? "Reopen task" : "Complete task")
            } else {
                Image(systemName: "circle.fill")
                    .font(.system(size: 7))
                    .foregroundStyle(CWTheme.accent)
                    .frame(width: 18, height: 20)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.text)
                    .foregroundStyle(.primary)
                    .strikethrough(item.isCompleted)
                    .opacity(item.isCompleted ? 0.55 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 6) {
                    Text(item.createdByName ?? "Week of Us")
                    if item.reminder != nil { Image(systemName: "bell.fill") }
                    if let carryoverLabel = item.carryoverLabel { Text("· \(carryoverLabel)") }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button("Open") { select() }
            if item.type == .task {
                Button(item.isCompleted ? "Reopen Task" : "Complete Task", action: toggle)
            }
            Button("Delete Item", role: .destructive, action: delete)
        }
        .accessibilityIdentifier("mac-planning-item-\(item.id)")
    }
}

private struct MacAppleReminderRow: View {
    let task: AppleReminderTask
    let toggle: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button(action: toggle) {
                Image(systemName: task.isCompleted ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18))
                    .foregroundStyle(task.isCompleted ? CWTheme.accent : .secondary)
            }
            .buttonStyle(.plain)
            .disabled(!task.canModify)
            .accessibilityLabel(task.isCompleted ? "Reopen reminder" : "Complete reminder")

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .foregroundStyle(.primary)
                    .strikethrough(task.isCompleted)
                    .opacity(task.isCompleted ? 0.55 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 5) {
                    Label(task.listTitle, systemImage: "checklist")
                    if let dueTime = task.dueTimeLabel { Text("· \(dueTime)") }
                    if task.isRecurring { Image(systemName: "repeat") }
                    if !task.canModify { Image(systemName: "lock.fill") }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                if let carryoverLabel = task.carryoverLabel {
                    Text(carryoverLabel)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

private struct MacReminderAccessBanner: View {
    let data: WeeklyPlannerData
    @ObservedObject var store: AppleRemindersStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch store.access {
            case .notDetermined:
                Label("Show due-dated reminders from lists you choose.", systemImage: "checklist")
                Button("Allow Reminders Access") { Task { await store.requestAccess() } }
                    .buttonStyle(.borderedProminent)
            case .denied, .restricted:
                Label("Reminders access is blocked.", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text("Allow full Reminders access in System Settings to show and update selected lists.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Open System Settings") { openWeekOfUsSettings() }
                    .buttonStyle(.bordered)
            case .fullAccess:
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Reminder Lists").font(.headline)
                        Text("Only due-dated reminders are shown. Reminder contents and identifiers stay on this Mac.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Menu("Choose Lists") {
                        ForEach(store.lists) { list in
                            Button {
                                Task {
                                    await store.setList(
                                        list.id,
                                        selected: !store.selectedListIds.contains(list.id)
                                    )
                                }
                            } label: {
                                Label(
                                    "\(list.title)\(list.canModify ? "" : " · Read-only")",
                                    systemImage: store.selectedListIds.contains(list.id) ? "checkmark" : "circle"
                                )
                            }
                        }
                    }
                    .disabled(store.lists.isEmpty)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground))
        .overlay(alignment: .bottom) { Divider() }
    }
}

private struct MacEmptyInspector: View {
    let section: MacPlannerSection

    var body: some View {
        ContentUnavailableView(
            "No Selection",
            systemImage: section.icon,
            description: Text("Select an item to view or edit its details.")
        )
        .navigationTitle(section.title)
    }
}

private struct MacEventEditorState: Equatable {
    let title: String
    let calendarId: String
    let allDay: Bool
    let start: Date
    let end: Date
    let location: String
    let notes: String
    let recurringScope: String
}

private struct MacEventInspector: View {
    let event: CalendarEvent
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var commandRouter: MacPlannerCommandRouter
    let dirtyChanged: (Bool) -> Void
    let deleted: () -> Void
    @State private var title: String
    @State private var calendarId: String
    @State private var allDay: Bool
    @State private var start: Date
    @State private var end: Date
    @State private var location: String
    @State private var notes: String
    @State private var recurringScope = "occurrence"
    @State private var baseline: MacEventEditorState
    @State private var isSaving = false
    @State private var confirmingDelete = false
    @State private var reminderSelection: String
    @State private var reminderLoaded = false
    @State private var responding = false

    init(
        event: CalendarEvent,
        data: WeeklyPlannerData,
        viewModel: PlannerViewModel,
        commandRouter: MacPlannerCommandRouter,
        dirtyChanged: @escaping (Bool) -> Void,
        deleted: @escaping () -> Void
    ) {
        self.event = event
        self.data = data
        self.viewModel = viewModel
        self.commandRouter = commandRouter
        self.dirtyChanged = dirtyChanged
        self.deleted = deleted
        let start = WeekDate.iso8601.date(from: event.start)
            ?? WeekDate.calendarDate(String(event.start.prefix(10)), hour: 9, timeZoneIdentifier: data.household.timezone)
        let end = WeekDate.iso8601.date(from: event.end) ?? start.addingTimeInterval(3600)
        let calendarId = event.calendarPreferenceId ?? ""
        _title = State(initialValue: event.title)
        _calendarId = State(initialValue: calendarId)
        _allDay = State(initialValue: event.allDay)
        _start = State(initialValue: start)
        _end = State(initialValue: end)
        _location = State(initialValue: event.location ?? "")
        _notes = State(initialValue: event.description ?? "")
        if let reminder = event.reminder,
           let eventStart = WeekDate.iso8601.date(from: event.start),
           let remindAt = WeekDate.iso8601.date(from: reminder.remindAt) {
            _reminderSelection = State(initialValue: String(max(0, Int((eventStart.timeIntervalSince(remindAt) / 60).rounded()))))
        } else {
            _reminderSelection = State(initialValue: "none")
        }
        _baseline = State(initialValue: MacEventEditorState(
            title: event.title,
            calendarId: calendarId,
            allDay: event.allDay,
            start: start,
            end: end,
            location: event.location ?? "",
            notes: event.description ?? "",
            recurringScope: "occurrence"
        ))
    }

    var body: some View {
        Form {
            if event.canEdit == true {
                Section("Calendar Event") {
                    TextField("Title", text: $title)
                    Picker("Calendar", selection: $calendarId) {
                        ForEach(data.editableCalendars) { calendar in Text(calendar.name).tag(calendar.id) }
                    }
                    .disabled(event.recurringEventId != nil && recurringScope == "occurrence")
                    Toggle("All-day event", isOn: $allDay)
                }
                Section("When") {
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    Text("You can also drag this event onto a day in the week header to move the occurrence.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Details") {
                    TextField("Location", text: $location)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...8)
                }
                if event.recurringEventId != nil {
                    Section("Recurring Event") {
                        Picker("Apply changes to", selection: $recurringScope) {
                            Text("This occurrence").tag("occurrence")
                            Text("Entire series").tag("series")
                        }
                        .pickerStyle(.segmented)
                        Text(recurringScope == "series"
                             ? "The full series is updated while its recurrence schedule stays intact."
                             : "Only this occurrence is updated.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    Button(isSaving ? "Saving…" : "Save Changes") { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canSave)
                    Button(event.recurringEventId == nil ? "Delete Event" : "Delete Recurring Event…", role: .destructive) {
                        confirmingDelete = true
                    }
                }
            } else {
                Section("Event") {
                    LabeledContent("Title", value: event.title)
                    LabeledContent("Calendar", value: event.calendarAlias)
                    LabeledContent("When", value: event.allDay ? "All day" : eventTimeRange(event))
                    if let location = event.location, !location.isEmpty { LabeledContent("Location", value: location) }
                    Label("This event is read-only for your Google account.", systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let attendees = event.attendees, !attendees.isEmpty {
                Section("Guests") {
                    ForEach(attendees) { attendee in
                        HStack {
                            Image(systemName: attendee.responseStatus == "accepted" ? "checkmark.circle.fill" : "person.crop.circle")
                                .foregroundStyle(attendee.responseStatus == "accepted" ? CWTheme.accent : .secondary)
                            VStack(alignment: .leading) {
                                Text(attendee.displayName ?? attendee.email)
                                Text(attendee.responseStatus.capitalized).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if attendee.`self` == true { Text("You").font(.caption.bold()).foregroundStyle(CWTheme.accentStrong) }
                        }
                    }
                    if event.canRespond == true {
                        HStack {
                            responseButton("Going", status: "accepted")
                            responseButton("Maybe", status: "tentative")
                            responseButton("Can’t Go", status: "declined")
                        }
                    }
                }
            }
            if !event.allDay {
                Section("Week of Us Reminder") {
                    Picker("Notify me", selection: $reminderSelection) {
                        Text("None").tag("none")
                        Text("At start time").tag("0")
                        Text("10 minutes before").tag("10")
                        Text("30 minutes before").tag("30")
                        Text("1 hour before").tag("60")
                        Text("1 day before").tag("1440")
                    }
                }
            }
            if let googleURL = event.googleUrl.flatMap(URL.init(string:)) {
                Section { Link("Open in Google Calendar", destination: googleURL) }
            }
            Section {
                Button("Hide from Week of Us", role: .destructive) {
                    Task { if await viewModel.hideEvent(event) { dirtyChanged(false); deleted() } }
                }
            }
        }
        .formStyle(.grouped)
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .navigationTitle(isDirty ? "Event — Edited" : "Event")
        .onAppear { dirtyChanged(isDirty) }
        .task { reminderLoaded = true }
        .onChange(of: reminderSelection) { _, value in
            guard reminderLoaded else { return }
            Task { _ = await viewModel.setCalendarReminder(event, remindAt: reminderDate(for: value)) }
        }
        .onChange(of: editorState) { _, _ in dirtyChanged(isDirty) }
        .onChange(of: recurringScope) { _, scope in
            if scope == "occurrence", let source = event.calendarPreferenceId { calendarId = source }
        }
        .onChange(of: commandRouter.revision) { _, _ in
            if commandRouter.command == .save, event.canEdit == true { Task { await save() } }
            if commandRouter.command == .delete, event.canEdit == true { confirmingDelete = true }
        }
        .confirmationDialog(
            event.recurringEventId == nil ? "Delete this event from Google Calendar?" : "Delete this recurring event?",
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(event.recurringEventId == nil ? "Delete Event" : "Delete This Occurrence", role: .destructive) {
                Task { await delete(scope: "occurrence") }
            }
            if event.recurringEventId != nil {
                Button("Delete Entire Series", role: .destructive) { Task { await delete(scope: "series") } }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This changes Google Calendar and cannot be undone from Week of Us.")
        }
    }

    private var editorState: MacEventEditorState {
        MacEventEditorState(
            title: title,
            calendarId: calendarId,
            allDay: allDay,
            start: start,
            end: end,
            location: location,
            notes: notes,
            recurringScope: recurringScope
        )
    }

    private var isDirty: Bool { editorState != baseline }
    private var canSave: Bool {
        event.canEdit == true
            && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !calendarId.isEmpty
            && end >= start
            && !isSaving
    }

    private func save() async {
        guard canSave else { return }
        isSaving = true
        defer { isSaving = false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: data.household.timezone) ?? .current
        formatter.dateFormat = "HH:mm"
        let draft = CalendarEventDraft(
            requestId: UUID().uuidString,
            calendarPreferenceId: calendarId,
            sourceCalendarPreferenceId: event.calendarPreferenceId,
            providerEventId: event.providerEventId,
            etag: event.etag,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            description: notes,
            location: location,
            allDay: allDay,
            startDate: WeekDate.string(start, timeZoneIdentifier: data.household.timezone),
            endDate: WeekDate.string(end, timeZoneIdentifier: data.household.timezone),
            startTime: formatter.string(from: start),
            endTime: formatter.string(from: end),
            recurringEventId: event.recurringEventId,
            recurringScope: event.recurringEventId == nil ? nil : recurringScope,
            recurrence: nil,
            guestEmails: nil
        )
        if await viewModel.saveEvent(draft, editing: true) {
            baseline = editorState
            dirtyChanged(false)
        }
    }

    private func delete(scope: String) async {
        if await viewModel.deleteEvent(event, scope: scope) {
            dirtyChanged(false)
            deleted()
        }
    }

    private func responseButton(_ label: String, status: String) -> some View {
        Button(label) {
            Task {
                responding = true
                _ = await viewModel.respondToEvent(event, responseStatus: status)
                responding = false
            }
        }
        .disabled(responding)
    }

    private func reminderDate(for value: String) -> String? {
        guard value != "none", let minutes = Int(value),
              let eventStart = WeekDate.iso8601.date(from: event.start) else { return nil }
        return WeekDate.iso8601.string(from: eventStart.addingTimeInterval(TimeInterval(-minutes * 60)))
    }
}

private struct MacPlanningItemEditorState: Equatable {
    let text: String
    let type: PlanningItemType
    let date: Date?
    let reminderEnabled: Bool
    let reminderDate: Date?
}

private struct MacReminderEditorState: Equatable {
    let title: String
    let notes: String
    let urlText: String
    let priority: AppleReminderPriority
    let listId: String
    let dueDate: Date
    let includesTime: Bool
}

private struct MacPlanningItemInspector: View {
    let item: PlanningItem
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @ObservedObject var commandRouter: MacPlannerCommandRouter
    let requestDelete: () -> Void
    let dirtyChanged: (Bool) -> Void
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var date: Date
    @State private var reminderEnabled: Bool
    @State private var reminderDate: Date
    @State private var isSaving = false
    @State private var baseline: MacPlanningItemEditorState
    @State private var showingTaskMigration = false

    init(
        item: PlanningItem,
        data: WeeklyPlannerData,
        viewModel: PlannerViewModel,
        appleReminders: AppleRemindersStore,
        commandRouter: MacPlannerCommandRouter,
        requestDelete: @escaping () -> Void,
        dirtyChanged: @escaping (Bool) -> Void
    ) {
        self.item = item
        self.data = data
        self.viewModel = viewModel
        self.appleReminders = appleReminders
        self.commandRouter = commandRouter
        self.requestDelete = requestDelete
        self.dirtyChanged = dirtyChanged
        _text = State(initialValue: item.text)
        _type = State(initialValue: item.type)
        _date = State(initialValue: item.planningDate.map {
            WeekDate.calendarDate($0, hour: 9, timeZoneIdentifier: data.household.timezone)
        } ?? Date())
        let reminder = item.reminder.flatMap { WeekDate.iso8601.date(from: $0.remindAt) }
        _reminderEnabled = State(initialValue: reminder != nil)
        _reminderDate = State(initialValue: reminder ?? Date().addingTimeInterval(3600))
        _baseline = State(initialValue: MacPlanningItemEditorState(
            text: item.text,
            type: item.type,
            date: item.planningDate.map {
                WeekDate.calendarDate($0, hour: 9, timeZoneIdentifier: data.household.timezone)
            },
            reminderEnabled: reminder != nil,
            reminderDate: reminder
        ))
    }

    var body: some View {
        Form {
            Section("Week of Us Item") {
                TextField("What needs doing?", text: $text, axis: .vertical)
                    .lineLimit(3...8)
                Picker("Type", selection: $type) {
                    Text("Plan or note").tag(PlanningItemType.note)
                    Text("Task").tag(PlanningItemType.task)
                }
                if item.planningDate != nil {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                } else {
                    LabeledContent("When", value: "This week")
                }
            }
            Section("Reminder") {
                Toggle("Remind me", isOn: $reminderEnabled)
                if reminderEnabled {
                    DatePicker("At", selection: $reminderDate, displayedComponents: [.date, .hourAndMinute])
                }
            }
            Section {
                if item.type == .task {
                    Button(item.isCompleted ? "Reopen Task" : "Complete Task") {
                        Task { await viewModel.toggle(item) }
                    }
                    if !appleReminders.writableSelectedLists.isEmpty {
                        Button("Move to Apple Reminders…") { showingTaskMigration = true }
                            .disabled(isDirty)
                    }
                }
                Button(isSaving ? "Saving…" : "Save Changes") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                Button("Delete Item", role: .destructive, action: requestDelete)
            }
        }
        .formStyle(.grouped)
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .navigationTitle(isDirty ? "\(item.type.title) — Edited" : item.type.title)
        .onAppear { dirtyChanged(isDirty) }
        .onChange(of: editorState) { _, _ in dirtyChanged(isDirty) }
        .onChange(of: commandRouter.revision) { _, _ in
            if commandRouter.command == .save { Task { await save() } }
        }
        .sheet(isPresented: $showingTaskMigration) {
            CustomTaskMigrationView(
                item: item,
                data: data,
                store: appleReminders,
                viewModel: viewModel,
                onMoved: { dirtyChanged(false) }
            )
            .frame(minWidth: 520, idealWidth: 620, minHeight: 520, idealHeight: 650)
        }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        let planningDate = item.planningDate == nil
            ? nil
            : WeekDate.string(date, timeZoneIdentifier: data.household.timezone)
        let draft = PlanningItemDraft(
            id: item.id,
            text: text.trimmingCharacters(in: .whitespacesAndNewlines),
            type: type,
            planningDate: planningDate,
            weekStartDate: planningDate.map(WeekDate.weekStart) ?? data.weekStart,
            remindAt: reminderEnabled ? WeekDate.iso8601.string(from: reminderDate) : nil
        )
        if await viewModel.saveItem(draft) {
            baseline = editorState
            dirtyChanged(false)
        }
    }

    private var editorState: MacPlanningItemEditorState {
        MacPlanningItemEditorState(
            text: text,
            type: type,
            date: item.planningDate == nil ? nil : date,
            reminderEnabled: reminderEnabled,
            reminderDate: reminderEnabled ? reminderDate : nil
        )
    }

    private var isDirty: Bool { editorState != baseline }
}

private struct MacAppleReminderInspector: View {
    let task: AppleReminderTask
    let data: WeeklyPlannerData
    @ObservedObject var store: AppleRemindersStore
    @ObservedObject var commandRouter: MacPlannerCommandRouter
    let requestDelete: () -> Void
    let dirtyChanged: (Bool) -> Void
    @State private var title: String
    @State private var notes: String
    @State private var urlText: String
    @State private var priority: AppleReminderPriority
    @State private var listId: String
    @State private var dueDate: Date
    @State private var includesTime: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var baseline: MacReminderEditorState

    init(
        task: AppleReminderTask,
        data: WeeklyPlannerData,
        store: AppleRemindersStore,
        commandRouter: MacPlannerCommandRouter,
        requestDelete: @escaping () -> Void,
        dirtyChanged: @escaping (Bool) -> Void
    ) {
        self.task = task
        self.data = data
        self.store = store
        self.commandRouter = commandRouter
        self.requestDelete = requestDelete
        self.dirtyChanged = dirtyChanged
        _title = State(initialValue: task.title)
        _notes = State(initialValue: task.notes ?? "")
        _urlText = State(initialValue: task.url ?? "")
        _priority = State(initialValue: task.priority)
        _listId = State(initialValue: task.listId)
        _dueDate = State(initialValue: task.dueAt ?? WeekDate.calendarDate(
            task.dueDate,
            hour: 9,
            timeZoneIdentifier: data.household.timezone
        ))
        _includesTime = State(initialValue: !task.isAllDay)
        _baseline = State(initialValue: MacReminderEditorState(
            title: task.title,
            notes: task.notes ?? "",
            urlText: task.url ?? "",
            priority: task.priority,
            listId: task.listId,
            dueDate: task.dueAt ?? WeekDate.calendarDate(
                task.dueDate,
                hour: 9,
                timeZoneIdentifier: data.household.timezone
            ),
            includesTime: !task.isAllDay
        ))
    }

    var body: some View {
        Form {
            Section("Apple Reminder") {
                TextField("What needs doing?", text: $title, axis: .vertical)
                    .lineLimit(3...8)
                    .disabled(!task.canModify)
                Picker("List", selection: $listId) {
                    ForEach(listChoices) { list in Text(list.title).tag(list.id) }
                }
                .disabled(!task.canModify)
                if task.isRecurring {
                    Label(
                        task.canModify
                            ? "Changes keep the existing repeat schedule."
                            : "This recurring reminder is read-only.",
                        systemImage: task.canModify ? "repeat" : "lock.fill"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } else if !task.canModify {
                    Label("This Reminders list is read-only.", systemImage: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Section("Due") {
                DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                    .disabled(!task.canModify)
                Toggle("Include due time", isOn: $includesTime)
                    .disabled(!task.canModify)
                if includesTime {
                    DatePicker("Time", selection: $dueDate, displayedComponents: .hourAndMinute)
                        .disabled(!task.canModify)
                }
            }
            Section("Details") {
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3...8)
                    .disabled(!task.canModify)
                Picker("Priority", selection: $priority) {
                    ForEach(AppleReminderPriority.allCases) { Text($0.title).tag($0) }
                }
                .disabled(!task.canModify)
                TextField("URL", text: $urlText)
                    .textInputAutocapitalization(.never)
                    .disabled(!task.canModify)
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            Section {
                Button(task.isCompleted ? "Reopen Reminder" : "Complete Reminder") {
                    Task { await store.toggle(task) }
                }
                .disabled(!task.canModify)
                if task.canModify {
                    Button(isSaving ? "Saving…" : "Save Changes") { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                    Button("Delete Reminder", role: .destructive, action: requestDelete)
                }
            }
        }
        .formStyle(.grouped)
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .navigationTitle(isDirty ? "Apple Reminder — Edited" : "Apple Reminder")
        .onAppear { dirtyChanged(isDirty) }
        .onChange(of: editorState) { _, _ in dirtyChanged(isDirty) }
        .onChange(of: commandRouter.revision) { _, _ in
            if commandRouter.command == .save, task.canModify { Task { await save() } }
        }
    }

    private var listChoices: [AppleReminderList] {
        let writable = store.writableSelectedLists
        guard !writable.contains(where: { $0.id == task.listId }) else { return writable }
        let current = store.lists.first(where: { $0.id == task.listId })
            ?? AppleReminderList(id: task.listId, title: task.listTitle, sourceTitle: "", canModify: task.canModify)
        return [current] + writable
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let trimmedURL = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
            let url: URL?
            if trimmedURL.isEmpty {
                url = nil
            } else if let candidate = URL(string: trimmedURL), candidate.scheme != nil {
                url = candidate
            } else {
                errorMessage = "Enter a complete URL, including https://."
                return
            }
            try await store.update(
                task,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: notes,
                url: url,
                priority: priority,
                listId: listId,
                dueDate: dueDate,
                includesTime: includesTime,
                timeZoneIdentifier: data.household.timezone
            )
            baseline = editorState
            dirtyChanged(false)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var editorState: MacReminderEditorState {
        MacReminderEditorState(
            title: title,
            notes: notes,
            urlText: urlText,
            priority: priority,
            listId: listId,
            dueDate: dueDate,
            includesTime: includesTime
        )
    }

    private var isDirty: Bool { editorState != baseline }
}

private struct MacNewAppleReminderView: View {
    let data: WeeklyPlannerData
    @ObservedObject var store: AppleRemindersStore
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var listId: String
    @State private var dueDate: Date
    @State private var includesTime = false
    @State private var notes = ""
    @State private var urlText = ""
    @State private var priority = AppleReminderPriority.none
    @State private var recurrence = AppleReminderRecurrenceDraft()
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(date: String, data: WeeklyPlannerData, store: AppleRemindersStore) {
        self.data = data
        self.store = store
        _listId = State(initialValue: store.writableSelectedLists.first?.id ?? "")
        _dueDate = State(initialValue: WeekDate.calendarDate(
            date,
            hour: 9,
            timeZoneIdentifier: data.household.timezone
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Apple Reminder") {
                    TextField("What needs doing?", text: $title, axis: .vertical)
                    Picker("List", selection: $listId) {
                        ForEach(store.writableSelectedLists) { Text($0.title).tag($0.id) }
                    }
                }
                Section("Due") {
                    DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                    Toggle("Include due time", isOn: $includesTime)
                    if includesTime {
                        DatePicker("Time", selection: $dueDate, displayedComponents: .hourAndMinute)
                    }
                }
                AppleReminderRecurrenceEditor(
                    draft: $recurrence,
                    dueDate: dueDate,
                    timeZoneIdentifier: data.household.timezone
                )
                Section("Details") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...8)
                    Picker("Priority", selection: $priority) {
                        ForEach(AppleReminderPriority.allCases) { Text($0.title).tag($0) }
                    }
                    TextField("URL", text: $urlText)
                        .textInputAutocapitalization(.never)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New Apple Reminder")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || listId.isEmpty || isSaving)
                }
            }
        }
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let trimmedURL = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
            let url: URL?
            if trimmedURL.isEmpty {
                url = nil
            } else if let candidate = URL(string: trimmedURL), candidate.scheme != nil {
                url = candidate
            } else {
                errorMessage = "Enter a complete URL, including https://."
                return
            }
            try await store.createReminder(
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                listId: listId,
                dueDate: dueDate,
                includesTime: includesTime,
                timeZoneIdentifier: data.household.timezone,
                notes: notes,
                url: url,
                priority: priority,
                recurrence: recurrence.recurrence(
                    starting: dueDate,
                    timeZoneIdentifier: data.household.timezone
                )
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum MacSearchKind: String, CaseIterable, Identifiable {
    case all
    case events
    case plans
    case tasks

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

private enum MacSearchDateRange: String, CaseIterable, Identifiable {
    case anyDate
    case thisWeek
    case past
    case upcoming

    var id: String { rawValue }
    var title: String {
        switch self {
        case .anyDate: "Any Date"
        case .thisWeek: "This Week"
        case .past: "Past"
        case .upcoming: "Upcoming"
        }
    }
}

private struct MacPlannerSearchView: View {
    @ObservedObject var viewModel: PlannerViewModel
    let open: (PlannerSearchResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var kind = MacSearchKind.all
    @State private var dateRange = MacSearchDateRange.anyDate
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var queryFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Picker("Type", selection: $kind) {
                        ForEach(MacSearchKind.allCases) { Text($0.title).tag($0) }
                    }
                    Picker("Date", selection: $dateRange) {
                        ForEach(MacSearchDateRange.allCases) { Text($0.title).tag($0) }
                    }
                    Spacer()
                    Text("Apple Reminders stay on this Mac and are searched in the active week.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                Divider()
                Group {
                    if query.count < 2 {
                        ContentUnavailableView(
                            "Search your planner",
                            systemImage: "magnifyingglass",
                            description: Text("Find Week of Us plans, tasks, and calendar events across weeks.")
                        )
                    } else if viewModel.isSearching {
                        ProgressView("Searching…")
                    } else if filteredResults.isEmpty {
                        ContentUnavailableView.search(text: query)
                    } else {
                        List(filteredResults) { result in
                            Button {
                                dismiss()
                                open(result)
                            } label: {
                                searchRow(result)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("mac-search-result-\(result.id)")
                        }
                        .listStyle(.plain)
                    }
                }
            }
            .searchable(text: $query, prompt: "Search events, plans, and tasks")
            .searchFocused($queryFocused)
            .onAppear { queryFocused = true }
            .onChange(of: query) { _, newValue in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    await viewModel.search(newValue)
                }
            }
            .navigationTitle("Search")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private var filteredResults: [PlannerSearchResult] {
        viewModel.searchResults.filter { matchesKind($0) && matchesDate($0) }
    }

    @ViewBuilder
    private func searchRow(_ result: PlannerSearchResult) -> some View {
        switch result {
        case .planningItem(let item):
            HStack(spacing: 12) {
                Image(systemName: item.type == .task ? (item.isCompleted ? "checkmark.square.fill" : "square") : "note.text")
                    .foregroundStyle(CWTheme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.text).foregroundStyle(CWTheme.ink)
                    Text(item.planningDate.map(WeekDate.longDay) ?? "Week of \(item.weekStartDate)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
        case .calendarEvent(let event):
            HStack(spacing: 12) {
                Image(systemName: "calendar").foregroundStyle(Color(hex: event.calendarColor))
                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title).foregroundStyle(CWTheme.ink)
                    Text("\(WeekDate.longDay(event.start)) · \(event.calendarAlias)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
    }

    private func matchesKind(_ result: PlannerSearchResult) -> Bool {
        switch (kind, result) {
        case (.all, _): true
        case (.events, .calendarEvent): true
        case (.plans, .planningItem(let item)): item.type == .note
        case (.tasks, .planningItem(let item)): item.type == .task
        default: false
        }
    }

    private func matchesDate(_ result: PlannerSearchResult) -> Bool {
        guard dateRange != .anyDate else { return true }
        let date: String
        switch result {
        case .planningItem(let item): date = item.planningDate ?? item.weekStartDate
        case .calendarEvent(let event): date = String(event.start.prefix(10))
        }
        let timeZone = viewModel.data?.household.timezone ?? TimeZone.current.identifier
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        switch dateRange {
        case .anyDate: return true
        case .thisWeek:
            let week = WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
            return date >= week && date < WeekDate.addDays(7, to: week)
        case .past: return date < today
        case .upcoming: return date >= today
        }
    }
}

private struct MacNotificationsView: View {
    @ObservedObject var coordinator: NotificationCoordinator

    var body: some View {
        Group {
            if coordinator.inbox.items.isEmpty {
                ContentUnavailableView(
                    "You’re all caught up",
                    systemImage: "bell",
                    description: Text("Reminders and household updates will appear here.")
                )
            } else {
                List(coordinator.inbox.items) { item in
                    Button {
                        Task { await coordinator.markRead(item.id) }
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(item.title)
                                    .fontWeight(item.readAt == nil ? .bold : .semibold)
                                    .foregroundStyle(CWTheme.ink)
                                if item.readAt == nil {
                                    Circle().fill(CWTheme.accent).frame(width: 7, height: 7)
                                }
                                Spacer()
                            }
                            Text(item.body)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(item.readAt == nil ? CWTheme.mint.opacity(0.4) : Color.clear)
                }
                .listStyle(.insetGrouped)
                .refreshable { await coordinator.refreshInbox() }
            }
        }
        .navigationTitle("Notifications")
        .toolbar {
            if coordinator.inbox.unreadCount > 0 {
                ToolbarItem(placement: .primaryAction) {
                    Button("Mark All Read") { Task { await coordinator.markAllRead() } }
                }
            }
        }
        .task { await coordinator.refreshInbox() }
    }
}

private func openWeekOfUsSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
}
#endif
