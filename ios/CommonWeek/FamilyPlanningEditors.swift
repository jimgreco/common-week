import SwiftUI
import UniformTypeIdentifiers

struct AdultCalendarEditor: View {
    let adult: AdultCalendarAssignment
    let planner: WeeklyPlannerData
    @ObservedObject var store: FamilyPlanningStore
    @Environment(\.dismiss) private var dismiss
    @State private var selected: [String]

    init(adult: AdultCalendarAssignment, planner: WeeklyPlannerData, store: FamilyPlanningStore) {
        self.adult = adult; self.planner = planner; self.store = store
        _selected = State(initialValue: adult.calendarPreferenceIds)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    let calendars = CalendarEventFilter.calendars(in: planner)
                    if calendars.isEmpty { Text("Connect or share a calendar in Settings to assign it here.").foregroundStyle(.secondary) }
                    ForEach(calendars) { calendar in
                        Toggle(calendar.name, isOn: Binding(get: { selected.contains(calendar.id) }, set: { enabled in
                            selected.removeAll { $0 == calendar.id }
                            if enabled { selected.append(calendar.id) }
                        })).accessibilityIdentifier("adult-calendar-\(calendar.id)")
                    }
                } header: { Text("Calendars for \(adult.displayName)") } footer: {
                    Text("Selected calendars appear in this adult’s schedule and Person filter. A shared calendar can be assigned to several family members. Sharing permissions stay the same.")
                }
                if let error = store.error { Section { Text(error).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            .disabled(store.isSaving)
            .navigationTitle("Assign calendars")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(store.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Saving…" : "Save") {
                        Task {
                            if await store.save(.init(action: "saveAdultCalendars", weekStart: planner.weekStart, userId: adult.userId, calendarPreferenceIds: selected)) { dismiss() }
                        }
                    }.disabled(store.isSaving)
                }
            }
        }
    }
}

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
        _routine = State(initialValue: routine ?? .init(assignedMemberIds: sourceItem?.assignedMemberIds, id: UUID().uuidString, text: sourceItem?.text ?? "", childId: sourceItem?.childId, frequency: "weekly", interval: 1, weekdays: weekdays, startsOn: date, endsOn: nil, active: true))
        _hasEndDate = State(initialValue: routine?.endsOn != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Shared task") {
                    TextField("What needs doing?", text: $routine.text, axis: .vertical).lineLimit(2...4).accessibilityIdentifier("routine-title")
                    HouseholdMemberPicker(planner: planner, selection: Binding(get: { routine.assignedMemberIds ?? routine.childId.map { [$0] } ?? [] }, set: { routine.assignedMemberIds = $0; routine.childId = nil }))
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

struct HouseholdMemberPicker: View {
    let planner: WeeklyPlannerData
    @Binding var selection: [String]
    @State private var children: [ChildProfile] = []
    @State private var loadError: String?
    private var ids: [String] { planner.members.map(\.userId) + children.map(\.id) }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button("Select all") { selection = ids }.buttonStyle(.borderless)
                Spacer()
                Button("Clear") { selection = [] }.buttonStyle(.borderless)
            }
            ForEach(planner.members) { member in memberToggle(member.displayName, id: member.userId) }
            ForEach(children) { child in memberToggle(child.name, id: child.id) }
            if let loadError { Text(loadError).font(.caption).foregroundStyle(.secondary) }
        }.task {
            children = planner.childProfiles ?? []
            do {
                children = planner.isDemo ? FamilyPlanningStore.demo(weekStart: planner.weekStart).children : try await APIClient.shared.familyPlanning(week: planner.weekStart).children
            } catch { loadError = "Some household members could not be loaded. Existing selections are preserved." }
        }
    }
    private func memberToggle(_ name: String, id: String) -> some View {
        Toggle(name, isOn: Binding(get: { selection.contains(id) }, set: { enabled in
            selection.removeAll { $0 == id }; if enabled { selection.append(id) }
        })).accessibilityIdentifier("household-member-\(id)")
    }
}

