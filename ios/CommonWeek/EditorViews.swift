import SwiftUI

enum PlanningItemPlacement: String, CaseIterable, Identifiable {
    case day
    case week

    var id: String { rawValue }

    func planningDate(from date: Date, timeZoneIdentifier: String) -> String? {
        switch self {
        case .day:
            WeekDate.string(date, timeZoneIdentifier: timeZoneIdentifier)
        case .week:
            nil
        }
    }
}

struct ItemEditorView: View {
    let item: PlanningItem?
    let planningDate: String?
    let data: WeeklyPlannerData
    let allowsAppleReminderDestination: Bool
    let allowsWeeklyPlacement: Bool
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var reminderEnabled: Bool
    @State private var reminderDate: Date
    @State private var scheduledDate: Date
    @State private var placement: PlanningItemPlacement
    @State private var destination: TaskCreationDestination
    @State private var appleDueTimeEnabled = false
    @State private var appleRecurrence = AppleReminderRecurrenceDraft()
    @State private var saveError: String?
    @State private var isSaving = false
    @State private var showingTaskMigration = false

    init(
        item: PlanningItem?,
        planningDate: String?,
        defaultType: PlanningItemType,
        data: WeeklyPlannerData,
        viewModel: PlannerViewModel,
        appleReminders: AppleRemindersStore,
        allowsAppleReminderDestination: Bool = true,
        allowsWeeklyPlacement: Bool = true
    ) {
        self.item = item
        self.planningDate = planningDate
        self.data = data
        self.viewModel = viewModel
        self.appleReminders = appleReminders
        self.allowsAppleReminderDestination = allowsAppleReminderDestination
        self.allowsWeeklyPlacement = allowsWeeklyPlacement
        _text = State(initialValue: item?.text ?? "")
        _type = State(initialValue: item?.type ?? defaultType)
        let existingReminder = item?.reminder.flatMap { WeekDate.iso8601.date(from: $0.remindAt) }
        _reminderEnabled = State(initialValue: existingReminder != nil)
        _reminderDate = State(initialValue: existingReminder ?? Date().addingTimeInterval(3600))
        _scheduledDate = State(initialValue: (item?.planningDate ?? planningDate).map {
            WeekDate.calendarDate($0, hour: 9, timeZoneIdentifier: data.household.timezone)
        } ?? Date())
        _placement = State(initialValue: (item?.planningDate ?? planningDate) == nil ? .week : .day)
        let canUseAppleDefault = allowsAppleReminderDestination && item == nil && planningDate != nil && defaultType == .task
            && appleReminders.writableSelectedLists.contains {
                appleReminders.defaultDestination == .appleReminders($0.id)
            }
        _destination = State(initialValue: canUseAppleDefault ? appleReminders.defaultDestination : .weekOfUs)
    }

    var body: some View {
        editorBody
            .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
            .onChange(of: type) { _, nextType in
                if nextType != .task { destination = .weekOfUs }
            }
            .onChange(of: placement) { _, nextPlacement in
                if nextPlacement == .week { destination = .weekOfUs }
            }
            .onChange(of: destination) { _, nextDestination in
                if case .appleReminders = nextDestination { placement = .day }
            }
            .sheet(isPresented: $showingTaskMigration) {
                if let item {
                    CustomTaskMigrationView(
                        item: item,
                        data: data,
                        store: appleReminders,
                        viewModel: viewModel,
                        onMoved: { dismiss() }
                    )
                }
            }
    }

