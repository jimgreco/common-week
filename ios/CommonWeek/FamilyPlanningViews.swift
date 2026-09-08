import SwiftUI

private enum FamilyPlanningTab: String, CaseIterable, Identifiable {
    case review = "Review", children = "Family", routines = "Routines", templates = "Templates"
    var id: String { rawValue }
}

private enum FamilyPlanningSheet: Identifiable {
    case adult(AdultCalendarAssignment), child(ChildProfile?), routine(TaskRoutine?), item(PlanningItem), event(CalendarEvent)
    var id: String {
        switch self {
        case .adult(let value): "adult-\(value.userId)"
        case .child(let value): "child-\(value?.id ?? "new")"
        case .routine(let value): "routine-\(value?.id ?? "new")"
        case .item(let value): "item-\(value.id)"
        case .event(let value): "event-\(value.id)"
        }
    }
}

struct FamilyPlanningView: View {
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @StateObject private var store: FamilyPlanningStore
    @Environment(\.dismiss) private var dismiss
    @State private var tab = FamilyPlanningTab.review
    @State private var sheet: FamilyPlanningSheet?
    @State private var selectedChildId = ""
    @State private var selectedAdultId: String?
    @State private var reviewStep = 0
    @State private var priorities = ""
    @State private var meals = ""
    @State private var logistics = ""
    @State private var reviewBaseline: WeeklyReview?
    @State private var templateName = ""
    @State private var templateRequestId = UUID().uuidString
    @State private var applyingTemplate: WeekTemplate?
    @State private var deletingTemplate: WeekTemplate?
    @State private var confirmingDiscard = false
    @State private var confirmingReload = false

    init(planner: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.planner = planner
        self.viewModel = viewModel
        _store = StateObject(wrappedValue: FamilyPlanningStore(weekStart: planner.weekStart, isDemo: planner.isDemo, plannerViewModel: viewModel))
    }

    private var currentPlanner: WeeklyPlannerData {
        guard let data = viewModel.data, data.household.id == planner.household.id, data.weekStart == planner.weekStart else { return planner }
        return data
    }

