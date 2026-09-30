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
    case item(date: String?, type: PlanningItemType, allowsAppleReminderDestination: Bool)
    case reminder(date: String)
    case event(date: String, slot: CalendarTimeSlot? = nil, calendarId: String? = nil)
    case search
    case coverage
    case shareWeek
    case taskWorkspace(String? = nil)
    case familyPlanning
    case weather(DayPlan)
    case location(DayPlan)

    var id: String {
        switch self {
        case .item(let date, let type, _): "item-\(date ?? "weekly")-\(type.rawValue)"
        case .reminder(let date): "reminder-\(date)"
        case .event(let date, _, _): "event-\(date)"
        case .coverage: "coverage"
        case .shareWeek: "share-week"
        case .taskWorkspace: "task-workspace"
        case .familyPlanning: "family-planning"
        case .search: "search"
        case .weather(let day): "weather-\(day.date)-\(day.location?.id ?? "household")"
        case .location(let day): "location-\(day.date)"
        }
    }

    var preferredWidth: CGFloat {
        switch self {
        case .coverage, .shareWeek: 700
        case .taskWorkspace: 700
        case .familyPlanning: 700
        case .item: 540
        case .reminder, .location: 600
        case .event, .search: 680
        case .weather: 580
        }
    }

    var preferredHeight: CGFloat {
        switch self {
        case .coverage, .shareWeek: 780
        case .taskWorkspace: 780
        case .familyPlanning: 780
        case .item: 450
        case .reminder, .event, .location: 720
        case .search: 620
        case .weather: 660
        }
    }
}