    @ViewBuilder
    private var editorBody: some View {
        #if targetEnvironment(macCatalyst)
        MacModalLayout(
            eyebrow: item == nil ? "New \(type == .task ? "task" : "plan")" : "Week of Us item",
            title: item == nil ? "Add \(type.title.lowercased())" : "Edit item",
            subtitle: type == .task
                ? "Add a clear next step to your shared week."
                : "Capture an idea, intention, or note for the week.",
            systemImage: type == .task ? "checkmark.square" : "note.text",
            tint: CWTheme.accentStrong,
            cancelTitle: "Cancel",
            primaryTitle: isSaving ? "Saving…" : "Save",
            primaryDisabled: !canSave,
            cancel: { dismiss() },
            primaryAction: { Task { await save() } }
        ) {
            Form { editorSections }
                .macModalFormStyle()
        }
        #else
        NavigationStack {
            Form { editorSections }
            .navigationTitle(item == nil ? "Add \(type.title.lowercased())" : "Edit item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await save() }
                    }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
        #endif
    }

    @ViewBuilder
    private var editorSections: some View {
        Section {
            TextField(type == .note ? "What are you planning?" : "What needs doing?", text: $text, axis: .vertical)
                .lineLimit(2...6)
            if destination == .weekOfUs {
                Picker("Type", selection: $type) {
                    Text("Plan or note").tag(PlanningItemType.note)
                    Text("Task").tag(PlanningItemType.task)
                }
            }
        } header: {
            Label("What", systemImage: type == .task ? "checkmark.square" : "text.alignleft")
        }
        if canChooseDestination {
            Section {
                Picker("Destination", selection: $destination) {
                    Text("Week of Us").tag(TaskCreationDestination.weekOfUs)
                    ForEach(appleReminders.writableSelectedLists) { list in
                        Text("Reminders · \(list.title)").tag(TaskCreationDestination.appleReminders(list.id))
                    }
                }
                Text(destination == .weekOfUs
                     ? "This task is shared with your Week of Us household and appears on the web."
                     : PlatformCopy.appleReminderDeviceOnly)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } header: {
                Label("Save to", systemImage: "tray.and.arrow.down")
            }
        }
        Section {
            if canChooseWeeklyPlacement {
                Picker("When", selection: $placement) {
                    Text("Day").tag(PlanningItemPlacement.day)
                    Text("This week").tag(PlanningItemPlacement.week)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("planning-placement")
            }
            if isDailyItem {
                DatePicker(canChooseWeeklyPlacement ? "Date" : "When", selection: $scheduledDate, displayedComponents: [.date])
                    .accessibilityIdentifier("planning-date")
            } else {
                LabeledContent("When", value: "This week")
                if canChooseWeeklyPlacement {
                    Text("Weekly items are shared with your household and do not use a date.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if destination == .weekOfUs {
                Toggle("Remind me", isOn: $reminderEnabled)
                if reminderEnabled {
                    DatePicker("Reminder", selection: $reminderDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                }
            } else {
                Toggle("Include due time", isOn: $appleDueTimeEnabled)
                if appleDueTimeEnabled {
                    DatePicker("Due time", selection: $scheduledDate, displayedComponents: [.hourAndMinute])
                }
            }
        } header: {
            Label("Schedule", systemImage: "calendar.badge.clock")
        }
        if case .appleReminders = destination {
            AppleReminderRecurrenceEditor(
                draft: $appleRecurrence,
                dueDate: scheduledDate,
                timeZoneIdentifier: data.household.timezone
            )
        }
        if let saveError {
            Section {
                Label(saveError, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
        if let item {
            Section {
                if item.type == .task, !appleReminders.writableSelectedLists.isEmpty {
                    Button("Move to Apple Reminders…") { showingTaskMigration = true }
                }
                Button("Delete item", role: .destructive) {
                    Task { if await viewModel.deleteItem(item) { dismiss() } }
                }
            }
        }
    }

    private var canChooseDestination: Bool {
        allowsAppleReminderDestination && item == nil && isDailyItem && type == .task && !appleReminders.writableSelectedLists.isEmpty
    }

    private var canChooseWeeklyPlacement: Bool {
        allowsWeeklyPlacement && item == nil && planningDate != nil
    }

    private var isDailyItem: Bool {
        if let item { return item.planningDate != nil }
        return placement == .day
    }

    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSaving
    }

    private func save() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if case .appleReminders(let listId) = destination,
           item == nil,
           type == .task,
           isDailyItem {
            do {
                try await appleReminders.createReminder(
                    title: trimmed,
                    listId: listId,
                    dueDate: scheduledDate,
                    includesTime: appleDueTimeEnabled,
                    timeZoneIdentifier: data.household.timezone,
                    recurrence: appleRecurrence.recurrence(
                        starting: scheduledDate,
                        timeZoneIdentifier: data.household.timezone
                    )
                )
                dismiss()
            } catch {
                saveError = error.localizedDescription
            }
            return
        }
        let selectedPlanningDate = placement.planningDate(
            from: scheduledDate,
            timeZoneIdentifier: data.household.timezone
        )
        let draft = PlanningItemDraft(
            id: item?.id,
            text: trimmed,
            type: type,
            planningDate: selectedPlanningDate,
            weekStartDate: selectedPlanningDate.map(WeekDate.weekStart) ?? data.weekStart,
            remindAt: reminderEnabled ? WeekDate.iso8601.string(from: reminderDate) : nil
        )
        if await viewModel.saveItem(draft) { dismiss() }
    }
}

struct CustomTaskMigrationView: View {
    let item: PlanningItem
    let data: WeeklyPlannerData
    @ObservedObject var store: AppleRemindersStore
    @ObservedObject var viewModel: PlannerViewModel
    let onMoved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var listId: String
    @State private var dueDate: Date
    @State private var includesTime = false
    @State private var confirmingMove = false
    @State private var isMoving = false
    @State private var errorMessage: String?

    init(
        item: PlanningItem,
        data: WeeklyPlannerData,
        store: AppleRemindersStore,
        viewModel: PlannerViewModel,
        onMoved: @escaping () -> Void
    ) {
        self.item = item
        self.data = data
        self.store = store
        self.viewModel = viewModel
        self.onMoved = onMoved
        let preferredListId: String? = if case .appleReminders(let id) = store.defaultDestination,
                                          store.writableSelectedLists.contains(where: { $0.id == id }) {
            id
        } else {
            store.writableSelectedLists.first?.id
        }
        _listId = State(initialValue: preferredListId ?? "")
        let today = WeekDate.today(timeZoneIdentifier: data.household.timezone)
        let defaultDate = item.planningDate ?? max(today, item.weekStartDate)
        _dueDate = State(initialValue: WeekDate.calendarDate(
            defaultDate,
            hour: 9,
            timeZoneIdentifier: data.household.timezone
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    Text(item.text)
                    Text("The Apple Reminder stays on this device and in the selected Apple list. Its contents and identifier are never uploaded to Week of Us.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Destination") {
                    Picker("List", selection: $listId) {
                        ForEach(store.writableSelectedLists) { list in
                            Text(list.title).tag(list.id)
                        }
                    }
                    DatePicker("Due date", selection: $dueDate, displayedComponents: .date)
                    Toggle("Include due time", isOn: $includesTime)
                    if includesTime {
                        DatePicker("Due time", selection: $dueDate, displayedComponents: .hourAndMinute)
                    }
                }
                Section {
                    Label(
                        "After the Reminder is created, the shared Week of Us task will be deleted for the household.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .foregroundStyle(.orange)
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .cwModalFormStyle()
            .cwModalNavigationTitle("Move Task")
            .cwModalNavigationActions(
                primaryTitle: isMoving ? "Moving…" : "Move",
                primaryDisabled: listId.isEmpty || isMoving,
                cancel: { dismiss() },
                primaryAction: { confirmingMove = true }
            )
            .confirmationDialog(
                "Move this shared task?",
                isPresented: $confirmingMove,
                titleVisibility: .visible
            ) {
                Button("Create Reminder and Delete Shared Task", role: .destructive) {
                    Task { await move() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The new Reminder is device-local. Deleting the Week of Us task removes it from the shared household planner and cannot be undone.")
            }
        }
        .cwModalChrome(
            eyebrow: "Apple Reminders",
            title: "Move task",
            subtitle: "Create a private Apple Reminder, then remove the shared task.",
            systemImage: "arrow.right.square",
            tint: .orange,
            primaryTitle: isMoving ? "Moving…" : "Move Task",
            primaryDisabled: listId.isEmpty || isMoving,
            cancel: { dismiss() },
            primaryAction: { confirmingMove = true }
        )
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
    }

    private func move() async {
        guard !isMoving else { return }
        isMoving = true
        errorMessage = nil
        defer { isMoving = false }
        do {
            let result = try await store.migrateTask(
                item,
                listId: listId,
                dueDate: dueDate,
                includesTime: includesTime,
                timeZoneIdentifier: data.household.timezone,
                retireSource: { await viewModel.deleteItem(item) }
            )
            switch result {
            case .moved:
                onMoved()
                dismiss()
            case .reminderCreatedSourceRetained:
                errorMessage = "The Apple Reminder was created, but the shared task could not be deleted. The task was kept so no data was lost."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AppleReminderRecurrenceEditor: View {
    @Binding var draft: AppleReminderRecurrenceDraft
    let dueDate: Date
    let timeZoneIdentifier: String

    var body: some View {
        Section("Repeat") {
            Toggle("Repeat reminder", isOn: $draft.isEnabled)
            if draft.isEnabled {
                Picker("Frequency", selection: $draft.frequency) {
                    ForEach(AppleReminderRecurrenceFrequency.allCases) { frequency in
                        Text(frequency.title).tag(frequency)
                    }
                }
                Stepper(value: $draft.interval, in: 1...999) {
                    LabeledContent(
                        "Interval",
                        value: "Every \(draft.interval) \(intervalUnit)"
                    )
                }
                if draft.frequency == .weekly {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Days").font(.subheadline)
                        HStack(spacing: 7) {
                            ForEach(AppleReminderWeekday.allCases) { weekday in
                                Button {
                                    toggle(weekday)
                                } label: {
                                    Text(weekday.shortTitle)
                                        .font(.caption.weight(.semibold))
                                        .frame(width: 28, height: 28)
                                        .foregroundStyle(draft.weekdays.contains(weekday) ? Color.white : CWTheme.secondaryInk)
                                        .background(
                                            draft.weekdays.contains(weekday) ? CWTheme.brand : Color.secondary.opacity(0.12),
                                            in: Circle()
                                        )
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(weekday.accessibilityTitle)
                                .accessibilityValue(draft.weekdays.contains(weekday) ? "Selected" : "Not selected")
                            }
                        }
                    }
                }
                Picker("Ends", selection: $draft.endMode) {
                    ForEach(AppleReminderRecurrenceEndMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                switch draft.endMode {
                case .never:
                    EmptyView()
                case .onDate:
                    DatePicker(
                        "End date",
                        selection: $draft.endDate,
                        in: dueDate...,
                        displayedComponents: .date
                    )
                case .afterOccurrences:
                    Stepper(value: $draft.occurrenceCount, in: 1...999) {
                        LabeledContent("Occurrences", value: "\(draft.occurrenceCount)")
                    }
                }
            }
        }
        .onChange(of: draft.isEnabled) { _, enabled in
            if enabled { selectDueWeekdayIfNeeded() }
        }
        .onChange(of: draft.frequency) { _, frequency in
            if frequency == .weekly { selectDueWeekdayIfNeeded() }
        }
        .onChange(of: dueDate) { _, _ in
            if draft.isEnabled, draft.frequency == .weekly, draft.weekdays.isEmpty {
                selectDueWeekdayIfNeeded()
            }
            if draft.endDate < dueDate { draft.endDate = dueDate }
        }
    }

    private var intervalUnit: String {
        let unit = draft.frequency.intervalUnit
        return draft.interval == 1 ? unit : "\(unit)s"
    }

    private func toggle(_ weekday: AppleReminderWeekday) {
        if draft.weekdays.contains(weekday) {
            guard draft.weekdays.count > 1 else { return }
            draft.weekdays.remove(weekday)
        } else {
            draft.weekdays.insert(weekday)
        }
    }

    private func selectDueWeekdayIfNeeded() {
        guard draft.weekdays.isEmpty else { return }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        guard let weekday = AppleReminderWeekday(rawValue: calendar.component(.weekday, from: dueDate)) else { return }
        draft.weekdays = [weekday]
    }
}

struct AppleReminderEditorView: View {
    let task: AppleReminderTask
    let data: WeeklyPlannerData
    @ObservedObject var store: AppleRemindersStore
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var notes: String
    @State private var urlText: String
    @State private var priority: AppleReminderPriority
    @State private var listId: String
    @State private var dueDate: Date
    @State private var includesTime: Bool
    @State private var isSaving = false
    @State private var confirmingDelete = false
    @State private var errorMessage: String?

    init(task: AppleReminderTask, data: WeeklyPlannerData, store: AppleRemindersStore) {
        self.task = task
        self.data = data
        self.store = store
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
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Apple Reminder") {
                    TextField("What needs doing?", text: $title, axis: .vertical)
                        .lineLimit(3...7)
                        .disabled(!canEdit)
                    Picker("List", selection: $listId) {
                        ForEach(listChoices) { list in
                            Text(list.title).tag(list.id)
                        }
                    }
                    .disabled(!canEdit)
                    if task.isRecurring {
                        Label(canEdit
                              ? "Changes update the recurring reminder while keeping its repeat schedule."
                              : "This recurring reminder is on a read-only list.", systemImage: canEdit ? "repeat" : "lock.fill")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if !task.canModify {
                        Label("This Reminders list is read-only.", systemImage: "lock.fill")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Due") {
                    DatePicker("Date", selection: $dueDate, displayedComponents: [.date])
                        .disabled(!canEdit)
                    Toggle("Include due time", isOn: $includesTime)
                        .disabled(!canEdit)
                    if includesTime {
                        DatePicker("Time", selection: $dueDate, displayedComponents: [.hourAndMinute])
                            .disabled(!canEdit)
                    }
                }
                Section("Details") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...7)
                        .disabled(!canEdit)
                    Picker("Priority", selection: $priority) {
                        ForEach(AppleReminderPriority.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .disabled(!canEdit)
                    TextField("URL", text: $urlText)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .disabled(!canEdit)
                }
                if task.canDelete {
                    Section {
                        Button("Delete from Apple Reminders", role: .destructive) { confirmingDelete = true }
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Apple Reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(canEdit ? "Cancel" : "Done") { dismiss() } }
                if canEdit {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                    }
                }
            }
            .confirmationDialog(task.isRecurring ? "Delete this recurring reminder?" : "Delete this reminder from Apple Reminders?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button(task.isRecurring ? "Delete recurring series" : "Delete reminder", role: .destructive) { Task { await delete() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(task.isRecurring
                     ? "This deletes the entire recurring series from Apple Reminders, not just the reminder shown here. This cannot be undone."
                     : "This deletes it for everyone who shares the Apple Reminders list. This cannot be undone.")
            }
        }
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
    }

    private var canEdit: Bool { task.canEditDetails }

    private var listChoices: [AppleReminderList] {
        let writable = store.writableSelectedLists
        guard !writable.contains(where: { $0.id == task.listId }) else { return writable }
        let current = store.lists.first(where: { $0.id == task.listId })
            ?? AppleReminderList(id: task.listId, title: task.listTitle, sourceTitle: "", canModify: task.canModify)
        return [current] + writable
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let trimmedURL = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
            let reminderURL: URL?
            if trimmedURL.isEmpty {
                reminderURL = nil
            } else if let candidate = URL(string: trimmedURL), candidate.scheme != nil {
                reminderURL = candidate
            } else {
                errorMessage = "Enter a complete URL, including https://."
                return
            }
            try await store.update(
                task,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                notes: notes,
                url: reminderURL,
                priority: priority,
                listId: listId,
                dueDate: dueDate,
                includesTime: includesTime,
                timeZoneIdentifier: data.household.timezone
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await store.delete(task)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct LocationPickerView: View {
    let day: DayPlan
    let locations: [HouseholdLocation]
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var scope = "day"
    @State private var person = "everyone"
    @State private var selectedId: String
    @State private var searchText = ""
    @State private var searchResults: [GeocodingResult] = []
    @State private var selectedResult: GeocodingResult?
    @State private var saveForReuse = true
    @State private var isSearching = false
    @State private var searchError: String?
    @State private var isSaving = false
    @FocusState private var searchFocused: Bool

    init(day: DayPlan, locations: [HouseholdLocation], viewModel: PlannerViewModel) {
        self.day = day
        self.locations = locations
        self.viewModel = viewModel
        if let current = day.location, !current.isSaved {
            let result = GeocodingResult(
                id: current.id,
                name: current.name,
                admin1: nil,
                country: nil,
                latitude: current.latitude,
                longitude: current.longitude,
                timezone: current.timezone
            )
            _selectedId = State(initialValue: "")
            _searchText = State(initialValue: current.name)
            _selectedResult = State(initialValue: result)
            _saveForReuse = State(initialValue: false)
        } else {
            _selectedId = State(initialValue: day.location?.id ?? locations.first?.id ?? "")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Person", selection: $person) {
                        Text("Everyone").tag("everyone")
                        ForEach(day.memberLocations) { assignment in
                            Text(assignment.displayName).tag(assignment.memberId)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Label("Person", systemImage: "person.2")
                }
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("Search city or place", text: $searchText)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.search)
                            .focused($searchFocused)
                        if isSearching {
                            ProgressView().controlSize(.small)
                        } else if !searchText.isEmpty {
                            Button {
                                searchText = ""
                                searchResults = []
                                selectedResult = nil
                                searchError = nil
                                isSearching = false
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Clear location search")
                        }
                    }

                    if let selectedResult {
                        locationRow(
                            title: selectedResult.name,
                            detail: selectedResult.detailName,
                            selected: true
                        )
                    } else {
                        ForEach(searchResults) { result in
                            Button { choose(result) } label: {
                                locationRow(title: result.name, detail: result.detailName, selected: false)
                            }
                        }
                    }

                    if let searchError {
                        Label(searchError, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    } else if searchText.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2,
                              !isSearching,
                              selectedResult == nil,
                              searchResults.isEmpty {
                        Text("No matching places found.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Label("Location", systemImage: "location.magnifyingglass")
                }

                if selectedResult != nil {
                    Section {
                        Toggle(isOn: $saveForReuse) {
                            Label("Save for reuse", systemImage: "bookmark")
                        }
                    } footer: {
                        Text(saveForReuse
                            ? "This place will appear under Saved locations next time."
                            : "This place will only be assigned to the dates you choose below.")
                    }
                }

                if !locations.isEmpty {
                    Section {
                        ForEach(locations) { location in
                            Button { choose(location) } label: {
                                HStack {
                                    Image(systemName: "location.fill").foregroundStyle(CWTheme.accent)
                                    Text(location.name).foregroundStyle(CWTheme.ink)
                                    Spacer()
                                    if location.isDefault == true {
                                        Text("Default")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.secondary)
                                    }
                                    if selectedId == location.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(CWTheme.accent) }
                                }
                            }
                        }
                    } header: {
                        Label("Saved locations", systemImage: "bookmark")
                    }
                } else if selectedResult == nil {
                    Section {
                        ContentUnavailableView(
                            "No saved locations",
                            systemImage: "location.slash",
                            description: Text("Search above to set a place for this day.")
                        )
                    }
                }
                Section {
                    Picker("Range", selection: $scope) {
                        Text("This day").tag("day")
                        Text("Through Sunday").tag("through-sunday")
                        Text("Entire week").tag("week")
                    }.pickerStyle(.inline).labelsHidden()
                } header: {
                    Label("Apply to", systemImage: "calendar.badge.clock")
                }
            }
            .cwModalFormStyle()
            .task(id: searchText) { await search() }
            .onChange(of: searchText) { _, newValue in
                if let selectedResult, newValue != selectedResult.assignmentName {
                    self.selectedResult = nil
                }
            }
            .onChange(of: person) { _, newValue in
                let location = newValue == "everyone"
                    ? day.location
                    : day.memberLocations.first(where: { $0.memberId == newValue })?.location
                selectedId = location?.id ?? locations.first?.id ?? ""
                selectedResult = nil
                searchText = ""
            }
            .cwModalNavigationTitle("Set location")
            .cwModalNavigationActions(
                primaryTitle: isSaving ? "Saving…" : "Set",
                primaryDisabled: !canSetLocation,
                cancel: { dismiss() },
                primaryAction: { Task { await setLocation() } }
            )
        }
        .cwModalChrome(
            eyebrow: "Day context",
            title: "Set location",
            subtitle: "Choose who will be where and how long the change applies.",
            systemImage: "location.fill",
            primaryTitle: isSaving ? "Saving…" : "Set Location",
            primaryDisabled: !canSetLocation,
            cancel: { dismiss() },
            primaryAction: { Task { await setLocation() } }
        )
    }

    private var canSetLocation: Bool {
        (selectedResult != nil || !selectedId.isEmpty) && !isSaving
    }

    private func setLocation() async {
        guard canSetLocation else { return }
        isSaving = true
        let succeeded: Bool
        if let selectedResult {
            succeeded = await viewModel.setLocation(
                selectedResult,
                for: day.date,
                memberIds: selectedMemberIds,
                scope: scope,
                saveForReuse: saveForReuse
            )
        } else if let location = locations.first(where: { $0.id == selectedId }) {
            succeeded = await viewModel.setLocation(
                location,
                for: day.date,
                memberIds: selectedMemberIds,
                scope: scope
            )
        } else {
            succeeded = false
        }
        if succeeded { dismiss() }
        isSaving = false
    }

    private var selectedMemberIds: [String] {
        person == "everyone" ? day.memberLocations.map(\.memberId) : [person]
    }

    private func choose(_ result: GeocodingResult) {
        selectedResult = result
        selectedId = ""
        searchText = result.assignmentName
        searchResults = []
        searchError = nil
        isSearching = false
        searchFocused = false
    }

    private func choose(_ location: HouseholdLocation) {
        selectedId = location.id
        selectedResult = nil
        searchText = ""
        searchResults = []
        searchError = nil
        isSearching = false
    }

    @ViewBuilder
    private func locationRow(title: String, detail: String, selected: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "location.fill")
                .foregroundStyle(CWTheme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(CWTheme.ink)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if selected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(CWTheme.accent)
            }
        }
        .contentShape(Rectangle())
    }

    @MainActor
    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard selectedResult?.assignmentName != query else { return }
        guard query.count >= 2 else {
            searchResults = []
            searchError = nil
            isSearching = false
            return
        }

        do {
            try await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            isSearching = true
            searchError = nil
            let results = try await viewModel.findLocations(matching: query)
            guard !Task.isCancelled,
                  searchText.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            searchResults = results
            isSearching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            searchResults = []
            searchError = error.localizedDescription
            isSearching = false
        }
    }
}

struct EventDetailView: View {
    let event: CalendarEvent
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var responding = false
    @State private var reminderSelection = "none"
    @State private var reminderLoaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(alignment: .top, spacing: 14) {
                        Text(event.attribution).font(.caption.bold()).foregroundStyle(.white).frame(width: 38, height: 38).background(Color(hex: event.calendarColor), in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(event.title).font(CWTheme.display(31)).tracking(-0.8)
                            Text(event.calendarAlias).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    VStack(spacing: 15) {
                        detail("clock", event.allDay ? "All day" : "\(WeekDate.longDay(event.start)) · \(eventTimeRange(event))")
                        if let location = event.location, !location.isEmpty { detail("location", location) }
                        detail("calendar", event.calendarAlias)
                    }
                    if let description = event.description, !description.isEmpty {
                        Divider(); Eyebrow(text: "Notes"); Text(description).font(.body).foregroundStyle(CWTheme.secondaryInk)
                    }
                    guestContent
                    reminderContent
                    Text(event.canEdit == true ? (event.recurringEventId == nil ? "This event can be edited in Week of Us." : "You can update or delete this occurrence or its recurring series.") : "This event is read-only for your Google account. Enable Calendar editing and ask the calendar owner to grant your Google address permission to make changes. You can still hide it from the shared planner.")
                        .font(.footnote).foregroundStyle(.secondary).padding(14).background(CWTheme.mint.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                    if event.canEdit == true {
                        HStack {
                            Button { editing = true } label: { Label("Edit event", systemImage: "pencil") }
                                .buttonStyle(.borderedProminent)
                            Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
                                .buttonStyle(.bordered)
                                .disabled(deleting)
                        }
                    }
                    Button(role: .destructive) { Task { if await viewModel.hideEvent(event) { dismiss() } } } label: { Label("Hide from Week of Us", systemImage: "eye.slash") }
                        .buttonStyle(.bordered)
                }.padding(22)
            }
            .navigationTitle("Calendar event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                if event.canEdit == true { ToolbarItem(placement: .confirmationAction) { Button("Edit") { editing = true } } }
            }
            .sheet(isPresented: $editing) { CalendarEventEditorView(event: event, date: String(event.start.prefix(10)), data: data, viewModel: viewModel) }
            .task {
                reminderSelection = reminderValue
                reminderLoaded = true
            }
            .onChange(of: reminderSelection) { _, value in
                guard reminderLoaded else { return }
                Task { _ = await viewModel.setCalendarReminder(event, remindAt: reminderDate(for: value)) }
            }
            .confirmationDialog(event.recurringEventId == nil ? "Delete this event from Google Calendar?" : "Delete this recurring event?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button(event.recurringEventId == nil ? "Delete event" : "Delete occurrence", role: .destructive) {
                    Task {
                        deleting = true
                        if await viewModel.deleteEvent(event, scope: "occurrence") { dismiss() }
                        deleting = false
                    }
                }
                if event.recurringEventId != nil {
                    Button("Delete entire series", role: .destructive) {
                        Task {
                            deleting = true
                            if await viewModel.deleteEvent(event, scope: "series") { dismiss() }
                            deleting = false
                        }
                    }
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This cannot be undone from Week of Us.")
            }
        }
    }

    private func detail(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) { Image(systemName: icon).foregroundStyle(CWTheme.accent).frame(width: 22); Text(text).frame(maxWidth: .infinity, alignment: .leading) }
    }

    @ViewBuilder
    private var guestContent: some View {
        if let attendees = event.attendees, !attendees.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Guests")
                ForEach(attendees) { attendee in
                    attendeeRow(attendee)
                }
                if event.canRespond == true {
                    HStack {
                        responseButton("Going", status: "accepted", icon: "checkmark.circle")
                        responseButton("Maybe", status: "tentative", icon: "questionmark.circle")
                        responseButton("Can't go", status: "declined", icon: "xmark.circle")
                    }
                }
            }
        }
    }

    private func attendeeRow(_ attendee: CalendarAttendee) -> some View {
        HStack(spacing: 10) {
            Image(systemName: responseIcon(attendee.responseStatus))
                .foregroundStyle(responseColor(attendee.responseStatus))
            VStack(alignment: .leading, spacing: 2) {
                Text(attendee.displayName ?? attendee.email)
                Text(responseLabel(attendee.responseStatus)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if attendee.`self` == true { Text("You").font(.caption.bold()).foregroundStyle(CWTheme.accentStrong) }
        }
    }

    @ViewBuilder
    private var reminderContent: some View {
        if !event.allDay {
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow(text: "Reminder")
                Picker("Notify me", selection: $reminderSelection) {
                    Text("None").tag("none")
                    Text("At start time").tag("0")
                    Text("10 minutes before").tag("10")
                    Text("30 minutes before").tag("30")
                    Text("1 hour before").tag("60")
                    Text("1 day before").tag("1440")
                }
                .pickerStyle(.menu)
            }
        }
    }

    private func responseButton(_ title: String, status: String, icon: String) -> some View {
        Button {
            Task {
                responding = true
                _ = await viewModel.respondToEvent(event, responseStatus: status)
                responding = false
            }
        } label: {
            Label(title, systemImage: icon).font(.caption.bold())
        }
        .buttonStyle(.bordered)
        .disabled(responding)
    }

    private func responseLabel(_ status: String) -> String {
        switch status { case "accepted": "Going"; case "declined": "Declined"; case "tentative": "Maybe"; default: "Awaiting response" }
    }

    private func responseIcon(_ status: String) -> String {
        switch status { case "accepted": "checkmark.circle.fill"; case "declined": "xmark.circle.fill"; case "tentative": "questionmark.circle.fill"; default: "circle" }
    }

    private func responseColor(_ status: String) -> Color {
        switch status { case "accepted": CWTheme.accent; case "declined": .red; case "tentative": .orange; default: .secondary }
    }

    private var reminderValue: String {
        guard let reminder = event.reminder,
              let start = WeekDate.iso8601.date(from: event.start),
              let remindAt = WeekDate.iso8601.date(from: reminder.remindAt) else { return "none" }
        return String(max(0, Int((start.timeIntervalSince(remindAt) / 60).rounded())))
    }

    private func reminderDate(for value: String) -> String? {
        guard value != "none", let minutes = Int(value),
              let start = WeekDate.iso8601.date(from: event.start) else { return nil }
        return WeekDate.iso8601.string(from: start.addingTimeInterval(TimeInterval(-minutes * 60)))
    }
}

struct CalendarEventEditorView: View {
    let event: CalendarEvent?
    let date: String
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var location: String
    @State private var locationSuggestions: [EventLocationSuggestion] = []
    @State private var selectedLocationSuggestion: EventLocationSuggestion?
    @State private var locationSessionToken = UUID().uuidString
    @State private var locationSearchEnabled = false
    @State private var isSearchingLocation = false
    @State private var isResolvingLocation = false
    @State private var locationSearchError: String?
    @State private var notes: String
    @State private var calendarId: String
    @State private var allDay: Bool
    @State private var start: Date
    @State private var end: Date
    @State private var isSaving = false
    @State private var confirmingDelete = false
    @State private var recurringScope = "occurrence"
    @State private var recurrence: CalendarRecurrenceRule?
    @State private var guestEmailInput = ""
    @State private var authoringError: String?

    init(event: CalendarEvent?, date: String, data: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.event = event; self.date = date; self.data = data; self.viewModel = viewModel
        let defaultStart = WeekDate.calendarDate(date, hour: 9, timeZoneIdentifier: data.household.timezone)
        _title = State(initialValue: event?.title ?? "")
        _location = State(initialValue: event?.location ?? "")
        _notes = State(initialValue: event?.description ?? "")
        _calendarId = State(initialValue: event?.calendarPreferenceId ?? data.editableCalendars.first?.id ?? "")
        _allDay = State(initialValue: event?.allDay ?? false)
        _start = State(initialValue: event.map {
            WeekDate.calendarEventDate($0.start, timeZoneIdentifier: data.household.timezone)
        } ?? defaultStart)
        _end = State(initialValue: event.map {
            WeekDate.calendarEventDate($0.end, timeZoneIdentifier: data.household.timezone)
        } ?? defaultStart.addingTimeInterval(3600))
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                Section {
                    TextField("Title", text: $title)
                    Picker("Calendar", selection: $calendarId) { ForEach(calendarChoices) { Text($0.name).tag($0.id) } }
                        .disabled(event != nil && !canMoveCalendar)
                    if event != nil && canMoveCalendar && calendarChoices.count > 1 {
                        Text("Moving an event changes its organizer calendar in Google Calendar.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Toggle("All-day event", isOn: $allDay)
                } header: {
                    Label("Event", systemImage: "calendar")
                }
                Section {
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                } header: {
                    Label("When", systemImage: "clock")
                }
                if event == nil {
                    Section {
                        Picker("Repeats", selection: recurrenceFrequency) {
                            Text("Does not repeat").tag("")
                            ForEach(CalendarRecurrenceFrequency.allCases) { frequency in
                                Text(frequency.title).tag(frequency.rawValue)
                            }
                        }
                        if let recurrence {
                            Stepper(
                                "Every \(recurrence.interval) \(recurrence.frequency.unit(interval: recurrence.interval))",
                                value: recurrenceInterval,
                                in: 1...99
                            )
                            if recurrence.frequency == .weekly {
                                VStack(alignment: .leading, spacing: 9) {
                                    Text("Repeat on").font(.subheadline)
                                    HStack(spacing: 7) {
                                        ForEach(CalendarRecurrenceWeekday.allCases) { weekday in
                                            let selected = recurrence.weekdays?.contains(weekday) == true
                                            Button {
                                                toggleRecurrenceWeekday(weekday)
                                            } label: {
                                                Text(weekday.shortTitle)
                                                    .font(.caption.bold())
                                                    .foregroundStyle(selected ? Color.white : CWTheme.secondaryInk)
                                                    .frame(width: 30, height: 30)
                                                    .background(selected ? CWTheme.accent : Color.secondary.opacity(0.12), in: Circle())
                                            }
                                            .buttonStyle(.plain)
                                            .disabled(selected && recurrence.weekdays?.count == 1)
                                            .accessibilityLabel(weekday.accessibilityTitle)
                                            .accessibilityAddTraits(selected ? .isSelected : [])
                                        }
                                    }
                                }
                            }
                            Picker("Repeat ends", selection: recurrenceEnd) {
                                ForEach(CalendarRecurrenceEnd.allCases) { end in
                                    Text(end.title).tag(end.rawValue)
                                }
                            }
                            if recurrence.ends == .onDate {
                                DatePicker("Last date", selection: recurrenceUntilDate, in: recurrenceStartDay..., displayedComponents: .date)
                            } else if recurrence.ends == .afterCount {
                                Stepper("\(recurrence.count ?? 10) events", value: recurrenceCount, in: 1...999)
                            }
                        }
                    } header: {
                        Label("Repeats", systemImage: "repeat")
                    }
                    Section {
                        TextField("alex@example.com, sam@example.com", text: $guestEmailInput, axis: .vertical)
                            .lineLimit(1...4)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityLabel("Guest email addresses")
                        Text("Separate email addresses with commas. Google Calendar will email invitations.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } header: {
                        Label("Guests", systemImage: "person.2")
                    }
                }
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "mappin.and.ellipse")
                            .foregroundStyle(.secondary)
                        TextField("Search address or place", text: $location)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .accessibilityIdentifier("event-location-search")
                        if isSearchingLocation || isResolvingLocation {
                            ProgressView().controlSize(.small)
                        } else if !location.isEmpty {
                            Button {
                                location = ""
                                locationSuggestions = []
                                selectedLocationSuggestion = nil
                                locationSearchError = nil
                                locationSessionToken = UUID().uuidString
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Clear event location")
                        }
                    }

                    ForEach(locationSuggestions) { suggestion in
                        Button {
                            chooseEventLocation(suggestion)
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundStyle(CWTheme.accent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(suggestion.primaryText)
                                        .foregroundStyle(CWTheme.ink)
                                    if !suggestion.secondaryText.isEmpty {
                                        Text(suggestion.secondaryText)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("event-location-suggestion-\(suggestion.placeId)")
                    }
                    if !locationSuggestions.isEmpty {
                        HStack {
                            Spacer()
                            Text("Google Maps")
                                .font(.system(size: 12, weight: .regular))
                                .foregroundStyle(.secondary)
                                .accessibilityLabel("Google Maps")
                                .accessibilityIdentifier("event-location-attribution")
                        }
                        .id("event-location-results")
                    }
                    if let locationSearchError {
                        Text(locationSearchError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...7)
                } header: {
                    Label("Details", systemImage: "text.alignleft")
                }
                if event?.recurringEventId != nil {
                    Section {
                        Picker("Apply changes to", selection: $recurringScope) {
                            Text("This occurrence").tag("occurrence")
                            Text("Entire series").tag("series")
                        }
                        .pickerStyle(.segmented)
                        Text(recurringScope == "series" ? "Event details and times will be updated for the full series while its recurrence schedule stays intact." : "Only this occurrence will change.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if recurringScope == "occurrence" {
                            Text("Choose Entire series to move this event to another calendar.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } header: {
                        Label("Recurring event", systemImage: "repeat")
                    }
                }
                if let authoringError {
                    Section {
                        Label(authoringError, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                if let event {
                    Section { Button(event.recurringEventId == nil ? "Delete from Google Calendar" : "Delete this occurrence", role: .destructive) { confirmingDelete = true } }
                }
            }
                .cwModalFormStyle()
                .task(id: location) { await searchEventLocations() }
                .onChange(of: locationSuggestions) { _, suggestions in
                    guard !suggestions.isEmpty else { return }
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("event-location-results", anchor: .bottom)
                    }
                }
                .onChange(of: location) { _, newValue in
                    if let selectedLocationSuggestion, newValue == selectedLocationSuggestion.fullText { return }
                    self.selectedLocationSuggestion = nil
                    locationSearchEnabled = true
                    locationSearchError = nil
                }
                .onChange(of: recurringScope) { _, scope in
                    if scope == "occurrence", let sourceCalendarId = event?.calendarPreferenceId {
                        calendarId = sourceCalendarId
                    }
                }
                .onChange(of: start) { oldStart, newStart in
                    updateRecurrenceForStartChange(from: oldStart, to: newStart)
                    if end < newStart { end = newStart }
                }
                .cwModalNavigationTitle(event == nil ? "Add event" : "Edit event")
                .cwModalNavigationActions(
                    primaryTitle: isSaving ? "Saving…" : "Save",
                    primaryDisabled: !canSave,
                    cancel: { dismiss() },
                    primaryAction: { Task { await save() } }
                )
            }
        }
        .cwModalChrome(
            eyebrow: event == nil ? "New calendar event" : "Calendar event",
            title: event == nil ? "Add event" : "Edit event",
            subtitle: event == nil
                ? "Block out time and keep everyone in sync."
                : "Update the event details shared through Google Calendar.",
            systemImage: "calendar",
            tint: selectedCalendarColor,
            primaryTitle: isSaving ? "Saving…" : "Save",
            primaryDisabled: !canSave,
            cancel: { dismiss() },
            primaryAction: { Task { await save() } }
        )
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .confirmationDialog(event?.recurringEventId == nil ? "Delete this event from Google Calendar?" : "Delete this occurrence from Google Calendar?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            if let event {
                Button(event.recurringEventId == nil ? "Delete event" : "Delete occurrence", role: .destructive) {
                    Task { if await viewModel.deleteEvent(event, scope: "occurrence") { dismiss() } }
                }
                if event.recurringEventId != nil {
                    Button("Delete entire series", role: .destructive) {
                        Task { if await viewModel.deleteEvent(event, scope: "series") { dismiss() } }
                    }
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone from Week of Us.")
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !calendarId.isEmpty
            && end >= start
            && !isSaving
    }

    private var selectedCalendarColor: Color {
        calendarChoices.first(where: { $0.id == calendarId }).map { Color(hex: $0.color) } ?? CWTheme.accentStrong
    }

    private func chooseEventLocation(_ suggestion: EventLocationSuggestion) {
        selectedLocationSuggestion = suggestion
        location = suggestion.fullText
        locationSuggestions = []
        locationSearchError = nil
        isSearchingLocation = false
        let token = locationSessionToken
        isResolvingLocation = true
        Task {
            do {
                let resolved = try await viewModel.resolveEventLocation(suggestion, sessionToken: token)
                selectedLocationSuggestion = suggestion
                location = resolved.location
            } catch {
                locationSearchError = "The selected location could not be confirmed. You can still save it as entered."
            }
            locationSessionToken = UUID().uuidString
            isResolvingLocation = false
        }
    }

    @MainActor
    private func searchEventLocations() async {
        guard locationSearchEnabled else { return }
        let query = location.trimmingCharacters(in: .whitespacesAndNewlines)
        guard selectedLocationSuggestion?.fullText != query else { return }
        guard query.count >= 2 else {
            locationSuggestions = []
            locationSearchError = nil
            isSearchingLocation = false
            return
        }

        do {
            try await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            isSearchingLocation = true
            locationSearchError = nil
            let bias = data.locations.first(where: { $0.isDefault == true }) ?? data.locations.first
            let suggestions = try await viewModel.findEventLocations(
                matching: query,
                sessionToken: locationSessionToken,
                bias: bias
            )
            guard !Task.isCancelled,
                  location.trimmingCharacters(in: .whitespacesAndNewlines) == query else { return }
            locationSuggestions = suggestions
            isSearchingLocation = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            locationSuggestions = []
            locationSearchError = "Location suggestions are temporarily unavailable. You can enter a location manually."
            isSearchingLocation = false
        }
    }

    private func save() async {
        authoringError = nil
        let guestEmails: [String]?
        do {
            guestEmails = event == nil ? try CalendarGuestEmails.normalize(guestEmailInput) : nil
        } catch {
            authoringError = error.localizedDescription
            return
        }
        isSaving = true
        let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(identifier: data.household.timezone) ?? .current; time.dateFormat = "HH:mm"
        let draft = CalendarEventDraft(requestId: UUID().uuidString, calendarPreferenceId: calendarId, sourceCalendarPreferenceId: event?.calendarPreferenceId, providerEventId: event?.providerEventId, etag: event?.etag, title: title.trimmingCharacters(in: .whitespacesAndNewlines), description: notes, location: location, allDay: allDay, startDate: WeekDate.string(start, timeZoneIdentifier: data.household.timezone), endDate: WeekDate.string(end, timeZoneIdentifier: data.household.timezone), startTime: time.string(from: start), endTime: time.string(from: end), recurringEventId: event?.recurringEventId, recurringScope: event?.recurringEventId == nil ? nil : recurringScope, recurrence: event == nil ? recurrence : nil, guestEmails: guestEmails)
        if await viewModel.saveEvent(draft, editing: event != nil) { dismiss() }
        isSaving = false
    }

    private var recurrenceFrequency: Binding<String> {
        Binding(
            get: { recurrence?.frequency.rawValue ?? "" },
            set: { value in
                guard let frequency = CalendarRecurrenceFrequency(rawValue: value) else {
                    recurrence = nil
                    return
                }
                recurrence = CalendarRecurrenceRule(
                    frequency: frequency,
                    interval: 1,
                    weekdays: frequency == .weekly
                        ? [CalendarRecurrenceWeekday.weekday(for: start, timeZoneIdentifier: data.household.timezone)]
                        : nil,
                    ends: .never,
                    untilDate: nil,
                    count: nil
                )
            }
        )
    }

    private var recurrenceInterval: Binding<Int> {
        Binding(
            get: { recurrence?.interval ?? 1 },
            set: { value in
                guard var rule = recurrence else { return }
                rule.interval = value
                recurrence = rule
            }
        )
    }

    private var recurrenceEnd: Binding<String> {
        Binding(
            get: { recurrence?.ends.rawValue ?? CalendarRecurrenceEnd.never.rawValue },
            set: { value in
                guard var rule = recurrence, let end = CalendarRecurrenceEnd(rawValue: value) else { return }
                rule.ends = end
                rule.untilDate = end == .onDate
                    ? rule.untilDate ?? WeekDate.string(start, timeZoneIdentifier: data.household.timezone)
                    : nil
                rule.count = end == .afterCount ? rule.count ?? 10 : nil
                recurrence = rule
            }
        )
    }

    private var recurrenceUntilDate: Binding<Date> {
        Binding(
            get: {
                WeekDate.calendarDate(
                    recurrence?.untilDate ?? WeekDate.string(start, timeZoneIdentifier: data.household.timezone),
                    hour: 12,
                    timeZoneIdentifier: data.household.timezone
                )
            },
            set: { value in
                guard var rule = recurrence else { return }
                rule.untilDate = WeekDate.string(value, timeZoneIdentifier: data.household.timezone)
                recurrence = rule
            }
        )
    }

    private var recurrenceStartDay: Date {
        WeekDate.calendarDate(
            WeekDate.string(start, timeZoneIdentifier: data.household.timezone),
            timeZoneIdentifier: data.household.timezone
        )
    }

    private var recurrenceCount: Binding<Int> {
        Binding(
            get: { recurrence?.count ?? 10 },
            set: { value in
                guard var rule = recurrence else { return }
                rule.count = value
                recurrence = rule
            }
        )
    }

    private func toggleRecurrenceWeekday(_ weekday: CalendarRecurrenceWeekday) {
        guard var rule = recurrence else { return }
        var selected = Set(rule.weekdays ?? [])
        if selected.contains(weekday) {
            guard selected.count > 1 else { return }
            selected.remove(weekday)
        } else {
            selected.insert(weekday)
        }
        rule.weekdays = CalendarRecurrenceWeekday.allCases.filter(selected.contains)
        recurrence = rule
    }

    private func updateRecurrenceForStartChange(from oldStart: Date, to newStart: Date) {
        guard var rule = recurrence else { return }
        let oldDate = WeekDate.string(oldStart, timeZoneIdentifier: data.household.timezone)
        let newDate = WeekDate.string(newStart, timeZoneIdentifier: data.household.timezone)
        guard oldDate != newDate else { return }

        let oldWeekday = CalendarRecurrenceWeekday.weekday(for: oldStart, timeZoneIdentifier: data.household.timezone)
        if rule.frequency == .weekly, rule.weekdays == [oldWeekday] {
            rule.weekdays = [CalendarRecurrenceWeekday.weekday(for: newStart, timeZoneIdentifier: data.household.timezone)]
        }
        if rule.ends == .onDate, let untilDate = rule.untilDate, untilDate < newDate {
            rule.untilDate = newDate
        }
        recurrence = rule
    }

    private var calendarChoices: [EditableCalendar] {
        data.editableCalendars
    }

    private var canMoveCalendar: Bool {
        event?.recurringEventId == nil || recurringScope == "series"
    }
}
