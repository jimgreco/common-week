import SwiftUI

enum PlannerSheet: Identifiable {
    case item(PlanningItem?, date: String?, type: PlanningItemType)
    case appleReminder(AppleReminderTask)
    case event(CalendarEvent)
    case newEvent(String)
    case weather(DayPlan)
    case location(DayPlan)
    case search
    case settings

    var id: String {
        switch self {
        case .item(let item, let date, let type): "item-\(item?.id ?? date ?? "weekly")-\(type.rawValue)"
        case .appleReminder(let reminder): "apple-reminder-\(reminder.id)"
        case .event(let event): "event-\(event.id)"
        case .newEvent(let date): "new-event-\(date)"
        case .weather(let day): "weather-\(day.date)"
        case .location(let day): "location-\(day.date)"
        case .search: "search"
        case .settings: "settings"
        }
    }
}

private enum PlannerDestination: String, CaseIterable, Identifiable {
    case calendar
    case events
    case plans
    case tasks

    var id: String { rawValue }

    var title: String {
        switch self {
        case .calendar: "Calendar"
        case .events: "Events"
        case .plans: "Plans"
        case .tasks: "Tasks"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .calendar: "Daily planner"
        case .events: "Weekly events"
        case .plans: "Weekly and daily plans"
        case .tasks: "Weekly and daily tasks"
        }
    }

    var icon: String {
        switch self {
        case .calendar: "calendar"
        case .events: "list.bullet.rectangle"
        case .plans: "note.text"
        case .tasks: "checkmark.square"
        }
    }
}