struct EventMemberEditor: View {
    let event: CalendarEvent
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var selection: [String] = []
    @State private var saving = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section("Household members") { HouseholdMemberPicker(planner: planner, selection: $selection) }
                Section {
                    Text("These assignments apply to this event in Week of Us and override the calendar’s defaults.")
                    if event.recurringEventId != nil { Text("Applies to this occurrence.") }
                    Button("Use calendar defaults") { Task { await save(nil) } }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }.disabled(saving)
            .navigationTitle("Event assignments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save(selection) } }.disabled(saving) }
            }
            .onAppear { selection = event.assignedMemberIds ?? event.assignedAdultUserIds ?? [] }
        }
    }
    private func save(_ ids: [String]?) async {
        saving = true
        do {
            if !planner.isDemo {
                guard let calendarId = event.calendarPreferenceId, let providerId = event.providerEventId else { throw NSError(domain: "Assignments", code: 1, userInfo: [NSLocalizedDescriptionKey: "Refresh this event and try again."]) }
                try await APIClient.shared.saveEventMembers(calendarId: calendarId, providerId: providerId, ids: ids)
            }
            if var data = viewModel.data {
                for day in data.days.indices {
                    for index in data.days[day].events.indices where data.days[day].events[index].id == event.id {
                        data.days[day].events[index].memberOverrideIds = ids
                        data.days[day].events[index].assignedMemberIds = ids ?? event.defaultMemberIds ?? []
                    }
                }
                viewModel.data = data
                if planner.isDemo { FamilyPlanningDemo.shared.capture(data) }
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
        saving = false
    }
}

struct TaskWorkspaceView: View {
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    var initialItemId: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var tasks: [WorkspaceTask] = []
    @State private var filter = "All"
    @State private var capture = ""
    @State private var error: String?
    @State private var busy = false
    @State private var selected: WorkspaceTask?
    private var today: String { WeekDate.string(Date(), timeZoneIdentifier: planner.household.timezone) }
    private var filtered: [WorkspaceTask] { tasks.filter { $0.matches(filter, userId: viewModel.workspaceUserId, today: today) } }

    var body: some View {
        NavigationStack {
            List {
                if viewModel.canEditHousehold {
                    Section("Capture now, plan later") {
                        TextField("New task", text: $capture).accessibilityIdentifier("backlog-capture")
                        Button("Add to backlog") { Task { await add() } }.disabled(busy || capture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section {
                    Picker("Show", selection: $filter) { ForEach(["All", "Mine", "Unassigned", "Backlog", "Overdue", "Completed"], id: \.self) { Text($0).tag($0) } }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                Section("\(filtered.count) tasks") {
                    ForEach(filtered) { task in
                        Button { selected = task } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(task.text).foregroundStyle(.primary)
                                Text("\(person(task.responsibleMemberId)) · \(task.isBacklog ? "Backlog" : task.planningDate ?? "Week of \(task.weekStartDate)")").font(.caption).foregroundStyle(.secondary)
                                if let deadline = task.deadline { Text("Due \(deadline)").font(.caption).foregroundStyle(!task.isCompleted && deadline < today ? .red : .secondary) }
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                    if filtered.isEmpty { Text("No tasks in this view.").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Household tasks")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.fixedSize() } }
            .task { await reload(); if let initialItemId { selected = tasks.first { $0.id == initialItemId } } }
            .refreshable { await reload() }
            .sheet(item: $selected, onDismiss: { Task { await reload(); await viewModel.load(quietly: true) } }) { task in
                ItemCollaborationView(resource: ["itemId": task.id], title: task.text, planner: planner, viewModel: viewModel).familyPlanningSheetSize()
            }
        }
    }
    private func person(_ id: String?) -> String { planner.members.first { $0.userId == id }?.displayName ?? planner.childProfiles?.first { $0.id == id }?.name ?? "Unassigned" }
    private func reload() async {
        do { tasks = try await WorkspaceAccess.load(planner: planner).tasks; error = nil } catch { self.error = error.localizedDescription }
    }
    private func add() async {
        busy = true; defer { busy = false }
        do { try await WorkspaceAccess.mutate(["action": .string("capture"), "id": .string(UUID().uuidString), "text": .string(capture.trimmingCharacters(in: .whitespacesAndNewlines))], planner: planner, userId: viewModel.workspaceUserId); capture = ""; filter = "Backlog"; await reload() }
        catch { self.error = error.localizedDescription }
    }
}

struct ItemCollaborationView: View {
    let resource: [String: String]
    let title: String
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    var includePlacement = true
    @Environment(\.dismiss) private var dismiss
    @State private var payload: TaskWorkspacePayload?
    @State private var error: String?
    @State private var busy = false
    @State private var step = ""
    @State private var comment = ""
    @State private var importing = false
    @State private var downloaded: URL?
    @State private var nameDraft: String?
    @FocusState private var editingField: String?
    private var task: WorkspaceTask? { payload?.task }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Section { Text(error).foregroundStyle(.red) } }
                if payload == nil && error == nil { ProgressView("Loading shared details…") }
                if let task, task.type == "task" { taskFields(task) }
                Section("Checklist") {
                    ForEach(payload?.entries.filter { $0.kind == "checklist" } ?? []) { entry in
                        Toggle(entry.text, isOn: Binding(get: { entry.completed }, set: { value in Task { await save("check", fields: ["id": .string(entry.id), "completed": .bool(value)]) } }))
                            .disabled(busy || !viewModel.canEditHousehold)
                            .swipeActions { if viewModel.canEditHousehold { Button("Delete", role: .destructive) { Task { await save("remove", fields: ["id": .string(entry.id)]) } } } }
                    }
                    if viewModel.canEditHousehold {
                        TextField("Add a step", text: $step).focused($editingField, equals: "step")
                        Button("Add step") { Task { if await addEntry("checklist", text: step) { step = ""; editingField = nil } } }.disabled(busy || step.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section("Discussion") {
                    ForEach(payload?.entries.filter { $0.kind == "comment" } ?? []) { entry in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(entry.author).font(.caption.bold())
                            Text(entry.text)
                            Text(entry.createdAt.prefix(16).replacingOccurrences(of: "T", with: " ")).font(.caption2).foregroundStyle(.secondary)
                            if entry.createdBy == viewModel.workspaceUserId && viewModel.canEditHousehold { Button("Remove comment", role: .destructive) { Task { await save("remove", fields: ["id": .string(entry.id)]) } }.disabled(busy) }
                        }
                    }
                    if viewModel.canEditHousehold {
                        TextField("Leave a note for the household", text: $comment, axis: .vertical).lineLimit(3...6).focused($editingField, equals: "comment")
                        Button("Post comment") { Task { if await addEntry("comment", text: comment) { comment = ""; editingField = nil } } }.disabled(busy || comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section {
                    ForEach(payload?.entries.filter { $0.kind == "file" } ?? []) { entry in
                        Button(entry.text) { Task { await download(entry) } }
                            .swipeActions { if entry.createdBy == viewModel.workspaceUserId && viewModel.canEditHousehold { Button("Delete", role: .destructive) { Task { await save("remove", fields: ["id": .string(entry.id)]) } } } }
                    }
                    if viewModel.canEditHousehold { Button("Attach a file") { importing = true }.disabled(busy) }
                    if let downloaded { ShareLink("Open or share downloaded file", item: downloaded) }
                } header: { Text("Files") } footer: { Text("Shared with people who can view this item. Up to 5 MB per file.") }
            }
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.fixedSize() } }
            .task { await reload() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
                Task {
                    do {
                        let url = try result.get(); let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                        let bytes = try Data(contentsOf: url, options: .mappedIfSafe)
                        guard !bytes.isEmpty && bytes.count <= 5_242_880 else { throw APIError.server("Choose a file between 1 byte and 5 MB.") }
                        await save("add", fields: ["id": .string(UUID().uuidString), "kind": .string("file"), "text": .string(url.lastPathComponent), "fileData": .string(bytes.base64EncodedString())])
                    } catch { self.error = error.localizedDescription }
                }
            }
        }
    }
    @ViewBuilder private func taskFields(_ task: WorkspaceTask) -> some View {
        Section("Responsibility & timing") {
            if includePlacement {
                TextField("Task name", text: Binding(get: { nameDraft ?? task.text }, set: { nameDraft = $0 }))
                if let nameDraft, nameDraft != task.text { Button("Save task name") { Task { await save("task", fields: ["text": .string(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines))]) } }.disabled(nameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
            }
            Picker("Responsible person", selection: Binding(get: { task.responsibleMemberId ?? "" }, set: { value in Task { await save("task", fields: ["responsibleMemberId": value.isEmpty ? .null : .string(value)]) } })) {
                Text("Unassigned").tag("")
                ForEach(planner.members) { Text($0.displayName).tag($0.userId) }
                ForEach(planner.childProfiles ?? []) { Text($0.name).tag($0.id) }
            }.id("responsibility-\(task.responsibleMemberId ?? "unassigned")")
            if task.responsibleMemberId == nil { Button("I’ll take this") { Task { await save("task", fields: ["claim": .bool(true)]) } } }
            Toggle("Has a deadline", isOn: Binding(get: { task.deadline != nil }, set: { value in Task { await save("task", fields: ["deadline": value ? .string(planner.weekStart) : .null]) } }))
            if let deadline = task.deadline {
                DatePicker("Must be done by", selection: Binding(get: { WeekDate.calendarDate(deadline) }, set: { value in Task { await save("task", fields: ["deadline": .string(WeekDate.string(value, timeZoneIdentifier: TimeZone.current.identifier))]) } }), displayedComponents: .date)
            }
            if includePlacement {
                Picker("Placement", selection: Binding(get: { task.isBacklog ? "backlog" : task.planningDate == nil ? "week" : "day" }, set: { value in Task { await save("task", fields: ["isBacklog": .bool(value == "backlog"), "planningDate": value == "day" ? .string(planner.weekStart) : .null, "weekStartDate": .string(planner.weekStart)]) } })) {
                    Text("Unscheduled backlog").tag("backlog"); Text("Selected week").tag("week"); Text("Choose a day").tag("day")
                }
                if !task.isBacklog, let date = task.planningDate {
                    DatePicker("Plan to do on", selection: Binding(get: { WeekDate.calendarDate(date) }, set: { value in Task { await save("task", fields: ["planningDate": .string(WeekDate.string(value, timeZoneIdentifier: TimeZone.current.identifier))]) } }), displayedComponents: .date)
                }
            }
            Toggle("Task complete", isOn: Binding(get: { task.isCompleted }, set: { value in Task { await save("task", fields: ["isCompleted": .bool(value)]) } }))
        }.disabled(busy || !viewModel.canEditHousehold)
    }
    private func reload() async { do { payload = try await WorkspaceAccess.load(planner: planner, resource: resource) } catch { self.error = error.localizedDescription } }
    @discardableResult private func save(_ action: String, fields: [String: WorkspaceValue]) async -> Bool {
        busy = true; error = nil; defer { busy = false }
        var body = fields; body["action"] = .string(action); body["resource"] = .object(resource.mapValues { .string($0) })
        do { try await WorkspaceAccess.mutate(body, planner: planner, userId: viewModel.workspaceUserId); await reload(); if planner.isDemo, let current = viewModel.data { viewModel.data = WorkspaceAccess.applying(to: current) }; return true }
        catch { self.error = error.localizedDescription; return false }
    }
    private func addEntry(_ kind: String, text: String) async -> Bool { await save("add", fields: ["id": .string(UUID().uuidString), "kind": .string(kind), "text": .string(text.trimmingCharacters(in: .whitespacesAndNewlines))]) }
    private func download(_ entry: WorkspaceEntry) async {
        do { downloaded = try await WorkspaceAccess.file(entry, planner: planner) } catch { self.error = error.localizedDescription }
    }
}
