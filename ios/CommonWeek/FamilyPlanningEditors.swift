import SwiftUI

struct ChildProfileEditor: View {
    let planner: WeeklyPlannerData
    @ObservedObject var store: FamilyPlanningStore
    @Environment(\.dismiss) private var dismiss
    private let existing: Bool
    @State private var child: ChildProfile
    @State private var confirmingDelete = false
    private let colors = ["#688173", "#587F9B", "#B77966", "#8E79A5", "#B28F49", "#BC6F83"]

    init(child: ChildProfile?, planner: WeeklyPlannerData, store: FamilyPlanningStore) {
        self.planner = planner; self.store = store; existing = child != nil
        _child = State(initialValue: child ?? .init(id: UUID().uuidString, name: "", color: "#688173", calendarPreferenceIds: []))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Child’s name", text: $child.name).accessibilityIdentifier("child-name")
                    Picker("Color", selection: $child.color) {
                        ForEach(Array(colors.enumerated()), id: \.element) { index, color in
                            Label(["Sage", "Blue", "Terracotta", "Lavender", "Gold", "Rose"][index], systemImage: "circle.fill")
                                .foregroundStyle(Color(hex: color)).tag(color)
                        }
                    }
                    Text("No email address or account needed. Adults in the household manage this profile.").font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    let calendars = CalendarEventFilter.calendars(in: planner)
                    if calendars.isEmpty { Text("Connect a calendar in Settings to include events in this child’s schedule.").font(.footnote).foregroundStyle(.secondary) }
                    ForEach(calendars) { calendar in
                        Toggle(calendar.name, isOn: Binding(get: { child.calendarPreferenceIds.contains(calendar.id) }, set: { selected in
                            child.calendarPreferenceIds.removeAll { $0 == calendar.id }
                            if selected { child.calendarPreferenceIds.append(calendar.id) }
                        }))
                    }
                } header: { Text("Calendars for this child") } footer: { Text("Selected calendars’ visible events appear in this child’s schedule. You can also tag individual plans and tasks in their editor.") }
                if let error = store.error { Section { Text(error).foregroundStyle(.red) } }
                if existing { Section { Button("Delete child profile", role: .destructive) { confirmingDelete = true } } }
            }
            .formStyle(.grouped)
            .disabled(store.isSaving)
            .navigationTitle(existing ? "Edit child" : "Add child")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(store.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Saving…" : "Save") {
                        Task {
                            child.name = child.name.trimmingCharacters(in: .whitespacesAndNewlines)
                            if await store.save(.init(action: "saveChild", weekStart: planner.weekStart, child: child)) { dismiss() }
                        }
                    }.disabled(store.isSaving || child.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .confirmationDialog("Delete \(child.name)’s profile?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete profile", role: .destructive) {
                    Task { if await store.save(.init(action: "deleteChild", weekStart: planner.weekStart, id: child.id)) { dismiss() } }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("The child’s plans, tasks, and calendar events remain in the household planner.") }
        }
    }
}

struct TaskRoutineEditor: View {
    let planner: WeeklyPlannerData
    @ObservedObject var store: FamilyPlanningStore
    let changed: () async -> Void
    @Environment(\.dismiss) private var dismiss
    private let existing: Bool
    @State private var routine: TaskRoutine
    private let sourceItemId: String?
    @State private var hasEndDate: Bool
    @State private var confirmingDelete = false