private enum MacWeekCreationKind {
    case event
    case note
    case task
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
    @StateObject private var inlineComposer = MacInlineComposer()
    @StateObject private var navigation: MacPlannerNavigation
    @StateObject private var commandRouter = MacPlannerCommandRouter()
    @StateObject private var appleReminders = AppleRemindersStore.shared
    @ObservedObject private var notifications = NotificationCoordinator.shared
    @State private var sheet: MacPlannerSheet?
    @StateObject private var detailsPopover = MacDetailsPopoverStore()
    @State private var deletionTarget: MacDeletionTarget?
    @State private var searchText = ""
    @State private var calendarPresentation: CalendarPresentation = .list
    @State private var calendarRange: CalendarRange = .day
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
        .environmentObject(detailsPopover)
        .environmentObject(viewModel)
        .frame(minWidth: 760, maxWidth: .infinity, minHeight: 560, maxHeight: .infinity)
        .background(MacPlannerWindowSizing())
        .focusedSceneValue(\.macPlannerCommandRouter, detailsPopover.commandRouter ?? commandRouter)
        .focusedSceneValue(\.macPlannerCommandAvailability, detailsPopover.commandAvailability ?? commandAvailability)
        .searchable(text: $searchText, prompt: "Search this week")
        .searchFocused($searchFocused)
        .sheet(item: $sheet) { sheet in
            sheetView(sheet)
                .frame(width: sheet.preferredWidth, height: sheet.preferredHeight)
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
        .onChange(of: commandRouter.revision) { _, _ in handleCommand() }
        .onChange(of: navigation.selection) { _, _ in updateCommandAvailability() }
        .onChange(of: navigation.selections) { _, _ in updateCommandAvailability() }
        .onChange(of: navigation.section) { _, _ in updateCommandAvailability() }
        .task { updateCommandAvailability() }
        .task(id: viewModel.data?.weekStart) {
            if MacAppStoreScreenshot.current?.selection != nil { openDetails() }
        }
        .task(id: "\(String(describing: notifications.pendingDestination))-\(viewModel.data?.weekStart ?? "loading")") { await openPendingNotification() }
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
                    .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 250)
            } detail: {
                mainColumn(data)
            }
            .navigationSplitViewStyle(.balanced)
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
            }
        }
    }

    private func sidebar(_ data: WeeklyPlannerData) -> some View {
        VStack(spacing: 0) {
            List(selection: sidebarSelection) {
                Section("Planner") {
                    Button { sheet = .coverage } label: { Label("Pickup & drop-off", systemImage: "car.side") }
                    Button { sheet = .shareWeek } label: { Label("Share week", systemImage: "square.and.arrow.up") }
                    Button { sheet = .taskWorkspace() } label: { Label("Tasks & backlog", systemImage: "checklist") }
                    Button { sheet = .familyPlanning } label: { Label("Plan your week", systemImage: "person.2.badge.gearshape") }
                        .accessibilityIdentifier("family-planning-open")
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
            }
            .listStyle(.sidebar)
            .font(.system(size: 13))
            .environment(\.defaultMinListRowHeight, 34)

            Divider()

            MacSidebarIdentity(householdName: data.household.name, email: user.email)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
        .navigationTitle("Week of Us")
    }

    private struct MacSidebarIdentity: View {
        let householdName: String
        let email: String

        var body: some View {
            VStack(alignment: .leading, spacing: 11) {
                BrandMark(iconSize: 36, titleSize: 17)

                Divider()

                HStack(spacing: 10) {
                    ZStack {
                        Circle()
                            .fill(CWTheme.accent.opacity(0.14))
                        Image(systemName: "person.2.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(CWTheme.accentStrong)
                    }
                    .frame(width: 32, height: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(householdName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text(email)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .lineLimit(1)
                    .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Week of Us, \(householdName), \(email)")
        }
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
            MacNotificationsView(coordinator: notifications, openReview: { item in
                Task { await openReviewNotification(item) }
            })
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
                    previousWeek: { request(.weekOffset(-7)) },
                    currentWeek: { request(.currentWeek) },
                    nextWeek: { request(.weekOffset(7)) },
                    refresh: { commandRouter.perform(.refresh) },
                    create: { commandRouter.perform(.newItem) },
                    createFromWeek: openWeekCreation
                )
                if navigation.section == .week || navigation.section == .events {
                    VStack(alignment: .leading, spacing: 10) {
                        if calendarRange == .day {
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 20) {
                                    CalendarPresentationPicker(range: $calendarRange, selection: $calendarPresentation)
                                        .frame(width: 346)
                                    dayPicker(data).frame(minWidth: 350)
                                }
                                VStack(spacing: 10) {
                                    CalendarPresentationPicker(range: $calendarRange, selection: $calendarPresentation)
                                    dayPicker(data)
                                }
                            }
                        } else {
                            CalendarPresentationPicker(range: $calendarRange, selection: $calendarPresentation)
                        }
                        CalendarFilterControls(
                            calendars: CalendarEventFilter.calendars(in: data),
                            members: data.members,
                            children: data.childProfiles ?? [],
                            calendarId: $calendarFilterId,
                            personId: $personFilterId
                        )
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(uiColor: .secondarySystemBackground))
                    .overlay(alignment: .bottom) { Divider() }
                }
                if navigation.section == .week, calendarPresentation == .calendar, calendarRange == .day,
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
                if (navigation.section == .week || navigation.section == .events) && calendarPresentation == .calendar {
                    CalendarTimelineView(
                        days: data.days.filter { calendarRange == .week || $0.date == navigation.selectedDay }.map { day in
                            var filtered = day
                            filtered.events = day.events.filter {
                                CalendarEventFilter.matches($0, calendarId: calendarFilterId, personId: personFilterId)
                                && (searchText.isEmpty || $0.title.localizedCaseInsensitiveContains(searchText) || $0.calendarAlias.localizedCaseInsensitiveContains(searchText))
                            }
                            return filtered
                        },
                        timezone: data.household.timezone,
                        sourceState: data.calendarState,
                        onEvent: { request(.selection(.event($0.id))) },
                        onDay: { request(.day($0)); calendarRange = .day },
                        canCreate: !data.editableCalendars.isEmpty,
                        onCreate: { slot in sheet = .event(date: slot.date, slot: slot, calendarId: data.editableCalendars.first(where: { $0.id == calendarFilterId })?.id) },
                        onMove: { await viewModel.saveEvent($0, editing: true) }
                    ) {
                        CalendarPlanningPane(
                            days: data.days.filter { calendarRange == .week || $0.date == navigation.selectedDay },
                            weeklyItems: data.weeklyItems, personId: personFilterId,
                            currentUserId: user.userId, canEdit: user.role != "viewer", searchText: searchText,
                            viewModel: viewModel, appleReminders: appleReminders,
                            onEdit: { request(.selection(.planningItem($0.id))) },
                            onAdd: { sheet = .item(date: $0, type: $1, allowsAppleReminderDestination: $0 != nil && $1 == .task) },
                            onReminder: { request(.selection(.appleReminder($0.id))) }
                        )
                    }.padding(16)
                    Spacer(minLength: 0)
                } else {
                    MacPlannerListPane(
                        data: data,
                        composer: inlineComposer,
                        canEdit: viewModel.canEditHousehold,
                        saveDraft: saveInlineDraft,
                        createEvent: { date in
                            sheet = .event(date: date, calendarId: data.editableCalendars.first(where: { $0.id == calendarFilterId })?.id)
                        },
                        section: navigation.section,
                        selectedDay: navigation.selectedDay,
                        calendarRange: calendarRange,
                        currentUserId: user.userId,
                        selections: Binding(
                            get: { navigation.selections },
                            set: { request(.selections($0)) }
                        ),
                        openSelection: { request(.selection($0)) },
                        searchText: searchText,
                        calendarFilterId: calendarFilterId,
                        personFilterId: personFilterId,
                        toggleItem: { item in Task { await viewModel.toggle(item) } },
                        reminders: appleReminders,
                        deleteItem: { deletionTarget = .planningItem($0) },
                        deleteReminder: { deletionTarget = .reminder($0) },
                        reschedule: reschedule(_:to:),
                        openLocation: { sheet = .location($0) },
                        openWeather: { sheet = .weather($0) }
                    )
                }
            }
            .navigationTitle(navigation.section.title)
            .background(alignment: .topTrailing) {
                // Search and notifications can open items whose rows are offscreen.
                Color.clear.frame(width: 1, height: 1)
                    .modifier(MacDetailsPopoverAnchor(selection: nil))
            }
        }
    }

    private func dayPicker(_ data: WeeklyPlannerData) -> some View {
        MacDayPicker(
            days: data.days, selectedDay: navigation.selectedDay,
            selectDay: { request(.day($0)) }, dropOnDay: reschedule(_:to:)
        )
    }

    @ViewBuilder
    private func sheetView(_ sheet: MacPlannerSheet) -> some View {
        if let data = viewModel.data {
            switch sheet {
            case .coverage: CoverageView(planner: data, viewModel: viewModel)
            case .shareWeek: WeekShareView(planner: data, viewModel: viewModel)
            case .taskWorkspace(let id): TaskWorkspaceView(planner: data, viewModel: viewModel, initialItemId: id)
            case .familyPlanning:
                FamilyPlanningView(planner: data, viewModel: viewModel)
            case .item(let date, let type, let allowsAppleReminderDestination):
                ItemEditorView(
                    item: nil,
                    planningDate: date,
                    defaultType: type,
                    data: data,
                    viewModel: viewModel,
                    appleReminders: appleReminders,
                    allowsAppleReminderDestination: allowsAppleReminderDestination
                )
            case .reminder(let date):
                MacNewAppleReminderView(date: date, data: data, store: appleReminders)
            case .event(let date, let slot, let calendarId):
                CalendarEventEditorView(event: nil, date: date, data: data, viewModel: viewModel, initialSlot: slot, initialCalendarId: calendarId)
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
            case .plans:
                sheet = .item(date: nil, type: .note, allowsAppleReminderDestination: false)
            case .appleReminders:
                if appleReminders.writableSelectedLists.isEmpty {
                    appleReminders.notice = "Choose a writable Reminders list before creating a reminder."
                } else {
                    sheet = .reminder(date: date)
                }
            case .week:
                sheet = .item(date: date, type: .task, allowsAppleReminderDestination: true)
            case .weekOfUsTasks:
                sheet = .item(date: nil, type: .task, allowsAppleReminderDestination: false)
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
            break // The active details popover owns Save commands.
        case .settings:
            openWindow(id: "settings")
        }
    }

    private func openWeekCreation(_ kind: MacWeekCreationKind) {
        let date = navigation.selectedDay.isEmpty
            ? viewModel.data?.weekStart ?? WeekDate.string(Date())
            : navigation.selectedDay
        switch kind {
        case .event:
            sheet = .event(date: date)
        case .note:
            sheet = .item(date: date, type: .note, allowsAppleReminderDestination: false)
        case .task:
            sheet = .item(date: date, type: .task, allowsAppleReminderDestination: true)
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
                    navigation.clearSelection()
                }
            case .reminder(let reminder):
                do {
                    try await appleReminders.delete(reminder)
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
           personFilterId != CalendarEventFilter.unassigned,
           !data.members.contains(where: { $0.userId == personFilterId }),
           !(data.childProfiles ?? []).contains(where: { $0.id == personFilterId }) {
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
        execute(intent)
    }

    private func execute(_ intent: MacNavigationIntent) {
        switch intent {
        case .section(let section):
            navigation.select(section)
        case .day(let date):
            if navigation.section == .events {
                navigation.selectedDay = date
                navigation.clearSelection()
            } else {
                navigation.selectDay(date)
            }
        case .closeDetails:
            break
        case .selection(let selection):
            switch selection {
            case .planningItem(let id): navigation.selectPlanningItem(id)
            case .event(let id): navigation.selectEvent(id)
            case .appleReminder(let id): navigation.selectAppleReminder(id)
            }
            openDetails()
        case .selections(let selections):
            navigation.selectMany(selections)
        case .weekOffset(let days):
            Task { await viewModel.moveWeek(by: days) }
        case .currentWeek:
            navigation.selectedDay = WeekDate.string(Date(), timeZoneIdentifier: viewModel.data?.household.timezone ?? TimeZone.current.identifier)
            Task { await viewModel.moveToCurrentWeek() }
        }
    }

    private func saveInlineDraft(_ entry: MacInlineDraft) async throws -> String {
        switch entry.placement.destination {
        case .weekOfUs:
            let draft = PlanningItemDraft(
                id: entry.id, text: entry.text, type: entry.placement.type,
                planningDate: entry.placement.date, weekStartDate: entry.placement.weekStart,
                remindAt: nil, assignedMemberIds: entry.placement.assignedMemberIds,
                afterItemId: entry.afterItemId
            )
            guard await viewModel.saveItem(draft, creating: true) else {
                throw NSError(domain: "InlinePlanning", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: viewModel.toast ?? "Couldn’t save. Your text is still here; try again."])
            }
            return entry.id
        case .appleReminders(let listId):
            guard let date = entry.placement.date else { throw APIError.invalidResponse }
            let timezone = viewModel.data?.household.timezone ?? TimeZone.current.identifier
            return try await appleReminders.createReminder(
                title: entry.text, listId: listId,
                dueDate: WeekDate.calendarDate(date, hour: 9, timeZoneIdentifier: timezone),
                includesTime: false, timeZoneIdentifier: timezone
            )
        }
    }

    private func openDetails() {
        guard let selection = navigation.selection, let data = viewModel.data else { return }
        detailsPopover.open(selection: selection, data: data, userId: user.userId,
                            reminder: appleReminders.tasks.first { .appleReminder($0.id) == selection })
    }

    private func openSearchResult(_ result: PlannerSearchResult) {
        sheet = nil
        switch result {
        case .planningItem(let item):
            Task {
                await viewModel.move(toWeek: item.weekStartDate)
                navigation.select(item.type == .task ? .weekOfUsTasks : .plans)
                navigation.selectPlanningItem(item.id)
                openDetails()
            }
        case .calendarEvent(let event):
            let week = WeekDate.weekStart(for: String(event.start.prefix(10)))
            Task {
                await viewModel.move(toWeek: week)
                navigation.select(.events)
                navigation.selectEvent(event.id)
                openDetails()
            }
        }
    }

    @discardableResult
    private func reschedule(_ payload: MacPlannerDragPayload, to date: String) -> Bool {
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
            canSave: false,
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
        if case .inbox(let id) = destination.target {
            await notifications.refreshInbox()
            if let item = notifications.inbox.items.first(where: { $0.id == id }), item.kind == "sunday_planning" {
                await openReviewNotification(item)
                notifications.consume(destination)
                return
            }
            navigation.select(.notifications)
            notifications.consume(destination)
            return
        }
        if case .taskWorkspace(let id) = destination.target, destination.weekStart == nil {
            if viewModel.data == nil { await viewModel.load(quietly: true) }
            guard viewModel.data != nil else { return }
            sheet = .taskWorkspace(id)
            notifications.consume(destination)
            return
        }
        guard let weekStart = destination.weekStart else { return }
        await viewModel.move(toWeek: weekStart)
        guard let data = viewModel.data, data.weekStart == weekStart else { return }
        switch destination.target {
        case .taskWorkspace(let id):
            sheet = .taskWorkspace(id)
        case .weeklyReview:
            sheet = .familyPlanning
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
        openDetails()
        notifications.consume(destination)
    }

    private func openReviewNotification(_ item: NotificationInboxItem) async {
        if let destination = NotificationCoordinator.plannerDestination(for: item.deepLink), case .taskWorkspace(let id) = destination.target { await notifications.markRead(item.id); sheet = .taskWorkspace(id); return }
        guard let week = item.target?.weekStart ?? NotificationCoordinator.plannerDestination(for: item.deepLink)?.weekStart else { return }
        await notifications.markRead(item.id)
        await viewModel.move(toWeek: week)
        if viewModel.data?.weekStart == week { sheet = .familyPlanning }
    }
}

// Keep the editor tied to its original item while its info-button popover is open.
@MainActor
final class MacDetailsPopoverStore: ObservableObject {
    struct Session: Identifiable {
        let id: UUID
        let userId: String
        let selection: MacPlannerSelection
        let data: WeeklyPlannerData
        let reminder: AppleReminderTask?
    }

    @Published private(set) var sessions: [UUID: Session] = [:]
    @Published private(set) var presentedID: UUID?
    @Published fileprivate var commandRouter: MacPlannerCommandRouter?
    @Published fileprivate var commandAvailability: MacPlannerCommandAvailability?
    private(set) var presentedAnchor: MacPlannerSelection?
    var visibleAnchors: Set<MacPlannerSelection> = []
    private var anchorInstances: [UUID: MacPlannerSelection] = [:]

    func registerAnchor(_ selection: MacPlannerSelection, id: UUID) {
        anchorInstances[id] = selection
        visibleAnchors.insert(selection)
    }

    func unregisterAnchor(id: UUID) {
        guard let selection = anchorInstances.removeValue(forKey: id),
              !anchorInstances.values.contains(selection) else { return }
        visibleAnchors.remove(selection)
    }

    @discardableResult
    func open(selection: MacPlannerSelection, data: WeeklyPlannerData, userId: String,
              reminder: AppleReminderTask? = nil) -> UUID {
        if let existing = sessions.values.first(where: { $0.userId == userId && $0.selection == selection }) {
            present(existing)
            return existing.id
        }
        let session = Session(id: UUID(), userId: userId, selection: selection, data: data, reminder: reminder)
        sessions[session.id] = session
        present(session)
        return session.id
    }

    private func present(_ session: Session) {
        presentedAnchor = visibleAnchors.contains(session.selection) ? session.selection : nil
        presentedID = session.id
    }

    func remove(_ id: UUID) {
        sessions[id] = nil
        if presentedID == id {
            presentedID = nil
            commandRouter = nil
            commandAvailability = nil
        }
    }
}

// Prefer the visible item; offscreen search/notification results use the content corner.
private struct MacDetailsPopoverAnchor: ViewModifier {
    let selection: MacPlannerSelection?
    @State private var anchorID = UUID()
    @EnvironmentObject private var popover: MacDetailsPopoverStore
    @EnvironmentObject private var viewModel: PlannerViewModel

    func body(content: Content) -> some View {
        let activeSession = popover.presentedAnchor == selection
            ? popover.presentedID.flatMap { popover.sessions[$0] } : nil
        content
            .onAppear { if let selection { popover.registerAnchor(selection, id: anchorID) } }
            .onDisappear { popover.unregisterAnchor(id: anchorID) }
            .popover(item: Binding<MacDetailsPopoverStore.Session?>(
                get: { activeSession },
                set: { value in
                    if value == nil, let activeSession { popover.remove(activeSession.id) }
                }
            ), attachmentAnchor: .rect(.bounds), arrowEdge: .leading) { session in
                MacDetailsPopover(session: session, viewModel: viewModel)
                    .environmentObject(popover)
                    .tint(CWTheme.accent)
                    .frame(width: 400, height: 600)
                    .presentationCompactAdaptation(.popover)
            }
    }
}

private struct MacItemInfoButton: View {
    let selection: MacPlannerSelection
    let title: String
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            Image(systemName: "info.circle")
                .font(.system(size: 15))
                .foregroundStyle(CWTheme.accentStrong)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Show details")
        .accessibilityLabel("Details for \(title)")
        .accessibilityIdentifier(identifier)
        .modifier(MacDetailsPopoverAnchor(selection: selection))
    }

    private var identifier: String {
        switch selection {
        case .planningItem(let id): "mac-info-item-\(id)"
        case .event(let id): "mac-info-event-\(id)"
        case .appleReminder(let id): "mac-info-reminder-\(id)"
        }
    }
}

private struct MacDetailsPopover: View {
    let session: MacDetailsPopoverStore.Session
    @ObservedObject var viewModel: PlannerViewModel
    @StateObject private var commandRouter = MacPlannerCommandRouter()
    @StateObject private var unsavedChanges = MacUnsavedChangesCoordinator()
    @StateObject private var appleReminders = AppleRemindersStore.shared
    @State private var deletionTarget: MacDeletionTarget?
    @EnvironmentObject private var popover: MacDetailsPopoverStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openWindow) private var openWindow

    private var detailsData: WeeklyPlannerData {
        if let current = viewModel.data, current.weekStart == session.data.weekStart { return current }
        return session.data
    }

    var body: some View {
        NavigationStack {
            inspector(detailsData)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(action: requestClose) { Image(systemName: "xmark") }
                            .accessibilityLabel("Close")
                            .help("Close details")
                            .accessibilityIdentifier("mac-close-details")
                    }
                }
        }
        .interactiveDismissDisabled(unsavedChanges.isDirty)
        .focusedSceneValue(\.macPlannerCommandRouter, commandRouter)
        .focusedSceneValue(\.macPlannerCommandAvailability, commandAvailability)
        .confirmationDialog(deletionTitle, isPresented: Binding(
            get: { deletionTarget != nil }, set: { if !$0 { deletionTarget = nil } }
        ), titleVisibility: .visible) {
            Button(deletionButtonTitle, role: .destructive) { performDeletion() }
            Button("Cancel", role: .cancel) { deletionTarget = nil }
        } message: { Text(deletionMessage) }
        .confirmationDialog("Discard unsaved changes?", isPresented: Binding(
            get: { unsavedChanges.requiresConfirmation },
            set: { if !$0 { unsavedChanges.cancelNavigation() } }
        ), titleVisibility: .visible) {
            Button("Discard Changes", role: .destructive) {
                _ = unsavedChanges.discardChanges()
                close()
            }
            Button("Keep Editing", role: .cancel) { unsavedChanges.cancelNavigation() }
        } message: { Text("Save this item first, or discard the edits before closing its details.") }
        .onChange(of: commandAvailability, initial: true) { _, value in
            commandRouter.updateAvailability(value)
            popover.commandRouter = commandRouter
            popover.commandAvailability = value
        }
        .onChange(of: commandRouter.revision) { _, _ in
            switch commandRouter.command {
            case .delete: beginDeleteSelectedItem()
            case .toggleCompletion: toggleCompletion()
            case .settings: openWindow(id: "settings")
            default: break // Save is handled by the active inspector.
            }
        }
        .onDisappear { popover.remove(session.id) }
    }

    private func requestClose() {
        if unsavedChanges.request(.closeDetails) != nil { close() }
    }

    private func close() {
        unsavedChanges.setDirty(false)
        dismiss()
    }

    private var commandAvailability: MacPlannerCommandAvailability {
        let canToggle: Bool
        let canDelete: Bool
        switch session.selection {
        case .planningItem(let id):
            let item = planningItem(id: id, in: detailsData)
            canToggle = item?.type == .task
            canDelete = item != nil
        case .event(let id):
            canToggle = false
            canDelete = calendarEvent(id: id, in: detailsData)?.canEdit == true
        case .appleReminder(let id):
            let reminder = appleReminders.tasks.first { $0.id == id } ?? session.reminder
            canToggle = reminder?.canModify == true
            canDelete = reminder?.canDelete == true
        }
        return MacPlannerCommandAvailability(canCreate: false, canSave: unsavedChanges.isDirty,
                                             canToggleCompletion: canToggle, canDelete: canDelete)
    }

    private func toggleCompletion() {
        switch session.selection {
        case .planningItem(let id):
            if let item = planningItem(id: id, in: detailsData), item.type == .task {
                Task { await viewModel.toggle(item) }
            }
        case .appleReminder(let id):
            if let task = appleReminders.tasks.first(where: { $0.id == id }) ?? session.reminder {
                Task { await appleReminders.toggle(task) }
            }
        case .event: break
        }
    }

    @ViewBuilder
    private func inspector(_ data: WeeklyPlannerData) -> some View {
        switch session.selection {
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
                MacEmptyInspector(section: .week)
            }
        case .event(let id):
            if let event = calendarEvent(id: id, in: data) {
                MacEventInspector(
                    event: event,
                    data: data,
                    viewModel: viewModel,
                    commandRouter: commandRouter,
                    dirtyChanged: { unsavedChanges.setDirty($0) },
                    deleted: close
                )
                .id(event.id)
            } else {
                MacEmptyInspector(section: .week)
            }
        case .appleReminder(let id):
            if let reminder = appleReminders.tasks.first(where: { $0.id == id }) ?? session.reminder {
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
                MacEmptyInspector(section: .week)
            }
        case nil:
            MacEmptyInspector(section: .week)
        }
    }

    private func beginDeleteSelectedItem() {
        let data = detailsData
        switch session.selection {
        case .planningItem(let id):
            if let item = planningItem(id: id, in: data) { deletionTarget = .planningItem(item) }
        case .appleReminder(let id):
            if let reminder = appleReminders.tasks.first(where: { $0.id == id }) ?? session.reminder {
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
                    close()
                }
            case .reminder(let reminder):
                do {
                    try await appleReminders.delete(reminder)
                    unsavedChanges.setDirty(false)
                    close()
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

    private func planningItem(id: String, in data: WeeklyPlannerData) -> PlanningItem? {
        (data.weeklyItems + data.days.flatMap(\.items)).first(where: { $0.id == id })
    }

    private func calendarEvent(id: String, in data: WeeklyPlannerData) -> CalendarEvent? {
        data.days.lazy.flatMap(\.events).first(where: { $0.id == id })
    }

}

// Catalyst needs scene limits after the window is attached, as well as the SwiftUI minimum.
private struct MacPlannerWindowSizing: UIViewControllerRepresentable {
    final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            guard let scene = view.window?.windowScene, let restrictions = scene.sizeRestrictions else { return }
            restrictions.minimumSize = CGSize(width: 760, height: 560)
            restrictions.maximumSize = CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        }
    }

    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {}
}