struct PlannerView: View {
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var auth: AuthStore
    let user: SessionIdentity
    @State private var sheet: PlannerSheet?
    @State private var selectedDayDate = ""
    @State private var dayMoveDirection = 1
    @State private var selectedDestination: PlannerDestination = .calendar
    @GestureState private var dayDragOffset: CGFloat = 0
    @StateObject private var appleReminders = AppleRemindersStore.shared
    @ObservedObject private var notifications = NotificationCoordinator.shared

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                AppBackground()
                content
                if let toast = viewModel.toast ?? appleReminders.notice {
                    Label(toast, systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(CWTheme.accentStrong)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(.regularMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
                        .padding(.bottom, 18)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if viewModel.data != nil {
                    PlannerGlassTabBar(selection: $selectedDestination)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { BrandMark(compact: true) }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { sheet = .search } label: { Image(systemName: "magnifyingglass") }
                        .accessibilityLabel("Search")
                    Button { sheet = .settings } label: {
                        ProfileAvatar(user: user)
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(item: $sheet) { destination in
                sheetView(destination)
                    .presentationDragIndicator(.visible)
            }
            .task(id: notifications.pendingDestination) {
                await openPendingNotification()
            }
        }
    }

    private func openPendingNotification() async {
        guard let destination = notifications.pendingDestination else { return }
        await viewModel.move(toWeek: destination.weekStart)
        guard let data = viewModel.data, data.weekStart == destination.weekStart else { return }

        switch destination.target {
        case .planningItem(let id):
            if let item = (data.days.flatMap(\.items) + data.weeklyItems).first(where: { $0.id == id }) {
                selectedDestination = item.type == .task ? .tasks : .plans
                if let date = item.planningDate { selectedDayDate = date }
                sheet = .item(item, date: item.planningDate, type: item.type)
            }
        case .calendarReminder(let id):
            if let match = data.days.lazy.compactMap({ day in
                day.events.first(where: { $0.reminder?.id == id }).map { (day.date, $0) }
            }).first {
                selectedDestination = .calendar
                selectedDayDate = match.0
                sheet = .event(match.1)
            }
        }
        notifications.consume(destination)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.data == nil {
            LoadingWeekView()
        } else if let error = viewModel.errorMessage, viewModel.data == nil {
            ContentUnavailableView("The planner didn’t load", systemImage: "calendar.badge.exclamationmark", description: Text(error))
                .overlay(alignment: .bottom) { Button("Try again") { Task { await viewModel.load() } }.buttonStyle(.borderedProminent).padding(.bottom, 80) }
        } else if let data = viewModel.data {
            ScrollView {
                LazyVStack(spacing: 16) {
                    weekHeader(data)
                    if data.isDemo {
                        Label("Interactive preview · Changes stay on this device", systemImage: "sparkles")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(CWTheme.accentStrong)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(CWTheme.mint.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
                    }
                    if let syncStatus = viewModel.syncStatusText {
                        Label(syncStatus, systemImage: viewModel.isOffline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(viewModel.isOffline ? Color.orange : CWTheme.secondaryInk)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel(syncStatus)
                    }
                    destinationContent(data)
                }
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 24)
            }
            .id(selectedDestination)
            .transition(.opacity)
            .refreshable {
                async let plannerRefresh: Void = viewModel.load(week: data.weekStart, quietly: true)
                async let remindersRefresh: Void = appleReminders.refresh(
                    weekStart: data.weekStart,
                    timeZoneIdentifier: data.household.timezone
                )
                _ = await (plannerRefresh, remindersRefresh)
            }
            .task(id: "\(user.userId):\(data.weekStart):\(data.household.timezone)") {
                await appleReminders.activate(
                    userId: user.userId,
                    weekStart: data.weekStart,
                    timeZoneIdentifier: data.household.timezone
                )
            }
            .onAppear { synchronizeSelectedDay(with: data) }
            .onChange(of: data.weekStart) { _, _ in synchronizeSelectedDay(with: data) }
            .animation(.easeInOut(duration: 0.2), value: selectedDestination)
        }
    }

    @ViewBuilder
    private func destinationContent(_ data: WeeklyPlannerData) -> some View {
        switch selectedDestination {
        case .calendar:
            dayPager(data)
        case .events:
            WeeklyEventsList(data: data, sheet: $sheet)
        case .plans:
            WeeklyItemsList(type: .note, data: data, viewModel: viewModel, appleReminders: appleReminders, sheet: $sheet)
        case .tasks:
            WeeklyItemsList(type: .task, data: data, viewModel: viewModel, appleReminders: appleReminders, sheet: $sheet)
        }
    }

    private func dayPager(_ data: WeeklyPlannerData) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 5) {
                ForEach(data.days) { day in
                    let isSelected = day.date == selectedDay(in: data).date
                    Button { selectDay(day.date, in: data) } label: {
                        VStack(spacing: 3) {
                            Text(WeekDate.shortDay(day.date).split(separator: " ").first.map(String.init) ?? "")
                                .font(.system(size: 9, weight: .bold, design: .rounded))
                            Text(WeekDate.shortDay(day.date).split(separator: " ").last.map(String.init) ?? "")
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(isSelected ? Color.white : CWTheme.secondaryInk)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(isSelected ? CWTheme.brand : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(WeekDate.longDay(day.date))
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 2)

            ZStack(alignment: .top) {
                let day = selectedDay(in: data)
                DayCardView(day: day, data: data, viewModel: viewModel, appleReminders: appleReminders, sheet: $sheet)
                    .id(day.date)
                    .offset(x: dayDragOffset)
                    .transition(dayTransition)
            }
            .contentShape(Rectangle())
            .simultaneousGesture(daySwipeGesture(in: data))
            .animation(.snappy(duration: 0.3), value: selectedDayDate)
        }
    }

    private func selectedDay(in data: WeeklyPlannerData) -> DayPlan {
        data.days.first(where: { $0.date == selectedDayDate })
            ?? data.days.first(where: { WeekDate.isToday($0.date, timeZoneIdentifier: data.household.timezone) })
            ?? data.days[0]
    }

    private func synchronizeSelectedDay(with data: WeeklyPlannerData) {
        guard !data.days.isEmpty else { return }
        if !data.days.contains(where: { $0.date == selectedDayDate }) {
            selectedDayDate = selectedDay(in: data).date
        }
    }

    private func selectDay(_ date: String, in data: WeeklyPlannerData) {
        guard let current = data.days.firstIndex(where: { $0.date == selectedDay(in: data).date }),
              let target = data.days.firstIndex(where: { $0.date == date }), current != target else { return }
        dayMoveDirection = target > current ? 1 : -1
        selectedDayDate = date
    }

    private func moveDay(by offset: Int, in data: WeeklyPlannerData) {
        guard let current = data.days.firstIndex(where: { $0.date == selectedDay(in: data).date }) else { return }
        let target = current + offset
        guard data.days.indices.contains(target) else { return }
        dayMoveDirection = offset
        selectedDayDate = data.days[target].date
    }

    private func daySwipeGesture(in data: WeeklyPlannerData) -> some Gesture {
        DragGesture(minimumDistance: 18)
            .updating($dayDragOffset) { value, state, _ in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.2 else { return }
                state = value.translation.width * 0.18
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.2,
                      abs(value.translation.width) > 44 else { return }
                moveDay(by: value.translation.width < 0 ? 1 : -1, in: data)
            }
    }

    private var dayTransition: AnyTransition {
        let insertion: Edge = dayMoveDirection > 0 ? .trailing : .leading
        let removal: Edge = dayMoveDirection > 0 ? .leading : .trailing
        return .asymmetric(
            insertion: .move(edge: insertion).combined(with: .opacity),
            removal: .move(edge: removal).combined(with: .opacity)
        )
    }

    private func weekHeader(_ data: WeeklyPlannerData) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 6) {
                    Eyebrow(text: "Weekly plan")
                    Text(WeekDate.weekTitle(data.weekStart))
                        .font(CWTheme.display(39))
                        .tracking(-1.5)
                        .foregroundStyle(CWTheme.ink)
                }
                Spacer()
                Button { Task { await viewModel.moveToCurrentWeek() } } label: {
                    Text("Today").font(.caption.bold()).padding(.horizontal, 12).frame(height: 38).background(.regularMaterial, in: Capsule())
                }
            }
            HStack(spacing: 8) {
                weekButton("Previous", icon: "chevron.left") { Task { await viewModel.moveWeek(by: -7) } }
                Spacer()
                weekButton("Next", icon: "chevron.right", trailing: true) { Task { await viewModel.moveWeek(by: 7) } }
            }
        }
        .padding(.horizontal, 4)
    }

    private func weekButton(_ title: String, icon: String, trailing: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if !trailing { Image(systemName: icon) }
                Text(title)
                if trailing { Image(systemName: icon) }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(CWTheme.secondaryInk)
            .padding(.horizontal, 12).frame(height: 38)
            .background(Color(.secondarySystemGroupedBackground), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func sheetView(_ destination: PlannerSheet) -> some View {
        if let data = viewModel.data {
            switch destination {
            case .item(let item, let date, let type):
                ItemEditorView(item: item, planningDate: date, defaultType: type, data: data, viewModel: viewModel, appleReminders: appleReminders)
            case .appleReminder(let reminder):
                AppleReminderEditorView(task: reminder, data: data, store: appleReminders)
            case .event(let event): EventDetailView(event: event, data: data, viewModel: viewModel)
            case .newEvent(let date): CalendarEventEditorView(event: nil, date: date, data: data, viewModel: viewModel)
            case .weather(let day): WeatherDetailView(day: day, unit: data.household.temperatureUnit)
            case .location(let day): LocationPickerView(day: day, locations: data.locations, viewModel: viewModel)
            case .search: PlannerSearchView(viewModel: viewModel)
            case .settings: SettingsView(data: data, viewModel: viewModel, auth: auth, appleReminders: appleReminders)
            }
        } else {
            EmptyView()
        }
    }
}

private struct PlannerGlassTabBar: View {
    @Binding var selection: PlannerDestination

    var body: some View {
        tabs
        .padding(5)
        .glassEffect(.regular.interactive(), in: Capsule())
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .sensoryFeedback(.selection, trigger: selection)
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            ForEach(PlannerDestination.allCases) { destination in
                let isSelected = destination == selection
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = destination }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: destination.icon)
                            .font(.system(size: 17, weight: isSelected ? .semibold : .medium))
                        Text(destination.title)
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                    }
                    .foregroundStyle(isSelected ? CWTheme.accentStrong : CWTheme.secondaryInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(isSelected ? CWTheme.mint.opacity(0.88) : Color.clear, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(destination.accessibilityTitle)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }
}

private struct ProfileAvatar: View {
    let user: SessionIdentity

    var body: some View {
        ZStack {
            Circle().fill(CWTheme.mint)
            if let url = user.avatarUrl {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else if case .empty = phase {
                        ProgressView().controlSize(.mini)
                    } else {
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .frame(width: 30, height: 30)
        .clipShape(Circle())
        .overlay(Circle().stroke(CWTheme.accent.opacity(0.18), lineWidth: 1))
    }

    private var fallback: some View {
        Text(user.displayName.prefix(1))
            .font(.caption.bold())
            .foregroundStyle(CWTheme.accentStrong)
    }
}

private struct LoadingWeekView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RoundedRectangle(cornerRadius: 8).fill(CWTheme.rule).frame(width: 220, height: 40)
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 22).fill(Color(.secondarySystemGroupedBackground)).frame(height: 350)
                }
            }.padding()
        }.redacted(reason: .placeholder)
    }
}

