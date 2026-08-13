import SwiftUI

enum PlannerSheet: Identifiable {
    case item(PlanningItem?, date: String?, type: PlanningItemType)
    case event(CalendarEvent)
    case newEvent(String)
    case weather(DayPlan)
    case location(DayPlan)
    case search
    case settings

    var id: String {
        switch self {
        case .item(let item, let date, let type): "item-\(item?.id ?? date ?? "weekly")-\(type.rawValue)"
        case .event(let event): "event-\(event.id)"
        case .newEvent(let date): "new-event-\(date)"
        case .weather(let day): "weather-\(day.date)"
        case .location(let day): "location-\(day.date)"
        case .search: "search"
        case .settings: "settings"
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
    @GestureState private var dayDragOffset: CGFloat = 0

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                AppBackground()
                content
                if let toast = viewModel.toast {
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
        }
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
                    dayPager(data)
                    WeeklyCard(data: data, viewModel: viewModel, sheet: $sheet)
                }
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 48)
            }
            .refreshable { await viewModel.load(week: data.weekStart, quietly: true) }
            .onAppear { synchronizeSelectedDay(with: data) }
            .onChange(of: data.weekStart) { _, _ in synchronizeSelectedDay(with: data) }
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
                DayCardView(day: day, data: data, viewModel: viewModel, sheet: $sheet)
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
                Button { Task { await viewModel.load(week: WeekDate.string(WeekDate.monday())) } } label: {
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
                ItemEditorView(item: item, planningDate: date, defaultType: type, data: data, viewModel: viewModel)
            case .event(let event): EventDetailView(event: event, data: data, viewModel: viewModel)
            case .newEvent(let date): CalendarEventEditorView(event: nil, date: date, data: data, viewModel: viewModel)
            case .weather(let day): WeatherDetailView(day: day, unit: data.household.temperatureUnit)
            case .location(let day): LocationPickerView(day: day, locations: data.locations, viewModel: viewModel)
            case .search: PlannerSearchView(viewModel: viewModel)
            case .settings: SettingsView(data: data, viewModel: viewModel, auth: auth)
            }
        } else {
            EmptyView()
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

private struct WeeklyCard: View {
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Binding var sheet: PlannerSheet?

    var body: some View {
        CardSurface {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("This week").font(CWTheme.display(28)).tracking(-0.7)
                    Text("Notes and tasks that don’t belong to one day").font(.caption).foregroundStyle(.secondary)
                }
                section(title: "Plans & notes", type: .note)
                Divider()
                section(title: "Tasks", type: .task)
            }.padding(20)
        }
    }

    private func section(title: String, type: PlanningItemType) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: title)
            ForEach(data.weeklyItems.filter { $0.type == type }) { item in
                PlanningItemRow(item: item, viewModel: viewModel) { sheet = .item(item, date: nil, type: item.type) }
            }
            Button { sheet = .item(nil, date: nil, type: type) } label: {
                Label("Add \(type == .note ? "a plan" : "a task")", systemImage: "plus")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(CWTheme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading).frame(height: 44)
            }.buttonStyle(.plain)
        }
    }
}