private struct MacWeekHeader: View {
    let data: WeeklyPlannerData
    let section: MacPlannerSection
    let previousWeek: () -> Void
    let currentWeek: () -> Void
    let nextWeek: () -> Void
    let refresh: () -> Void
    let create: () -> Void
    let createFromWeek: (MacWeekCreationKind) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 20) {
                title
                Spacer(minLength: 0)
                actions
            }
            VStack(alignment: .leading, spacing: 12) {
                title
                actions
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(Color(uiColor: .secondarySystemBackground))
    }

    private var title: some View {
        Text(WeekDate.weekTitle(data.weekStart))
            .font(.system(size: 22, weight: .semibold, design: .rounded))
            .tracking(-0.5)
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityAddTraits(.isHeader)
    }

    private var actions: some View {
        HStack(spacing: 6) {
            Button(action: previousWeek) { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous Week")
            Button("Today", action: currentWeek)
            Button(action: nextWeek) { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next Week")
            Divider().frame(height: 16).padding(.horizontal, 4)
            Button(action: refresh) { Image(systemName: "arrow.clockwise") }
                .accessibilityLabel("Refresh")
            if section == .week {
                Menu {
                    Button("New Event", systemImage: "calendar.badge.plus") { createFromWeek(.event) }
                        .accessibilityIdentifier("mac-new-event")
                    Button("New Note", systemImage: "note.text.badge.plus") { createFromWeek(.note) }
                        .accessibilityIdentifier("mac-new-note")
                    Button("New Task", systemImage: "checkmark.square") { createFromWeek(.task) }
                        .accessibilityIdentifier("mac-new-task")
                } label: {
                    Label("New", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("New Item")
                .accessibilityIdentifier("mac-new-menu")
            } else {
                Button(action: create) { Label("New", systemImage: "plus") }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("New Item")
            }
        }
        .controlSize(.small)
        .fixedSize()
    }
}

private struct MacDayPicker: View {
    let days: [DayPlan]
    let selectedDay: String
    let selectDay: (String) -> Void
    let dropOnDay: (MacPlannerDragPayload, String) -> Bool

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days) { day in
                Button { selectDay(day.date) } label: {
                    Text(WeekDate.shortDay(day.date))
                        .font(.system(size: 12, weight: selectedDay == day.date ? .semibold : .regular))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundStyle(selectedDay == day.date ? Color.white : CWTheme.secondaryInk)
                        .background(selectedDay == day.date ? CWTheme.brand : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .dropDestination(for: String.self) { values, _ in
                    values.compactMap(MacPlannerDragPayload.init(encoded:)).contains { dropOnDay($0, day.date) }
                } isTargeted: { _ in }
                .accessibilityIdentifier("mac-day-\(day.date)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mac-day-picker")
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
                        .accessibilityLabel("High \(temperature(weather.highF)) degrees, low \(temperature(weather.lowF)) degrees, \(weather.precipitationProbability) percent chance of rain")
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
    @ObservedObject var composer: MacInlineComposer
    let canEdit: Bool
    let saveDraft: (MacInlineDraft) async throws -> String
    let createEvent: (String) -> Void
    let section: MacPlannerSection
    let selectedDay: String
    let calendarRange: CalendarRange
    let currentUserId: String
    @Binding var selections: Set<MacPlannerSelection>
    let openSelection: (MacPlannerSelection) -> Void
    let searchText: String
    let calendarFilterId: String
    let personFilterId: String
    let toggleItem: (PlanningItem) -> Void
    @ObservedObject var reminders: AppleRemindersStore
    let deleteItem: (PlanningItem) -> Void
    let deleteReminder: (AppleReminderTask) -> Void
    let reschedule: (MacPlannerDragPayload, String) -> Bool
    let openLocation: (DayPlan) -> Void
    let openWeather: (DayPlan) -> Void

    var body: some View {
        ScrollViewReader { proxy in
        Group {
            if section == .appleReminders {
                reminderContent
            } else if section == .week {
                weekList
            } else {
                plannerList
            }
        }
        .onKeyPress(.return) {
            guard selections.count == 1, let selection = selections.first else { return .ignored }
            switch selection {
            case .planningItem(let id):
                guard canEdit, let item = (data.weeklyItems + data.days.flatMap(\.items)).first(where: { $0.id == id }) else { return .ignored }
                beginInline(date: item.planningDate, type: item.type, after: id, destination: .weekOfUs)
            case .appleReminder(let id):
                guard let task = reminders.tasks.first(where: { $0.id == id }), task.canModify else { return .ignored }
                beginInline(date: task.displayDate, type: .task, after: id, destination: .appleReminders(task.listId))
            case .event: return .ignored
            }
            return .handled
        }
        .onChange(of: composer.focusedID) { _, id in
            guard let id else { return }
            Task { @MainActor in
                await Task.yield()
                proxy.scrollTo(id, anchor: .center)
            }
        }
        }
    }

    private var visibleDays: [DayPlan] {
        data.days.filter { calendarRange == .week || $0.date == selectedDay }
    }

    private var weekList: some View {
        List(selection: $selections) {
            if calendarRange == .week { wholeWeekSection }
            ForEach(visibleDays) { day in
                Section {
                    VStack(spacing: 0) {
                        cardHeading(
                            WeekDate.longDay(day.date),
                            isToday: WeekDate.isToday(day.date, timeZoneIdentifier: data.household.timezone)
                        )
                        .accessibilityIdentifier("mac-week-list-day-\(day.date)")
                        MacDayContextBar(
                            day: day, unit: data.household.temperatureUnit, weatherState: data.weatherState,
                            openLocation: { openLocation(day) }, openWeather: openWeather
                        )
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
                    .dropDestination(for: String.self) { values, _ in
                        values.compactMap(MacPlannerDragPayload.init(encoded:)).contains { reschedule($0, day.date) }
                    } isTargeted: { _ in }
                    weekEvents(day.events, date: day.date)
                    weekItems(day.items, type: .note, date: day.date)
                    weekItems(day.items, type: .task, date: day.date, reminderTasks: reminders.tasks(for: day.date))
                }
            }
            if calendarRange == .day { wholeWeekSection }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(14)
        .environment(\.defaultMinListRowHeight, 30)
        .font(.system(size: 14))
        .contentMargins(.top, 14, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .background { AppBackground() }
        .accessibilityIdentifier("mac-week-list")
    }

    private var wholeWeekSection: some View {
        Section {
            cardHeading("This week", subtitle: "Plans and tasks for the whole week")
                .accessibilityIdentifier("mac-week-list-weekly-heading")
            weekItems(data.weeklyItems, type: .note, date: nil)
            weekItems(data.weeklyItems, type: .task, date: nil)
        }
    }

    private func cardHeading(_ title: String, subtitle: String? = nil, isToday: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .tracking(-0.3)
                    .foregroundStyle(CWTheme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if isToday {
                    Text("TODAY")
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .tracking(1)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(CWTheme.brand, in: Capsule())
                }
            }
            if let subtitle {
                Text(subtitle).font(.system(size: 12)).foregroundStyle(CWTheme.secondaryInk)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(LinearGradient(
            colors: [CWTheme.mint.opacity(isToday ? 0.9 : 0.5), CWTheme.cream.opacity(0.45)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        ))
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .selectionDisabled()
    }

    private func categoryHeading(_ title: String, supplemental: Bool = false) -> some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(1.2)
            .foregroundStyle(supplemental ? CWTheme.secondaryInk : CWTheme.accent)
            .padding(.top, 8)
            .listRowSeparator(.hidden)
            .accessibilityAddTraits(.isHeader)
            .selectionDisabled()
    }

    @ViewBuilder
    private func weekEvents(_ events: [CalendarEvent], date: String) -> some View {
        let visible = events.filter(matches)
        if visible.isEmpty {
            categoryHeading("Calendar")
            Text(data.calendarState.status == "loading" ? "Loading calendar…" : "No events in this view")
                .foregroundStyle(CWTheme.secondaryInk)
                .listRowSeparator(.hidden)
                .selectionDisabled()
        } else {
            let critical = visible.filter { $0.sectionGroup != "supplemental" }
            let supplemental = visible.filter { $0.sectionGroup == "supplemental" }
            if !critical.isEmpty {
                categoryHeading("Critical")
                eventRows(critical, usesWeekStyle: true)
            }
            if !supplemental.isEmpty {
                categoryHeading("Supplemental", supplemental: true)
                eventRows(supplemental, usesWeekStyle: true)
            }
        }
        addEventButton(date: date)
    }

    @ViewBuilder
    private func weekItems(_ items: [PlanningItem], type: PlanningItemType, date: String?, reminderTasks: [AppleReminderTask] = []) -> some View {
        let visible = items.filter { $0.type == type && matches($0) }
        let visibleReminders = reminderTasks.filter(matches)
        categoryHeading(type == .note ? "Plans" : "Tasks")
        if visible.isEmpty && visibleReminders.isEmpty && !canEdit {
            Text(searchText.isEmpty && personFilterId == CalendarEventFilter.allPeople
                 ? (type == .note ? "No plans yet" : "No tasks yet")
                 : (type == .note ? "No plans in this view" : "No tasks in this view"))
                .foregroundStyle(CWTheme.secondaryInk)
                .listRowSeparator(.hidden)
                .selectionDisabled()
        }
        itemRows(visible)
        reminderRows(visibleReminders)
        inlineTail(date: date, type: type, visibleIDs: Set(visible.map(\.id) + visibleReminders.map(\.id)))
    }

    private var plannerList: some View {
        List(selection: $selections) {
            switch section {
            case .events:
                ForEach(visibleDays) { day in
                    eventSection(day.events, title: WeekDate.longDay(day.date), date: day.date)
                }
            case .plans:
                itemSection(data.weeklyItems.filter { $0.type == .note }, title: "This Week", date: nil, type: .note)
                ForEach(data.days) { day in
                    itemSection(day.items.filter { $0.type == .note }, title: WeekDate.longDay(day.date), date: day.date, type: .note)
                }
            case .weekOfUsTasks:
                itemSection(data.weeklyItems.filter { $0.type == .task }, title: "This Week", date: nil, type: .task)
                ForEach(data.days) { day in
                    itemSection(day.items.filter { $0.type == .task }, title: WeekDate.longDay(day.date), date: day.date, type: .task)
                }
            default:
                EmptyView()
            }
        }
        .listStyle(.inset)
        .overlay {
            if isPlannerSectionEmpty && (section == .events ? !canCreateEvents : !canEdit) {
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

    private func itemSection(_ items: [PlanningItem], title: String, date: String?, type: PlanningItemType) -> some View {
        let visible = items.filter(matches)
        return Section(title) {
            itemRows(visible)
            inlineTail(date: date, type: type, visibleIDs: Set(visible.map(\.id)))
        }
    }

    private func itemRows(_ items: [PlanningItem]) -> some View {
        ForEach(items.filter { item in !composer.drafts.contains { $0.id == item.id } }) { item in
            MacPlanningItemRow(
                item: item,
                usesWeekStyle: section == .week,
                toggle: { toggleItem(item) },
                select: { select(.planningItem(item.id)) },
                delete: { deleteItem(item) },
                addBelow: canEdit ? { beginInline(date: item.planningDate, type: item.type, after: item.id, destination: .weekOfUs) } : nil
            )
            .listRowSeparator(section == .week ? .hidden : .automatic)
            .listRowInsets(section == .week ? EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16) : nil)
            .onTapGesture(count: 2) { select(.planningItem(item.id)) }
            .tag(MacPlannerSelection.planningItem(item.id))
            .draggable(MacPlannerDragPayload.planningItem(item.id).encoded)
            inlineRows(date: item.planningDate, type: item.type, after: item.id)
        }
    }

    @ViewBuilder
    private func eventSection(_ events: [CalendarEvent], title: String, date: String) -> some View {
        let visible = events.filter(matches)
        if !visible.isEmpty || canCreateEvents {
            Section(title) {
                eventRows(visible)
                addEventButton(date: date)
            }
        }
    }

    private var canCreateEvents: Bool { !data.editableCalendars.isEmpty }

    @ViewBuilder
    private func addEventButton(date: String) -> some View {
        if canCreateEvents {
            Button {
                createEvent(date)
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "plus").frame(width: 18)
                    Text("Add event")
                    Spacer()
                }.foregroundStyle(CWTheme.secondaryInk)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("mac-add-event-\(date)")
            .listRowSeparator(.hidden)
            .selectionDisabled()
        }
    }

    private func eventRows(_ events: [CalendarEvent], usesWeekStyle: Bool = false) -> some View {
        ForEach(events) { event in
            HStack(alignment: .top, spacing: 11) {
                if usesWeekStyle {
                    Text(event.attribution)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Color(hex: event.calendarColor), in: RoundedRectangle(cornerRadius: 8))
                } else {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(hex: event.calendarColor))
                        .frame(width: 5, height: 34)
                }
                VStack(alignment: .leading, spacing: 3) {
                    if usesWeekStyle {
                        Text(event.allDay ? "All day" : eventTimeRange(event))
                            .font(.system(size: 11)).foregroundStyle(CWTheme.secondaryInk)
                    }
                    Text(event.title)
                        .fontWeight(usesWeekStyle && event.sectionGroup != "supplemental" ? .semibold : .regular)
                        .foregroundStyle(usesWeekStyle && event.sectionGroup == "supplemental" ? CWTheme.secondaryInk : CWTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(usesWeekStyle
                         ? [event.calendarAlias, event.location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                         : event.allDay ? "All day · \(event.calendarAlias)" : "\(eventTimeRange(event)) · \(event.calendarAlias)")
                        .font(usesWeekStyle ? .system(size: 11) : .caption)
                        .foregroundStyle(CWTheme.secondaryInk)
                        .lineLimit(usesWeekStyle ? 1 : nil)
                }
                Spacer(minLength: 8)
                if usesWeekStyle, event.isConflict == true {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                }
                MacItemInfoButton(selection: .event(event.id), title: event.title) { select(.event(event.id)) }
            }
            .listRowSeparator(usesWeekStyle ? .hidden : .automatic)
            .listRowInsets(usesWeekStyle ? EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16) : nil)
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { select(.event(event.id)) }
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

    @ViewBuilder
    private func reminderSection(_ tasks: [AppleReminderTask], title: String) -> some View {
        let visible = tasks.filter(matches)
        if !visible.isEmpty {
            Section(title) { reminderRows(visible) }
        }
    }

    private func reminderRows(_ tasks: [AppleReminderTask]) -> some View {
        ForEach(tasks) { task in
            MacAppleReminderRow(
                task: task,
                usesWeekStyle: section == .week,
                toggle: { Task { await reminders.toggle(task) } },
                open: { select(.appleReminder(task.id)) }
            )
            .listRowSeparator(section == .week ? .hidden : .automatic)
            .listRowInsets(section == .week ? EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16) : nil)
            .onTapGesture(count: 2) { select(.appleReminder(task.id)) }
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
            inlineRows(date: task.displayDate, type: .task, after: task.id)
        }
    }

    private func placement(date: String?, type: PlanningItemType, destination: TaskCreationDestination? = nil) -> MacInlinePlacement {
        let useDefault = section == .week && type == .task && date != nil
        let fallback = useDefault && reminders.writableSelectedLists.contains(where: {
            reminders.defaultDestination == .appleReminders($0.id)
        }) ? reminders.defaultDestination : .weekOfUs
        let assigned: [String]? = personFilterId == CalendarEventFilter.allPeople ? nil
            : personFilterId == CalendarEventFilter.unassigned ? [] : [personFilterId]
        return MacInlinePlacement(weekStart: data.weekStart, date: date, type: type,
                                  destination: destination ?? fallback, assignedMemberIds: section == .week ? assigned : nil)
    }

    private func beginInline(date: String?, type: PlanningItemType, after id: String? = nil,
                             destination: TaskCreationDestination? = nil) {
        selections = []
        composer.begin(placement(date: date, type: type, destination: destination), after: id)
    }

    private func groupDrafts(date: String?, type: PlanningItemType) -> [MacInlineDraft] {
        composer.drafts.filter {
            $0.placement.weekStart == data.weekStart && $0.placement.date == date && $0.placement.type == type
        }
    }

    private func inlineRows(date: String?, type: PlanningItemType, after id: String?) -> some View {
        ForEach(groupDrafts(date: date, type: type).filter { $0.afterItemId == id }) { draft in
            inlineRow(draft)
        }
    }

    private func inlineRow(_ draft: MacInlineDraft) -> some View {
        MacInlineEntryRow(draft: draft, composer: composer, save: saveDraft)
            .id(draft.id)
            .listRowSeparator(section == .week ? .hidden : .automatic)
            .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            .selectionDisabled()
    }

    private func inlineTail(date: String?, type: PlanningItemType, visibleIDs: Set<String>) -> some View {
        let target = placement(date: date, type: type)
        let canAdd = target.destination != .weekOfUs || canEdit
        return Group {
            ForEach(groupDrafts(date: date, type: type).filter {
                $0.afterItemId == nil || !visibleIDs.contains($0.afterItemId!)
            }) { draft in inlineRow(draft) }
            if canAdd {
                Button {
                    beginInline(date: date, type: type)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus").frame(width: 18)
                        Text(type == .note ? "Add plan" : "Add task")
                        if case .appleReminders(let id) = target.destination,
                           let list = reminders.writableSelectedLists.first(where: { $0.id == id }) {
                            Text("Reminders · \(list.title)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }.foregroundStyle(CWTheme.secondaryInk)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("mac-inline-add-\(type.rawValue)-\(date ?? "week")")
                .listRowSeparator(.hidden)
                .selectionDisabled()
            }
        }
    }

    private var filteredReminders: [AppleReminderTask] { reminders.tasks.filter(matches) }

    private func select(_ selection: MacPlannerSelection) {
        openSelection(selection)
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
        case .events: return visibleDays.flatMap(\.events).filter(matches).isEmpty
        case .plans: return (data.weeklyItems + data.days.flatMap(\.items)).filter { $0.type == .note && matches($0) }.isEmpty
        case .weekOfUsTasks: return (data.weeklyItems + data.days.flatMap(\.items)).filter { $0.type == .task && matches($0) }.isEmpty
        default: return false
        }
    }

    private func matches(_ item: PlanningItem) -> Bool {
        (section != .week || CalendarEventFilter.matches(item, personId: personFilterId)) && (searchText.isEmpty || item.text.localizedCaseInsensitiveContains(searchText))
    }

    private func matches(_ event: CalendarEvent) -> Bool {
        CalendarEventFilter.matches(event, calendarId: calendarFilterId, personId: personFilterId)
            && (searchText.isEmpty
                || event.title.localizedCaseInsensitiveContains(searchText)
                || event.calendarAlias.localizedCaseInsensitiveContains(searchText))
    }

    private func matches(_ task: AppleReminderTask) -> Bool {
        (section != .week || CalendarEventFilter.includesPersonalReminders(personId: personFilterId, currentUserId: currentUserId))
            && (searchText.isEmpty
            || task.title.localizedCaseInsensitiveContains(searchText)
            || (task.notes?.localizedCaseInsensitiveContains(searchText) ?? false)
            || task.listTitle.localizedCaseInsensitiveContains(searchText))
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

private struct MacInlineEntryRow: View {
    let draft: MacInlineDraft
    @ObservedObject var composer: MacInlineComposer
    let save: (MacInlineDraft) async throws -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 10) {
                Image(systemName: draft.placement.type == .task ? "square" : "circle.fill")
                    .font(.system(size: draft.placement.type == .task ? 18 : 7))
                    .foregroundStyle(CWTheme.secondaryInk)
                    .frame(width: 18)
                MacInlineTextField(
                    text: Binding(
                        get: { composer.drafts.first(where: { $0.id == draft.id })?.text ?? "" },
                        set: { composer.setText($0, for: draft.id) }
                    ),
                    placeholder: draft.placement.type == .note ? "New plan" : "New task",
                    identifier: "mac-inline-text-\(draft.id)",
                    wantsFocus: composer.focusedID == draft.id,
                    isSaving: draft.isSaving,
                    submit: { submit(thenAddAnother: true) },
                    cancel: { composer.cancel(draft.id) },
                    endedEditing: {
                        if composer.focusedID == draft.id { composer.focusedID = nil }
                        if draft.error == nil { submit(thenAddAnother: false) }
                    }
                ).frame(height: 24)
                if draft.isSaving { ProgressView().controlSize(.small) }
                else {
                    Button { composer.cancel(draft.id) } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).foregroundStyle(.secondary)
                        .accessibilityLabel("Cancel new item")
                }
            }
            if let error = draft.error {
                HStack {
                    Text(error).font(.caption).foregroundStyle(.red)
                    Button("Retry") { submit(thenAddAnother: true) }.buttonStyle(.borderless)
                }.padding(.leading, 28)
            }
        }
    }

    private func submit(thenAddAnother: Bool) {
        Task { await composer.submit(draft.id, thenAddAnother: thenAddAnother, save: save) }
    }
}

// Read the native field at Return so fast typing is committed before the next row takes focus.
private struct MacInlineTextField: UIViewRepresentable {
    @Binding var text: String
    let placeholder: String
    let identifier: String
    let wantsFocus: Bool
    let isSaving: Bool
    let submit: () -> Void
    let cancel: () -> Void
    let endedEditing: () -> Void

    final class Field: UITextField {
        var cancelEntry: (() -> Void)?
        override var keyCommands: [UIKeyCommand]? {
            [UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(cancelInlineEntry))]
        }
        @objc private func cancelInlineEntry() { cancelEntry?() }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: MacInlineTextField
        init(_ parent: MacInlineTextField) { self.parent = parent }
        @objc func changed(_ field: UITextField) { parent.text = field.text ?? "" }
        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            changed(textField)
            parent.submit()
            return false
        }
        func textFieldDidEndEditing(_ textField: UITextField) {
            guard !parent.isSaving else { return }
            changed(textField)
            parent.endedEditing()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> Field {
        let field = Field()
        field.font = .systemFont(ofSize: 14)
        field.textColor = .label
        field.returnKeyType = .next
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }
    func updateUIView(_ field: Field, context: Context) {
        context.coordinator.parent = self
        field.placeholder = placeholder
        field.accessibilityLabel = placeholder
        field.accessibilityIdentifier = identifier
        field.cancelEntry = cancel
        // SwiftUI re-renders the list as the draft changes; never replace text mid-keystroke.
        if !field.isFirstResponder { field.text = text }
        field.isEnabled = !isSaving
        if wantsFocus && !isSaving && !field.isFirstResponder {
            DispatchQueue.main.async { [weak field, weak coordinator = context.coordinator] in
                guard let field, field.window != nil, coordinator?.parent.wantsFocus == true,
                      coordinator?.parent.isSaving == false else { return }
                field.becomeFirstResponder()
            }
        }
    }
}

private struct MacPlanningItemRow: View {
    let item: PlanningItem
    var usesWeekStyle = false
    let toggle: () -> Void
    let select: () -> Void
    let delete: () -> Void
    var addBelow: (() -> Void)? = nil

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
                    if !usesWeekStyle { Text(item.createdByName ?? "Week of Us") }
                    if item.reminder != nil { Image(systemName: "bell.fill") }
                    if let deadline = item.deadline { Text("Due \(deadline)").font(.caption).foregroundStyle(.secondary) }
                    if let carryoverLabel = item.carryoverLabel { Text(carryoverLabel) }
                }
                .font(usesWeekStyle ? .system(size: 11) : .caption2)
                .foregroundStyle(.secondary)
            }
            MacItemInfoButton(selection: .planningItem(item.id), title: item.text, open: select)
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button("Open") { select() }
            if let addBelow {
                Button(item.type == .note ? "New Plan Below" : "New Task Below", action: addBelow)
            }
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
    var usesWeekStyle = false
    let toggle: () -> Void
    let open: () -> Void

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
                .font(usesWeekStyle ? .system(size: 11) : .caption2)
                .foregroundStyle(.secondary)
                if let carryoverLabel = task.carryoverLabel {
                    Text(carryoverLabel)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            MacItemInfoButton(selection: .appleReminder(task.id), title: task.title, open: open)
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

private struct MacInspectorStatus: Identifiable {
    let text: String
    let systemImage: String
    let tint: Color

    var id: String { "\(systemImage)-\(text)" }
}

private struct MacInspectorLayout<Content: View, Footer: View>: View {
    private let content: Content
    private let footer: Footer

    init(
        @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer
    ) {
        self.content = content()
        self.footer = footer()
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                content
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(14)
            }
            Divider()
            footer
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial)
        }
        .font(.system(size: 13))
        .controlSize(.small)
        .toggleStyle(.switch)
        .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct MacInspectorHeader: View {
    let kind: String
    let systemImage: String
    let tint: Color
    @Binding var title: String
    let editable: Bool
    let edited: Bool
    let subtitle: String?
    let statuses: [MacInspectorStatus]
    var notes: Binding<String>? = nil
    var url: Binding<String>? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                if editable {
                    TextField(titlePrompt, text: $title, axis: .vertical)
                        .font(.system(size: 21, weight: .semibold))
                        .textFieldStyle(.plain)
                        .lineLimit(1...5)
                        .accessibilityLabel(titlePrompt)
                } else {
                    Text(title)
                        .font(.system(size: 21, weight: .semibold))
                        .textSelection(.enabled)
                }
                if let notes {
                    if editable {
                        TextField("Notes", text: notes, axis: .vertical)
                            .textFieldStyle(.plain)
                            .lineLimit(1...8)
                            .accessibilityLabel("Notes")
                    } else if !notes.wrappedValue.isEmpty {
                        Text(notes.wrappedValue).textSelection(.enabled)
                    }
                }
                if let url, editable || !url.wrappedValue.isEmpty {
                    Divider().padding(.vertical, 2)
                    if editable {
                        TextField("URL", text: url, axis: .vertical)
                            .textFieldStyle(.plain)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .lineLimit(1...3)
                            .accessibilityLabel("URL")
                    } else {
                        Text(url.wrappedValue).textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color(uiColor: .secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            HStack(spacing: 6) {
                Label {
                    Text(subtitle ?? kind).foregroundStyle(.secondary)
                } icon: {
                    Image(systemName: systemImage).foregroundStyle(tint)
                }
                Spacer(minLength: 4)
                if edited {
                    Text("Edited").foregroundStyle(CWTheme.accent)
                }
            }
            .font(.system(size: 11))
            .padding(.horizontal, 10)

            if !statuses.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(statuses) { status in
                        Label(status.text, systemImage: status.systemImage)
                            .font(.system(size: 11))
                            .foregroundStyle(status.tint)
                    }
                }
                .padding(.horizontal, 10)
            }
        }
    }

    private var titlePrompt: String {
        kind == "Calendar event" ? "Title" : "What needs doing?"
    }
}

struct MacInspectorSection<Content: View>: View {
    let title: String
    private let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
            VStack(spacing: 0) { content }
                .background(Color(uiColor: .secondarySystemGroupedBackground),
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

struct MacInspectorRow<Content: View>: View {
    let title: String
    let systemImage: String
    private let content: Content

    init(title: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: systemImage)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .frame(width: 20)
                .accessibilityHidden(true)
            Text(title)
                .foregroundStyle(CWTheme.ink)
                .layoutPriority(1)
            Spacer(minLength: 4)
            content
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(minHeight: 40)
    }
}

private struct MacInspectorDivider: View {
    var body: some View {
        Divider().padding(.leading, 41).padding(.trailing, 12)
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
    @State private var showingCollaboration = false
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
        let start = WeekDate.calendarEventDate(event.start, timeZoneIdentifier: data.household.timezone)
        let end = WeekDate.calendarEventDate(event.end, timeZoneIdentifier: data.household.timezone)
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
        MacInspectorLayout {
            VStack(alignment: .leading, spacing: 16) {
                MacInspectorHeader(
                    kind: "Calendar event",
                    systemImage: "calendar",
                    tint: selectedCalendar.map { Color(hex: $0.color) } ?? Color(hex: event.calendarColor),
                    title: $title,
                    editable: event.canEdit == true,
                    edited: isDirty,
                    subtitle: selectedCalendar?.name ?? event.calendarAlias,
                    statuses: eventStatuses,
                    notes: $notes
                )

                if event.canEdit == true {
                    MacInspectorSection(title: "Schedule") {
                        MacInspectorRow(title: "Calendar", systemImage: "calendar.badge.clock") {
                            Picker("Calendar", selection: $calendarId) {
                                ForEach(data.editableCalendars) { calendar in Text(calendar.name).tag(calendar.id) }
                            }
                            .labelsHidden()
                            .frame(maxWidth: 190)
                            .disabled(event.recurringEventId != nil && recurringScope == "occurrence")
                        }
                        MacInspectorDivider()
                        MacInspectorRow(title: "All day", systemImage: "sun.max") {
                            Toggle("All-day event", isOn: $allDay).labelsHidden()
                        }
                        MacInspectorDivider()
                        MacInspectorRow(title: "Starts", systemImage: "arrow.right.circle") {
                            DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                                .labelsHidden()
                                .fixedSize()
                        }
                        MacInspectorDivider()
                        MacInspectorRow(title: "Ends", systemImage: "checkmark.circle") {
                            DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                                .labelsHidden()
                                .fixedSize()
                        }
                    }

                    MacInspectorSection(title: "Place") {
                        MacInspectorRow(title: "Location", systemImage: "mappin.and.ellipse") {
                            TextField("Add a location", text: $location, axis: .vertical)
                                .textFieldStyle(.plain)
                                .multilineTextAlignment(.trailing)
                                .lineLimit(1...4)
                                .accessibilityLabel("Location")
                        }
                    }

                    if event.recurringEventId != nil {
                        MacInspectorSection(title: "Recurring event") {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Apply changes to")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Picker("Apply changes to", selection: $recurringScope) {
                                    Text("This occurrence").tag("occurrence")
                                    Text("Entire series").tag("series")
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                                Text(recurringScope == "series"
                                     ? "The full series is updated while its recurrence schedule stays intact."
                                     : "Only this occurrence is updated.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(14)
                        }
                    }
                } else {
                    MacInspectorSection(title: "Event details") {
                        MacInspectorRow(title: "Calendar", systemImage: "calendar") {
                            Text(event.calendarAlias).foregroundStyle(.secondary)
                        }
                        MacInspectorDivider()
                        MacInspectorRow(title: "When", systemImage: "clock") {
                            Text(eventDateSummary)
                                .multilineTextAlignment(.trailing)
                                .foregroundStyle(.secondary)
                        }
                        if let location = event.location, !location.isEmpty {
                            MacInspectorDivider()
                            MacInspectorRow(title: "Location", systemImage: "mappin.and.ellipse") {
                                Text(location)
                                    .multilineTextAlignment(.trailing)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                if let attendees = event.attendees, !attendees.isEmpty {
                    MacInspectorSection(title: "Guests") {
                        ForEach(attendees) { attendee in
                            HStack(spacing: 10) {
                                Image(systemName: attendee.responseStatus == "accepted" ? "checkmark.circle.fill" : "person.crop.circle")
                                    .foregroundStyle(attendee.responseStatus == "accepted" ? CWTheme.accent : .secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(attendee.displayName ?? attendee.email)
                                    Text(attendee.responseStatus.capitalized)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if attendee.`self` == true {
                                    Text("You")
                                        .font(.caption.bold())
                                        .foregroundStyle(CWTheme.accentStrong)
                                }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                        }
                        if event.canRespond == true {
                            Divider()
                            HStack {
                                responseButton("Going", status: "accepted")
                                responseButton("Maybe", status: "tentative")
                                responseButton("Can’t Go", status: "declined")
                            }
                            .padding(14)
                        }
                    }
                }

                if !event.allDay {
                    MacInspectorSection(title: "Week of Us reminder") {
                        MacInspectorRow(title: "Notify me", systemImage: "bell.badge") {
                            Picker("Notify me", selection: $reminderSelection) {
                                Text("None").tag("none")
                                Text("At start time").tag("0")
                                Text("10 minutes before").tag("10")
                                Text("30 minutes before").tag("30")
                                Text("1 hour before").tag("60")
                                Text("1 day before").tag("1440")
                            }
                            .labelsHidden()
                            .frame(maxWidth: 190)
                        }
                    }
                }
            }
        } footer: {
            HStack(spacing: 10) {
                if let googleURL = event.googleUrl.flatMap(URL.init(string:)) {
                    Link(destination: googleURL) {
                        Label("Open", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                if event.canEdit == true {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canSave)
                }
                Menu {
                    Button("Hide from Week of Us", systemImage: "eye.slash", role: .destructive) {
                        Task { if await viewModel.hideEvent(event) { dirtyChanged(false); deleted() } }
                    }
                    if event.canEdit == true {
                        Divider()
                        Button(
                            event.recurringEventId == nil ? "Delete Event" : "Delete Recurring Event…",
                            systemImage: "trash",
                            role: .destructive
                        ) {
                            confirmingDelete = true
                        }
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
        }
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .toolbar { ToolbarItem { Button("Shared details") { showingCollaboration = true } } }
        .sheet(isPresented: $showingCollaboration) { if let calendarId = event.calendarPreferenceId, let eventId = event.providerEventId { ItemCollaborationView(resource: ["calendarId": calendarId, "eventId": eventId], title: event.title, planner: data, viewModel: viewModel).familyPlanningSheetSize() } }
        .navigationTitle("Event")
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
            && isDirty
            && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !calendarId.isEmpty
            && end >= start
            && !isSaving
    }

    private var eventStatuses: [MacInspectorStatus] {
        var statuses: [MacInspectorStatus] = []
        if allDay {
            statuses.append(MacInspectorStatus(text: "All day", systemImage: "sun.max.fill", tint: CWTheme.accentStrong))
        }
        if event.recurringEventId != nil {
            statuses.append(MacInspectorStatus(text: "Recurring", systemImage: "repeat", tint: CWTheme.accentStrong))
        }
        if event.canEdit != true {
            statuses.append(MacInspectorStatus(text: "Read-only", systemImage: "lock.fill", tint: .secondary))
        }
        return statuses
    }

    private var selectedCalendar: EditableCalendar? {
        data.editableCalendars.first(where: { $0.id == calendarId })
    }

    private var eventDateSummary: String {
        let startDate = String(event.start.prefix(10))
        if event.allDay {
            let exclusiveEnd = String(event.end.prefix(10))
            let inclusiveEnd = exclusiveEnd > startDate ? WeekDate.addDays(-1, to: exclusiveEnd) : startDate
            return inclusiveEnd == startDate
                ? WeekDate.longDay(startDate)
                : "\(WeekDate.longDay(startDate)) – \(WeekDate.longDay(inclusiveEnd))"
        }
        return "\(WeekDate.longDay(startDate)) · \(eventTimeRange(event))"
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
    let childId: String
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
    @StateObject private var itemFiles = ItemFilePresentation()
    let item: PlanningItem
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @ObservedObject var commandRouter: MacPlannerCommandRouter
    let requestDelete: () -> Void
    let dirtyChanged: (Bool) -> Void
    @State private var childId: String
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var date: Date
    @State private var reminderEnabled: Bool
    @State private var reminderDate: Date
    @State private var isSaving = false
    @State private var baseline: MacPlanningItemEditorState
    @State private var showingTaskMigration = false
    @State private var showingRoutine = false

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
        _childId = State(initialValue: item.childId ?? "")
        _text = State(initialValue: item.text)
        _type = State(initialValue: item.type)
        _date = State(initialValue: item.planningDate.map {
            WeekDate.calendarDate($0, hour: 9, timeZoneIdentifier: data.household.timezone)
        } ?? Date())
        let reminder = item.reminder.flatMap { WeekDate.iso8601.date(from: $0.remindAt) }
        _reminderEnabled = State(initialValue: reminder != nil)
        _reminderDate = State(initialValue: reminder ?? Date().addingTimeInterval(3600))
        _baseline = State(initialValue: MacPlanningItemEditorState(
            childId: item.childId ?? "",
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
        MacInspectorLayout {
            VStack(alignment: .leading, spacing: 16) {
                MacInspectorHeader(
                    kind: "Week of Us item",
                    systemImage: type == .task ? "checkmark.square" : "note.text",
                    tint: CWTheme.accentStrong,
                    title: $text,
                    editable: true,
                    edited: isDirty,
                    subtitle: item.createdByName ?? "Shared with your household",
                    statuses: itemStatuses
                )

                MacInspectorSection(title: "Planning") {
                    MacInspectorRow(title: "Type", systemImage: type == .task ? "checkmark.square" : "note.text") {
                        Picker("Type", selection: $type) {
                            Text("Plan or note").tag(PlanningItemType.note)
                            Text("Task").tag(PlanningItemType.task)
                        }
                        .labelsHidden()
                        .frame(maxWidth: 170)
                    }
                    MacInspectorDivider()
                    MacInspectorRow(title: "When", systemImage: "calendar") {
                        if item.planningDate != nil {
                            DatePicker("Date", selection: $date, displayedComponents: .date)
                                .labelsHidden()
                                .fixedSize()
                        } else {
                            Text("This week").foregroundStyle(.secondary)
                        }
                    }
                }

                MacInspectorSection(title: "People") {
                    MacInspectorRow(title: "For", systemImage: "person") {
                        PlanningChildPicker(planner: data, childId: $childId)
                            .labelsHidden()
                    }
                }

                MacInspectorSection(title: "Reminder") {
                    MacInspectorRow(title: "Remind me", systemImage: "bell.badge") {
                        Toggle("Remind me", isOn: $reminderEnabled).labelsHidden()
                    }
                    if reminderEnabled {
                        MacInspectorDivider()
                        MacInspectorRow(title: "At", systemImage: "clock") {
                            DatePicker("At", selection: $reminderDate, displayedComponents: [.date, .hourAndMinute])
                                .labelsHidden()
                                .fixedSize()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 14) {
                    ItemCollaborationFields(resource: ["itemId": item.id], planner: data, viewModel: viewModel, includePlacement: false, compact: true, files: itemFiles)
                }
                .id(item.id)
            }
        } footer: {
            HStack(spacing: 10) {
                if item.type == .task {
                    Button(item.isCompleted ? "Reopen" : "Complete") {
                        Task { await viewModel.toggle(item) }
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canSave)
                Menu {
                    if item.type == .task {
                        Button(item.routineId == nil ? "Repeat this task…" : "Edit repeating routine…") { showingRoutine = true }.disabled(isDirty)
                    }
                    if item.type == .task, !appleReminders.writableSelectedLists.isEmpty {
                        Button("Move to Apple Reminders…") { showingTaskMigration = true }
                            .disabled(isDirty)
                    }
                    if item.type == .task, !appleReminders.writableSelectedLists.isEmpty { Divider() }
                    Button("Delete Item", systemImage: "trash", role: .destructive, action: requestDelete)
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }
        }
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .itemFilePresentation(itemFiles)
        .navigationTitle(item.type.title)
        .onAppear { dirtyChanged(isDirty) }
        .onChange(of: editorState) { _, _ in dirtyChanged(isDirty) }
        .onChange(of: commandRouter.revision) { _, _ in
            if commandRouter.command == .save { Task { await save() } }
        }
        .sheet(isPresented: $showingRoutine) {
            PlanningItemRoutineView(item: item, planner: data, viewModel: viewModel).familyPlanningSheetSize()
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
        guard canSave else { return }
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
            remindAt: reminderEnabled ? WeekDate.iso8601.string(from: reminderDate) : nil,
            childId: childId.isEmpty ? nil : childId,
            childAssignmentIsSet: true
        )
        if await viewModel.saveItem(draft, originalItem: item) {
            baseline = editorState
            dirtyChanged(false)
        }
    }

    private var editorState: MacPlanningItemEditorState {
        MacPlanningItemEditorState(
            childId: childId,
            text: text,
            type: type,
            date: item.planningDate == nil ? nil : date,
            reminderEnabled: reminderEnabled,
            reminderDate: reminderEnabled ? reminderDate : nil
        )
    }

    private var isDirty: Bool { editorState != baseline }

    private var canSave: Bool {
        isDirty
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSaving
    }

    private var itemStatuses: [MacInspectorStatus] {
        var statuses: [MacInspectorStatus] = []
        if item.isCompleted {
            statuses.append(MacInspectorStatus(text: "Completed", systemImage: "checkmark.circle.fill", tint: CWTheme.accentStrong))
        }
        if let carryoverLabel = item.carryoverLabel {
            statuses.append(MacInspectorStatus(text: carryoverLabel, systemImage: "arrow.forward", tint: .orange))
        }
        return statuses
    }
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
        MacInspectorLayout {
            VStack(alignment: .leading, spacing: 16) {
                MacInspectorHeader(
                    kind: "Apple Reminder",
                    systemImage: "checklist",
                    tint: CWTheme.accentStrong,
                    title: $title,
                    editable: task.canModify,
                    edited: isDirty,
                    subtitle: listChoices.first(where: { $0.id == listId })?.title ?? task.listTitle,
                    statuses: reminderStatuses,
                    notes: $notes,
                    url: $urlText
                )

                MacInspectorSection(title: "Date & Time") {
                    MacInspectorRow(title: "Date", systemImage: "calendar") {
                        DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                            .labelsHidden()
                            .fixedSize()
                            .disabled(!task.canModify)
                    }
                    MacInspectorDivider()
                    MacInspectorRow(title: "Time", systemImage: "clock") {
                        Toggle("Include due time", isOn: $includesTime)
                            .labelsHidden()
                            .disabled(!task.canModify)
                    }
                    if includesTime {
                        MacInspectorDivider()
                        MacInspectorRow(title: "Time", systemImage: "clock.fill") {
                            DatePicker("Time", selection: $dueDate, displayedComponents: .hourAndMinute)
                                .labelsHidden()
                                .fixedSize()
                                .disabled(!task.canModify)
                        }
                    }
                }

                MacInspectorSection(title: "Organization") {
                    MacInspectorRow(title: "List", systemImage: "list.bullet") {
                        Picker("List", selection: $listId) {
                            ForEach(listChoices) { list in Text(list.title).tag(list.id) }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 180)
                        .disabled(!task.canModify)
                    }
                    MacInspectorDivider()
                    MacInspectorRow(title: "Priority", systemImage: "exclamationmark") {
                        Picker("Priority", selection: $priority) {
                            ForEach(AppleReminderPriority.allCases) { Text($0.title).tag($0) }
                        }
                        .labelsHidden()
                        .frame(maxWidth: 160)
                        .disabled(!task.canModify)
                    }
                }

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

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        } footer: {
            HStack(spacing: 10) {
                Button(task.isCompleted ? "Reopen" : "Complete") {
                    Task { await store.toggle(task) }
                }
                .buttonStyle(.bordered)
                .disabled(!task.canModify)
                Spacer()
                if task.canModify {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(!canSave)
                    Menu {
                        Button("Delete Reminder", systemImage: "trash", role: .destructive, action: requestDelete)
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                }
            }
        }
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .navigationTitle("Apple Reminder")
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
        guard canSave else { return }
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

    private var canSave: Bool {
        task.canModify
            && isDirty
            && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSaving
    }

    private var reminderStatuses: [MacInspectorStatus] {
        var statuses: [MacInspectorStatus] = []
        if task.isCompleted {
            statuses.append(MacInspectorStatus(text: "Completed", systemImage: "checkmark.circle.fill", tint: CWTheme.accentStrong))
        }
        if task.carryoverCount > 0 {
            statuses.append(MacInspectorStatus(
                text: task.isCompleted ? "Completed after due date" : "Overdue · carried to today",
                systemImage: "exclamationmark.circle.fill",
                tint: .orange
            ))
        }
        if task.isRecurring {
            statuses.append(MacInspectorStatus(text: "Recurring", systemImage: "repeat", tint: CWTheme.accentStrong))
        }
        if !task.canModify {
            statuses.append(MacInspectorStatus(text: "Read-only", systemImage: "lock.fill", tint: .secondary))
        }
        return statuses
    }
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
                Section {
                    TextField("What needs doing?", text: $title, axis: .vertical)
                    Picker("List", selection: $listId) {
                        ForEach(store.writableSelectedLists) { Text($0.title).tag($0.id) }
                    }
                } header: {
                    Label("Reminder", systemImage: "checklist")
                }
                Section {
                    DatePicker("Date", selection: $dueDate, displayedComponents: .date)
                    Toggle("Include due time", isOn: $includesTime)
                    if includesTime {
                        DatePicker("Time", selection: $dueDate, displayedComponents: .hourAndMinute)
                    }
                } header: {
                    Label("Due", systemImage: "calendar")
                }
                AppleReminderRecurrenceEditor(
                    draft: $recurrence,
                    dueDate: dueDate,
                    timeZoneIdentifier: data.household.timezone
                )
                Section {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...8)
                    Picker("Priority", selection: $priority) {
                        ForEach(AppleReminderPriority.allCases) { Text($0.title).tag($0) }
                    }
                    TextField("URL", text: $urlText)
                        .textInputAutocapitalization(.never)
                } header: {
                    Label("Details", systemImage: "text.alignleft")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .cwModalFormStyle()
        }
        .cwModalChrome(
            eyebrow: "New reminder",
            title: "Add Apple Reminder",
            subtitle: "Create a private reminder that stays in Apple Reminders on this Mac.",
            systemImage: "checklist",
            primaryTitle: isSaving ? "Saving…" : "Save Reminder",
            primaryDisabled: !canSave,
            cancel: { dismiss() },
            primaryAction: { Task { await save() } }
        )
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !listId.isEmpty && !isSaving
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
        }
        .cwModalChrome(
            eyebrow: "Planner search",
            title: "Search",
            subtitle: "Find events, plans, and tasks across your shared calendar.",
            systemImage: "magnifyingglass",
            primaryTitle: "Done",
            showsCancel: false,
            cancel: {},
            primaryAction: { dismiss() }
        )
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
    let openReview: (NotificationInboxItem) -> Void

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
                        if item.kind == "sunday_planning" || item.deepLink.contains("tasks=1") { openReview(item) }
                        else { Task { await coordinator.markRead(item.id) } }
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