private struct WeeklyEventsList: View {
    let data: WeeklyPlannerData
    @Binding var sheet: PlannerSheet?

    var body: some View {
        LazyVStack(spacing: 14) {
            CardSurface {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Weekly events")
                        .font(CWTheme.display(28))
                        .tracking(-0.7)
                    Text("Every calendar event this week, grouped by day")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }

            ForEach(data.days) { day in
                DailyEventsCard(
                    day: day,
                    timeZoneIdentifier: data.household.timezone,
                    canAddEvent: !data.editableCalendars.isEmpty,
                    sheet: $sheet
                )
            }
        }
    }
}

private struct DailyEventsCard: View {
    let day: DayPlan
    let timeZoneIdentifier: String
    let canAddEvent: Bool
    @Binding var sheet: PlannerSheet?

    var body: some View {
        CardSurface {
            VStack(alignment: .leading, spacing: 13) {
                dayHeading(day.date, timeZoneIdentifier: timeZoneIdentifier)
                if day.events.isEmpty {
                    Text("No events")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .italic()
                } else {
                    ForEach(day.events) { event in
                        CalendarEventRow(event: event, isSupplemental: event.sectionGroup == "supplemental") {
                            sheet = .event(event)
                        }
                    }
                }
                if canAddEvent {
                    addListButton("Add event", icon: "calendar.badge.plus") {
                        sheet = .newEvent(day.date)
                    }
                }
            }
            .padding(18)
        }
    }
}