    private var notesAreDirty: Bool {
        guard let reviewBaseline else { return false }
        return priorities != reviewBaseline.priorities || meals != reviewBaseline.meals || logistics != reviewBaseline.logistics
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Family planning", selection: $tab) {
                    ForEach(FamilyPlanningTab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("family-planning-tabs")
                .padding()
                if let data = store.data {
                    Form {
                        Section {
                            Label(WeekDate.weekTitle(planner.weekStart), systemImage: "calendar")
                                .font(.headline).foregroundStyle(CWTheme.accentStrong)
                            if !data.canEdit { Text("Your household access is read-only.").font(.footnote) }
                        }
                        if let error = store.error {
                            Section {
                                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                                Button("Reload latest planning") {
                                    if notesAreDirty { confirmingReload = true }
                                    else { Task { await store.load(); adoptReview() } }
                                }
                            }
                        }
                        switch tab {
                        case .review: reviewSections(data)
                        case .children: childrenSections(data)
                        case .routines: routineSections(data)
                        case .templates: templateSections(data)
                        }
                    }
                    .formStyle(.grouped)
                    .disabled(store.isSaving)
                    if tab == .review { reviewNavigation(data) }
                } else if store.isLoading {
                    Spacer(); ProgressView("Loading family planning…"); Spacer()
                } else {
                    ContentUnavailableView {
                        Label("Family planning unavailable", systemImage: "wifi.exclamationmark")
                    } description: { Text(store.error ?? "Try again when connected.") } actions: {
                        Button("Try again") { Task { await store.load() } }
                    }
                }
            }
            .navigationTitle("Plan your week")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { if notesAreDirty { confirmingDiscard = true } else { dismiss() } }
                }
            }
            .task {
                if viewModel.pendingChangeCount > 0 { await viewModel.load(week: planner.weekStart, quietly: true) }
                await store.load(); adoptReview()
            }
            .onChange(of: store.data?.review) { _, _ in if !notesAreDirty { adoptReview() } }
            .interactiveDismissDisabled(notesAreDirty || store.isSaving)
            .sheet(item: $sheet, onDismiss: { Task { await viewModel.load(week: planner.weekStart, quietly: true); await store.load() } }) { destination in
                editor(destination)
                    .familyPlanningSheetSize()
            }
            .confirmationDialog("Discard your unsaved planning notes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .confirmationDialog("Replace your unsaved notes with the latest household plan?", isPresented: $confirmingReload, titleVisibility: .visible) {
                Button("Load latest plan", role: .destructive) { Task { await store.load(); adoptReview() } }
                Button("Keep editing", role: .cancel) {}
            }
            .confirmationDialog("Apply \(applyingTemplate?.name ?? "template") to \(WeekDate.weekTitle(planner.weekStart))?", isPresented: Binding(get: { applyingTemplate != nil }, set: { if !$0 { applyingTemplate = nil } }), titleVisibility: .visible) {
                Button("Add template to this week") {
                    guard let template = applyingTemplate else { return }
                    applyingTemplate = nil
                    Task { await mutate(.init(action: "applyTemplate", weekStart: planner.weekStart, id: template.id)) }
                }
                Button("Cancel", role: .cancel) { applyingTemplate = nil }
            } message: { Text("Adds the template’s plans and tasks alongside this week’s existing items. A template can only be applied once to each week.") }
            .confirmationDialog("Delete this template?", isPresented: Binding(get: { deletingTemplate != nil }, set: { if !$0 { deletingTemplate = nil } }), titleVisibility: .visible) {
                Button("Delete template", role: .destructive) {
                    guard let template = deletingTemplate else { return }
                    deletingTemplate = nil
                    Task { await mutate(.init(action: "deleteTemplate", weekStart: planner.weekStart, id: template.id)) }
                }
                Button("Cancel", role: .cancel) { deletingTemplate = nil }
            } message: { Text("Items already added to a week remain in the planner.") }
        }
    }

    @ViewBuilder
    private func reviewSections(_ data: FamilyPlanningData) -> some View {
        Section {
            Text("Step \(reviewStep + 1) of 4").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(["Finish what’s outstanding", "Look over the week", "Agree on a plan", "Ready for the week"][reviewStep]).font(.title3.bold())
        }
        switch reviewStep {
        case 0:
            Section {
                let tasks = reviewTasks(data).filter { $0.type == .task && !$0.isCompleted }
                    .sorted { ($0.carryoverCount ?? 0) > ($1.carryoverCount ?? 0) }
                if tasks.isEmpty { Label("No unfinished tasks for this week", systemImage: "checkmark.circle") }
                ForEach(tasks) { item in
                    HStack {
                        Button { Task { await viewModel.toggle(item); await store.load() } } label: { Image(systemName: "circle") }
                            .buttonStyle(.plain).disabled(!data.canEdit)
                            .accessibilityLabel("Complete \(item.text)")
                        Button { sheet = .item(item) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.text).foregroundStyle(.primary)
                                Text((item.carryoverCount ?? 0) > 0 ? "Carried forward · choose a day or finish it" : item.planningDate.map { WeekDate.shortDay($0) } ?? "This week")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }.buttonStyle(.plain)
                        Spacer()
                        if data.canEdit {
                            Menu {
                                Button("Edit or reschedule") { sheet = .item(item) }
                                Button(item.weekStartDate < planner.weekStart ? "Plan for this week" : "Move to next week") { Task { await moveToNextWeek(item) } }
                            } label: { Image(systemName: "ellipsis.circle") }
                        }
                    }
                }
            } header: { Text("Open tasks") } footer: { Text("Finish, reschedule, or deliberately carry forward the work that still matters.") }
        case 1:
            ForEach(currentPlanner.days) { day in
                Section(WeekDate.shortDay(day.date)) {
                    if day.events.isEmpty { Text("No calendar commitments").foregroundStyle(.secondary) }
                    ForEach(day.events) { event in
                        Button { sheet = .event(event) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(event.title).foregroundStyle(.primary)
                                    Text(event.allDay ? "All day · \(event.calendarAlias)" : "\(WeekDate.eventTime(event.start)) · \(event.calendarAlias)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if event.isConflict == true { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).accessibilityLabel("Overlapping event") }
                            }
                        }.buttonStyle(.plain)
                    }
                }
            }
            Section { Text("Check overlapping commitments, school activities, and where everyone needs to be.").font(.footnote).foregroundStyle(.secondary) }
        case 2:
            Section("Priorities") { TextField("What matters most this week?", text: $priorities, axis: .vertical).accessibilityIdentifier("review-priorities").lineLimit(3...6).disabled(!data.canEdit) }
            Section("Meals") { TextField("Dinner ideas and nights at home", text: $meals, axis: .vertical).lineLimit(3...6).disabled(!data.canEdit) }
            Section("Logistics") { TextField("Pickup plans, travel, and things to coordinate", text: $logistics, axis: .vertical).lineLimit(3...6).disabled(!data.canEdit) }
            Section {
                Button("Save planning notes") { Task { _ = await saveNotes() } }.disabled(!notesAreDirty || !data.canEdit)
                Text("These notes are shared with your household for this week.").font(.footnote).foregroundStyle(.secondary)
            }
        default:
            Section("Your shared plan") {
                reviewSummary("Priorities", text: data.review.priorities)
                reviewSummary("Meals", text: data.review.meals)
                reviewSummary("Logistics", text: data.review.logistics)
            }
            Section("Household review") {
                ForEach(currentPlanner.members) { member in
                    let review = data.review.reviewedBy.first { $0.userId == member.userId }
                    VStack(alignment: .leading, spacing: 4) {
                        Label(review == nil ? "\(member.displayName) · not reviewed yet" : "\(member.displayName) · reviewed", systemImage: review == nil ? "circle" : "checkmark.circle.fill")
                            .foregroundStyle(review == nil ? Color.secondary : CWTheme.accentStrong)
                        if let date = review?.date {
                            Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                let reviewed = data.review.reviewedBy.contains { $0.userId == data.currentUserId }
                Button(reviewed ? "Mark my review as unfinished" : "I’ve reviewed this week") {
                    Task { await mutate(.init(action: "markReviewed", weekStart: planner.weekStart, revision: data.review.revision, reviewed: !reviewed)) }
                }.disabled(!data.canEdit || notesAreDirty)
            }
            Section {
                Button("Manage repeating routines") { tab = .routines }
                Button("Save or apply a week template") { tab = .templates }
            }
        }
    }

    private func reviewSummary(_ title: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.bold())
            Text(text.isEmpty ? "No notes yet" : text).foregroundStyle(text.isEmpty ? .secondary : .primary)
        }
    }

    private func reviewNavigation(_ data: FamilyPlanningData) -> some View {
        HStack {
            Button("Back") { reviewStep -= 1 }.disabled(reviewStep == 0 || store.isSaving)
            Spacer()
            if reviewStep < 3 {
                Button(reviewStep == 2 && notesAreDirty ? "Save and continue" : "Continue") {
                    Task {
                        if reviewStep == 2 && notesAreDirty {
                            guard await saveNotes() else { return }
                        }
                        reviewStep += 1
                    }
                }.buttonStyle(.borderedProminent).disabled(store.isSaving || (notesAreDirty && !data.canEdit))
            } else {
                Text("A shared plan makes the week easier.").font(.caption).foregroundStyle(.secondary)
            }
        }.padding().background(.regularMaterial)
    }

    @ViewBuilder
    private func childrenSections(_ data: FamilyPlanningData) -> some View {
        Section {
            Text("Assign calendars to each adult. Shared calendars can belong to more than one person’s schedule.").font(.footnote).foregroundStyle(.secondary)
            ForEach(data.adults ?? []) { adult in
                HStack {
                    Button { selectedAdultId = adult.userId } label: {
                        VStack(alignment: .leading) {
                            Label(adult.displayName, systemImage: selectedAdultId == adult.userId ? "person.crop.circle.fill" : "person.crop.circle")
                            Text("\(adult.calendarPreferenceIds.count) assigned calendar\(adult.calendarPreferenceIds.count == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                        }
                    }.buttonStyle(.borderless).accessibilityIdentifier("adult-schedule-\(adult.userId)")
                    Spacer()
                    Button("Assign calendars") { sheet = .adult(adult) }.disabled(!data.canEdit)
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("adult-calendars-\(adult.userId)")
                }
            }
        } header: { Text("Adults") } footer: { Text("The Person filter uses these assignments. Calendar privacy stays the same. Adult accounts are managed in Settings.") }
        if let adult = data.adults?.first(where: { $0.userId == selectedAdultId }) {
            Section("\(adult.displayName)’s week") {
                let events = currentPlanner.days.flatMap(\.events).filter { adult.calendarPreferenceIds.contains($0.calendarPreferenceId ?? $0.calendarId) }
                if events.isEmpty { Text("No events from assigned calendars this week.").foregroundStyle(.secondary) }
                ForEach(currentPlanner.days) { day in
                    ForEach(day.events.filter { adult.calendarPreferenceIds.contains($0.calendarPreferenceId ?? $0.calendarId) }) { event in
                        Button { sheet = .event(event) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(WeekDate.shortDay(day.date)).font(.caption).foregroundStyle(.secondary)
                                Label(event.title, systemImage: "calendar").foregroundStyle(Color(hex: event.calendarColor))
                            }
                        }
                    }
                }
            }
        }
        Section {
            Text("Children have their own profile and schedule without an email address or login.").font(.footnote).foregroundStyle(.secondary)
            Button("Add child", systemImage: "person.crop.circle.badge.plus") { sheet = .child(nil) }.disabled(!data.canEdit)
            ForEach(data.children) { child in
                HStack {
                    Button { selectedChildId = child.id; selectedAdultId = nil } label: {
                        Label(child.name, systemImage: selectedChildId == child.id ? "person.crop.circle.fill" : "person.crop.circle")
                            .foregroundStyle(Color(hex: child.color))
                    }.buttonStyle(.plain)
                    Spacer()
                    Button("Edit") { sheet = .child(child) }.disabled(!data.canEdit)
                }
            }
        } header: { Text("Children") }
        if selectedAdultId == nil, let child = data.children.first(where: { $0.id == selectedChildId }) ?? data.children.first {
            Section("\(child.name)’s week") {
                Text("Includes plans and tasks tagged for \(child.name), plus events from the calendars selected in their profile.").font(.footnote).foregroundStyle(.secondary)
                let weekly = ChildSchedule.items(for: child, in: currentPlanner.weeklyItems)
                ForEach(weekly) { item in
                    Button { sheet = .item(item) } label: { Label(item.text, systemImage: item.isCompleted ? "checkmark.circle.fill" : "circle") }
                }
            }
            ForEach(currentPlanner.days) { day in
                let events = ChildSchedule.events(for: child, in: day)
                let items = ChildSchedule.items(for: child, in: day.items)
                if !events.isEmpty || !items.isEmpty {
                    Section(WeekDate.shortDay(day.date)) {
                        ForEach(events) { event in
                            Button { sheet = .event(event) } label: {
                                Label(event.title, systemImage: "calendar").foregroundStyle(.primary)
                            }
                        }
                        ForEach(items) { item in
                            Button { sheet = .item(item) } label: {
                                Label(item.text, systemImage: item.type == .note ? "note.text" : item.isCompleted ? "checkmark.circle.fill" : "circle").foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func routineSections(_ data: FamilyPlanningData) -> some View {
        Section {
            Text("Routines create shared Week of Us tasks on the days you choose. Complete each occurrence in the planner.").font(.footnote).foregroundStyle(.secondary)
            Button("New routine", systemImage: "plus") { sheet = .routine(nil) }.disabled(!data.canEdit)
        }
        ForEach(data.routines) { routine in
            Section {
                Button { sheet = .routine(routine) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(routine.text).font(.headline).foregroundStyle(.primary)
                        Text(routine.scheduleDescription).font(.subheadline).foregroundStyle(.secondary)
                        if let child = data.children.first(where: { $0.id == routine.childId }) { Text(child.name).font(.caption).foregroundStyle(Color(hex: child.color)) }
                        if !routine.active { Label("Paused", systemImage: "pause.circle").font(.caption).foregroundStyle(.secondary) }
                    }
                }.buttonStyle(.plain).disabled(!data.canEdit)
            }
        }
    }

    @ViewBuilder
    private func templateSections(_ data: FamilyPlanningData) -> some View {
        Section {
            TextField("Template name, e.g. School week", text: $templateName)
            Button("Save this week as a template") {
                Task {
                    if await mutate(.init(action: "saveTemplate", weekStart: planner.weekStart, id: templateRequestId, name: templateName.trimmingCharacters(in: .whitespacesAndNewlines))) {
                        templateName = ""; templateRequestId = UUID().uuidString
                    }
                }
            }.disabled(!data.canEdit || viewModel.pendingChangeCount > 0 || templateName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if viewModel.pendingChangeCount > 0 { Text("Sync your pending planner changes before saving this week as a template.").font(.footnote).foregroundStyle(.secondary) }
            Text("Saves one-off shared plans and tasks with their day and child. Routines already repeat; calendar events and Apple Reminders stay in their own calendars and lists.").font(.footnote).foregroundStyle(.secondary)
        } header: { Text("Reuse a week") }
        ForEach(data.templates) { template in
            Section {
                DisclosureGroup {
                    ForEach(Array(template.items.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.text)
                            Text(item.dayOffset.flatMap { TaskRoutine.weekdayNames.indices.contains($0) ? TaskRoutine.weekdayNames[$0] : nil } ?? "This week")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                } label: { Text("\(template.name) · \(template.items.count) item\(template.items.count == 1 ? "" : "s")").font(.headline) }
                Button(template.appliedToWeek ? "Already added to this week" : "Apply to this week") { applyingTemplate = template }
                    .disabled(!data.canEdit || template.appliedToWeek)
                Button("Delete template", role: .destructive) { deletingTemplate = template }.disabled(!data.canEdit)
            }
        }
    }

    @ViewBuilder
    private func editor(_ destination: FamilyPlanningSheet) -> some View {
        switch destination {
        case .adult(let adult): AdultCalendarEditor(adult: adult, planner: currentPlanner, store: store)
        case .child(let child): ChildProfileEditor(child: child, planner: currentPlanner, store: store)
        case .routine(let routine): TaskRoutineEditor(routine: routine, planner: currentPlanner, store: store, changed: { await viewModel.load(week: planner.weekStart, quietly: true) })
        case .item(let item): ItemEditorView(item: item, planningDate: item.planningDate, defaultType: item.type, data: currentPlanner, viewModel: viewModel, appleReminders: .shared)
        case .event(let event): EventDetailView(event: event, data: currentPlanner, viewModel: viewModel)
        }
    }

    private func reviewTasks(_ data: FamilyPlanningData) -> [PlanningItem] {
        let current = currentPlanner.weeklyItems + currentPlanner.days.flatMap(\.items)
        var seen = Set(current.map(\.id))
        return current + (data.openTasks ?? []).filter { seen.insert($0.id).inserted }
    }

    private func adoptReview() {
        guard let review = store.data?.review else { return }
        priorities = review.priorities; meals = review.meals; logistics = review.logistics; reviewBaseline = review
    }

    private func saveNotes() async -> Bool {
        guard let reviewBaseline else { return false }
        let result = await store.save(.init(action: "saveReview", weekStart: planner.weekStart, priorities: priorities, meals: meals, logistics: logistics, revision: reviewBaseline.revision))
        if result { adoptReview() }
        return result
    }

    @discardableResult
    private func mutate(_ mutation: FamilyPlanningMutation) async -> Bool {
        let saved = await store.save(mutation)
        if saved { await viewModel.load(week: planner.weekStart, quietly: true) }
        return saved
    }

    private func moveToNextWeek(_ item: PlanningItem) async {
        let nextWeek = item.weekStartDate < planner.weekStart ? planner.weekStart : WeekDate.addDays(7, to: planner.weekStart)
        _ = await viewModel.saveItem(.init(id: item.id, text: item.text, type: item.type, planningDate: nil, weekStartDate: nextWeek, remindAt: item.reminder?.remindAt, childId: item.childId))
        await store.load()
    }
}

extension View {
    @ViewBuilder
    func familyPlanningSheetSize() -> some View {
        #if targetEnvironment(macCatalyst)
        self.frame(width: 650, height: 740)
        #else
        self
        #endif
    }
}
