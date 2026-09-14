import SwiftUI

struct CalendarPlanningGroup: Identifiable {
    let date: String?
    let items: [PlanningItem]
    var id: String { date ?? "week" }
    var title: String { date.map(WeekDate.longDay) ?? "This week" }

    static func groups(days: [DayPlan], weeklyItems: [PlanningItem], personId: String, searchText: String = "") -> [CalendarPlanningGroup] {
        let matches: (PlanningItem) -> Bool = {
            CalendarEventFilter.matches($0, personId: personId)
                && (searchText.isEmpty || $0.text.localizedCaseInsensitiveContains(searchText))
        }
        return days.map { CalendarPlanningGroup(date: $0.date, items: $0.items.filter(matches)) }
            + [CalendarPlanningGroup(date: nil, items: weeklyItems.filter(matches))]
    }
}

struct CalendarPlanningPane: View {
    let days: [DayPlan]
    let weeklyItems: [PlanningItem]
    let personId: String
    let currentUserId: String
    let canEdit: Bool
    var searchText = ""
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    let onEdit: (PlanningItem) -> Void
    let onAdd: (String?, PlanningItemType) -> Void
    let onReminder: (AppleReminderTask) -> Void
    var onExpand: () -> Void = {}
    #if targetEnvironment(macCatalyst)
    @State private var expanded = true
    #else
    @State private var expanded = false
    #endif

    private var groups: [CalendarPlanningGroup] {
        CalendarPlanningGroup.groups(days: days, weeklyItems: weeklyItems, personId: personId, searchText: searchText)
    }

    private func reminders(for date: String?) -> [AppleReminderTask] {
        guard let date, personId == CalendarEventFilter.allPeople || personId == currentUserId else { return [] }
        return appleReminders.tasks(for: date).filter { searchText.isEmpty || $0.title.localizedCaseInsensitiveContains(searchText) }
    }

    private var summary: String {
        let items = groups.flatMap(\.items)
        let tasks = items.filter { $0.type == .task && !$0.isCompleted }.count
            + groups.flatMap { reminders(for: $0.date) }.filter { !$0.isCompleted }.count
        let notes = items.filter { $0.type == .note }.count
        return "\(tasks) \(tasks == 1 ? "task" : "tasks") left · \(notes) \(notes == 1 ? "note" : "notes")"
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            Button {
                expanded.toggle()
                if expanded { onExpand() }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Tasks & Notes").font(.subheadline.weight(.semibold))
                        Text(summary).font(.caption).foregroundStyle(CWTheme.secondaryInk)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.down" : "chevron.up").font(.caption.weight(.semibold))
                }
                .foregroundStyle(CWTheme.ink)
                .padding(.horizontal, 14).frame(height: 56)
                .background(CWTheme.mint.opacity(0.2))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("calendar-planning-toggle")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(groups) { group in
                            groupView(group)
                        }
                    }.padding(14)
                }
                .frame(height: 210)
                .accessibilityIdentifier("calendar-planning-scroll")
            }
        }
        .background(Color(uiColor: .secondarySystemGroupedBackground))
    }

    private func groupView(_ group: CalendarPlanningGroup) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.title).font(.caption.weight(.bold))
                Spacer(minLength: 4)
                if canEdit {
                    Menu {
                        Button("Add task") { onAdd(group.date, .task) }
                        Button("Add note") { onAdd(group.date, .note) }
                    } label: {
                        Label("Add", systemImage: "plus").font(.caption.weight(.semibold))
                            .padding(.vertical, 6)
                    }
                    .accessibilityLabel("Add for \(group.title)")
                    .accessibilityIdentifier("calendar-planning-add-\(group.id)")
                }
            }
            if group.date == nil {
                Text("Flexible plans for the whole week").font(.caption2).foregroundStyle(CWTheme.secondaryInk)
            }
            if group.items.isEmpty && reminders(for: group.date).isEmpty {
                Text("No tasks or notes in this view.").font(.caption).foregroundStyle(CWTheme.secondaryInk)
            }
            ForEach(group.items) { item in
                PlanningItemRow(item: item, viewModel: viewModel, canEdit: canEdit) { onEdit(item) }
                    .accessibilityIdentifier("calendar-planning-item-\(item.id)")
            }
            ForEach(reminders(for: group.date)) { reminder in
                AppleReminderRow(task: reminder, store: appleReminders) { onReminder(reminder) }
            }
        }
    }
}