private struct WeeklyItemsList: View {
    let type: PlanningItemType
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @Binding var sheet: PlannerSheet?

    private var items: [PlanningItem] { data.weeklyItems.filter { $0.type == type } }
    private var isPlans: Bool { type == .note }

    var body: some View {
        LazyVStack(spacing: 14) {
            CardSurface {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(isPlans ? "All plans" : "All tasks")
                            .font(CWTheme.display(28))
                            .tracking(-0.7)
                        Text(isPlans ? "Whole-week plans first, followed by each day" : "Whole-week tasks first, followed by each day")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Eyebrow(text: isPlans ? "This week’s plans" : "This week’s tasks")
                    if items.isEmpty {
                        Text(isPlans ? "No weekly plans yet" : "No weekly tasks yet")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .italic()
                    } else {
                        ForEach(items) { item in
                            PlanningItemRow(item: item, viewModel: viewModel) { sheet = .item(item, date: nil, type: item.type) }
                        }
                    }
                    Button { sheet = .item(nil, date: nil, type: type) } label: {
                        Label(isPlans ? "Add a weekly plan" : "Add a weekly task", systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(CWTheme.accent)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: 44)
                    }
                    .buttonStyle(.plain)
                }
                .padding(20)
            }

            ForEach(data.days) { day in
                DailyItemsCard(
                    type: type,
                    day: day,
                    timeZoneIdentifier: data.household.timezone,
                    viewModel: viewModel,
                    appleReminders: appleReminders,
                    sheet: $sheet
                )
            }
        }
    }
}

private struct DailyItemsCard: View {
    let type: PlanningItemType
    let day: DayPlan
    let timeZoneIdentifier: String
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @Binding var sheet: PlannerSheet?

    private var items: [PlanningItem] { day.items.filter { $0.type == type } }
    private var reminderTasks: [AppleReminderTask] { type == .task ? appleReminders.tasks(for: day.date) : [] }
    private var isPlans: Bool { type == .note }

    var body: some View {
        CardSurface {
            VStack(alignment: .leading, spacing: 13) {
                dayHeading(day.date, timeZoneIdentifier: timeZoneIdentifier)
                if items.isEmpty && reminderTasks.isEmpty {
                    Text(isPlans ? "No plans" : "No tasks")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .italic()
                } else {
                    ForEach(items) { item in
                        PlanningItemRow(item: item, viewModel: viewModel) {
                            sheet = .item(item, date: day.date, type: item.type)
                        }
                    }
                    ForEach(reminderTasks) { task in
                        AppleReminderRow(task: task, store: appleReminders) {
                            sheet = .appleReminder(task)
                        }
                    }
                }
                addListButton(isPlans ? "Add a plan" : "Add a task", icon: "plus") {
                    sheet = .item(nil, date: day.date, type: type)
                }
            }
            .padding(18)
        }
    }
}

private func dayHeading(_ date: String, timeZoneIdentifier: String) -> some View {
    HStack(spacing: 8) {
        Text(WeekDate.longDay(date))
            .font(CWTheme.display(22))
            .tracking(-0.4)
        Spacer()
        if WeekDate.isToday(date, timeZoneIdentifier: timeZoneIdentifier) {
            Text("TODAY")
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .tracking(1)
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(CWTheme.brand, in: Capsule())
        }
    }
}

private func addListButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Label(title, systemImage: icon)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(CWTheme.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 42)
    }
    .buttonStyle(.plain)
}