    init(routine: TaskRoutine?, planner: WeeklyPlannerData, store: FamilyPlanningStore, sourceItem: PlanningItem? = nil, changed: @escaping () async -> Void) {
        self.planner = planner; self.store = store; self.changed = changed; existing = routine != nil
        sourceItemId = sourceItem?.id
        let date = sourceItem?.planningDate ?? planner.weekStart
        let weekdays = sourceItem?.planningDate.map { [WeekDate.daysBetween(WeekDate.weekStart(for: $0), $0)] } ?? []
        _routine = State(initialValue: routine ?? .init(id: UUID().uuidString, text: sourceItem?.text ?? "", childId: sourceItem?.childId, frequency: "weekly", interval: 1, weekdays: weekdays, startsOn: date, endsOn: nil, active: true))
        _hasEndDate = State(initialValue: routine?.endsOn != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Shared task") {
                    TextField("What needs doing?", text: $routine.text, axis: .vertical).lineLimit(2...4).accessibilityIdentifier("routine-title")
                    Picker("Child", selection: Binding(get: { routine.childId ?? "" }, set: { routine.childId = $0.isEmpty ? nil : $0 })) {
                        Text("Whole household").tag("")
                        ForEach(store.data?.children ?? []) { Text($0.name).tag($0.id) }
                    }
                    if existing { Toggle("Active", isOn: $routine.active) }
                }
                Section("Repeat schedule") {
                    Picker("Repeats", selection: $routine.frequency) {
                        Text("Daily").tag("daily"); Text("Weekly").tag("weekly")
                    }
                    Stepper("Every \(routine.interval) \(routine.frequency == "daily" ? "day" : "week")\(routine.interval == 1 ? "" : "s")", value: $routine.interval, in: 1...52)
                    ForEach(0..<7, id: \.self) { index in
                        Toggle(TaskRoutine.weekdayNames[index], isOn: Binding(get: { routine.weekdays.contains(index) }, set: { selected in
                            routine.weekdays.removeAll { $0 == index }
                            if selected { routine.weekdays.append(index); routine.weekdays.sort() }
                        }))
                    }
                    Text(routine.frequency == "daily"
                         ? "Select days to limit the daily schedule. Leave every day off to include all days."
                         : "Leave every day off for one whole-week task, without a specific day.")
                        .font(.footnote).foregroundStyle(.secondary)
                    DatePicker("Starts", selection: dateBinding(\.startsOn), displayedComponents: .date)
                    Toggle("End on a date", isOn: $hasEndDate)
                    if hasEndDate {
                        DatePicker("Ends", selection: Binding(get: { WeekDate.calendarDate(routine.endsOn ?? routine.startsOn, timeZoneIdentifier: planner.household.timezone) }, set: { routine.endsOn = WeekDate.string($0, timeZoneIdentifier: planner.household.timezone) }), in: WeekDate.calendarDate(routine.startsOn, timeZoneIdentifier: planner.household.timezone)..., displayedComponents: .date)
                    }
                }
                Section {
                    Text(existing ? "Schedule changes update future unfinished occurrences. Completed tasks and past dates stay intact. Pause the routine to stop future tasks." : "Tasks appear in your shared planner as you open each week. Each occurrence can be completed separately.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let error = store.error { Text(error).foregroundStyle(.red) }
                }
                if existing { Section { Button("Delete routine", role: .destructive) { confirmingDelete = true } } }
            }
            .formStyle(.grouped)
            .disabled(store.isSaving)
            .environment(\.timeZone, TimeZone(identifier: planner.household.timezone) ?? .current)
            .navigationTitle(existing ? "Edit routine" : "New routine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(store.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(store.isSaving || routine.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .confirmationDialog("Delete this routine?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete routine", role: .destructive) {
                    Task {
                        if await store.save(.init(action: "deleteRoutine", weekStart: planner.weekStart, id: routine.id)) { await changed(); dismiss() }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("Stops future unfinished occurrences. Completed tasks and past dates stay in your planner.") }
        }
    }

    private func dateBinding(_ keyPath: WritableKeyPath<TaskRoutine, String>) -> Binding<Date> {
        Binding(get: { WeekDate.calendarDate(routine[keyPath: keyPath], timeZoneIdentifier: planner.household.timezone) }, set: { routine[keyPath: keyPath] = WeekDate.string($0, timeZoneIdentifier: planner.household.timezone) })
    }

    private func save() async {
        routine.text = routine.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !hasEndDate { routine.endsOn = nil }
        else if routine.endsOn == nil { routine.endsOn = routine.startsOn }
        if await store.save(.init(action: "saveRoutine", weekStart: planner.weekStart, routine: routine, sourceItemId: sourceItemId)) { await changed(); dismiss() }
    }
}

struct PlanningItemRoutineView: View {
    let item: PlanningItem
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @StateObject private var store: FamilyPlanningStore
    @Environment(\.dismiss) private var dismiss

    init(item: PlanningItem, planner: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.item = item; self.planner = planner; self.viewModel = viewModel
        _store = StateObject(wrappedValue: FamilyPlanningStore(weekStart: planner.weekStart, isDemo: planner.isDemo, plannerViewModel: viewModel))
    }

    var body: some View {
        Group {
            if let data = store.data {
                if let routineId = item.routineId, let routine = data.routines.first(where: { $0.id == routineId }) {
                    TaskRoutineEditor(routine: routine, planner: planner, store: store, changed: { await viewModel.load(week: planner.weekStart, quietly: true) })
                } else if item.routineId == nil {
                    TaskRoutineEditor(routine: nil, planner: planner, store: store, sourceItem: item, changed: { await viewModel.load(week: planner.weekStart, quietly: true) })
                } else {
                    ContentUnavailableView {
                        Label("Routine no longer available", systemImage: "repeat")
                    } description: {
                        Text("This occurrence remains in the planner, but its routine has been removed.")
                    } actions: { Button("Done") { dismiss() } }
                }
            } else {
                NavigationStack {
                    VStack(spacing: 16) {
                        if let error = store.error { Text(error); Button("Try again") { Task { await store.load() } } }
                        else { ProgressView("Loading routine…") }
                    }.padding().toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                }
            }
        }.task { await store.load() }
    }
}

struct PlanningChildPicker: View {
    let planner: WeeklyPlannerData
    @Binding var childId: String
    @State private var children: [ChildProfile] = []
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Picker("Child", selection: $childId) {
                Text("Whole household").tag("")
                if !childId.isEmpty && !children.contains(where: { $0.id == childId }) { Text("Current child profile").tag(childId) }
                ForEach(children) { Text($0.name).tag($0.id) }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
        }
        .task(id: "\(planner.household.id):\(planner.weekStart)") {
            do {
                children = planner.isDemo ? FamilyPlanningStore.demo(weekStart: planner.weekStart).children : try await APIClient.shared.familyPlanning(week: planner.weekStart).children
                error = nil
            } catch { self.error = "Child profiles are unavailable. The current selection is preserved." }
        }
    }
}
