import SwiftUI

struct DayCardView: View {
    let day: DayPlan
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Binding var sheet: PlannerSheet?

    private var isToday: Bool { Calendar.current.isDateInToday(WeekDate.parse(day.date)) }
    private var plans: [PlanningItem] { day.items.filter { $0.type == .note } }
    private var tasks: [PlanningItem] { day.items.filter { $0.type == .task } }

    var body: some View {
        CardSurface {
            VStack(spacing: 0) {
                header
                section(title: "Calendar") {
                    if day.events.isEmpty {
                        Text(data.calendarState.status == "loading" ? "Loading calendar…" : "No events")
                            .font(.subheadline).foregroundStyle(.secondary).italic()
                    } else {
                        ForEach(day.events) { event in
                            CalendarEventRow(event: event) { sheet = .event(event) }
                        }
                    }
                    if !data.editableCalendars.isEmpty {
                        addButton("Add event", icon: "calendar.badge.plus") { sheet = .newEvent(day.date) }
                    }
                }
                Divider().overlay(CWTheme.rule)
                section(title: "Plans") {
                    ForEach(plans) { item in
                        PlanningItemRow(item: item, viewModel: viewModel) { sheet = .item(item, date: day.date, type: .note) }
                    }
                    addButton("Add a plan", icon: "plus") { sheet = .item(nil, date: day.date, type: .note) }
                }
                .background(Color(.secondarySystemGroupedBackground).opacity(0.35))
                Divider().overlay(CWTheme.rule)
                section(title: "Tasks") {
                    ForEach(tasks) { item in
                        PlanningItemRow(item: item, viewModel: viewModel) { sheet = .item(item, date: day.date, type: .task) }
                    }
                    addButton("Add a task", icon: "plus") { sheet = .item(nil, date: day.date, type: .task) }
                }
            }
        }
        .overlay(alignment: .top) {
            if isToday { Capsule().fill(CWTheme.brand).frame(width: 64, height: 4).padding(.top, 1) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(WeekDate.longDay(day.date))
                    .font(CWTheme.display(26))
                    .tracking(-0.6)
                Spacer()
                if isToday {
                    Text("TODAY").font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(1)
                        .foregroundStyle(.white).padding(.horizontal, 8).padding(.vertical, 5).background(CWTheme.brand, in: Capsule())
                }
            }
            HStack(spacing: 14) {
                Button { sheet = .location(day) } label: {
                    Label(day.location?.name ?? "Set location", systemImage: "location.fill")
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                Spacer(minLength: 4)
                if let weather = day.weather, weather.status == "available" {
                    Button { sheet = .weather(day) } label: {
                        HStack(spacing: 5) {
                            Image(systemName: weatherIcon(weather.conditionCode)).symbolRenderingMode(.multicolor)
                            Text("\(temperature(weather.highF))°")
                                .fontWeight(.bold)
                            Text("/ \(temperature(weather.lowF))°").foregroundStyle(.secondary)
                            if weather.precipitationProbability >= 35 {
                                Label("\(weather.precipitationProbability)%", systemImage: "umbrella.fill").foregroundStyle(.blue)
                            }
                        }
                    }.buttonStyle(.plain)
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(CWTheme.ink)
        }
        .padding(18)
        .background(LinearGradient(colors: [CWTheme.mint.opacity(isToday ? 0.9 : 0.5), CWTheme.cream.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
    }

    private func addButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(CWTheme.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 44)
        }.buttonStyle(.plain)
    }

    private func temperature(_ fahrenheit: Double) -> Int {
        data.household.temperatureUnit == .fahrenheit ? Int(fahrenheit.rounded()) : Int(((fahrenheit - 32) * 5 / 9).rounded())
    }
}

struct CalendarEventRow: View {
    let event: CalendarEvent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 11) {
                Text(event.attribution)
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Color(hex: event.calendarColor), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.allDay ? "All day" : eventTimeRange(event))
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(event.title).font(.subheadline.weight(.semibold)).foregroundStyle(CWTheme.ink)
                    if let location = event.location, !location.isEmpty {
                        Text(location).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                if event.isConflict == true { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                Image(systemName: "chevron.right").font(.caption2.weight(.bold)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct PlanningItemRow: View {
    let item: PlanningItem
    @ObservedObject var viewModel: PlannerViewModel
    let action: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if item.type == .task {
                Button { Task { await viewModel.toggle(item) } } label: {
                    Image(systemName: item.isCompleted ? "checkmark.square.fill" : "square")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(item.isCompleted ? CWTheme.accent : Color.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.isCompleted ? "Mark incomplete" : "Complete")
            } else {
                Circle().fill(Color(hex: item.categoryColor ?? "#7B8983")).frame(width: 7, height: 7).padding(.top, 7).padding(.horizontal, 6)
            }
            Button(action: action) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.text)
                        .font(.subheadline)
                        .foregroundStyle(CWTheme.ink)
                        .strikethrough(item.isCompleted)
                        .opacity(item.isCompleted ? 0.55 : 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let category = item.categoryName {
                        Text(category.uppercased()).font(.system(size: 8, weight: .bold, design: .monospaced)).tracking(0.8).foregroundStyle(.secondary)
                    }
                }.frame(minHeight: 38, alignment: .top)
            }.buttonStyle(.plain)
        }
    }
}

func weatherIcon(_ code: Int) -> String {
    switch code {
    case 0: "sun.max.fill"
    case 1...3: "cloud.sun.fill"
    case 45...48: "cloud.fog.fill"
    case 51...67, 80...82: "cloud.rain.fill"
    case 71...77, 85...86: "cloud.snow.fill"
    case 95...99: "cloud.bolt.rain.fill"
    default: "cloud.fill"
    }
}

func eventTimeRange(_ event: CalendarEvent) -> String {
    "\(WeekDate.eventTime(event.start))–\(WeekDate.eventTime(event.end))"
}
