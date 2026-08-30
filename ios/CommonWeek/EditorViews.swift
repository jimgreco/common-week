import SwiftUI

struct ItemEditorView: View {
    let item: PlanningItem?
    let planningDate: String?
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var appleReminders: AppleRemindersStore
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var reminderEnabled: Bool
    @State private var reminderDate: Date
    @State private var destination: TaskCreationDestination
    @State private var appleDueDate: Date
    @State private var appleDueTimeEnabled = false
    @State private var saveError: String?
    @State private var isSaving = false

    init(item: PlanningItem?, planningDate: String?, defaultType: PlanningItemType, data: WeeklyPlannerData, viewModel: PlannerViewModel, appleReminders: AppleRemindersStore) {
        self.item = item
        self.planningDate = planningDate
        self.data = data
        self.viewModel = viewModel
        self.appleReminders = appleReminders
        _text = State(initialValue: item?.text ?? "")
        _type = State(initialValue: item?.type ?? defaultType)
        let existingReminder = item?.reminder.flatMap { WeekDate.iso8601.date(from: $0.remindAt) }
        _reminderEnabled = State(initialValue: existingReminder != nil)
        _reminderDate = State(initialValue: existingReminder ?? Date().addingTimeInterval(3600))
        let canUseAppleDefault = item == nil && planningDate != nil && defaultType == .task
            && appleReminders.writableSelectedLists.contains {
                appleReminders.defaultDestination == .appleReminders($0.id)
            }
        _destination = State(initialValue: canUseAppleDefault ? appleReminders.defaultDestination : .weekOfUs)
        _appleDueDate = State(initialValue: planningDate.map {
            WeekDate.calendarDate($0, hour: 9, timeZoneIdentifier: data.household.timezone)
        } ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField(type == .note ? "What are you planning?" : "What needs doing?", text: $text, axis: .vertical)
                        .lineLimit(3...7)
                    if destination == .weekOfUs {
                        Picker("Type", selection: $type) { Text("Plan or note").tag(PlanningItemType.note); Text("Task").tag(PlanningItemType.task) }
                    }
                }
                if canChooseDestination {
                    Section("Save to") {
                        Picker("Destination", selection: $destination) {
                            Text("Week of Us").tag(TaskCreationDestination.weekOfUs)
                            ForEach(appleReminders.writableSelectedLists) { list in
                                Text("Reminders · \(list.title)").tag(TaskCreationDestination.appleReminders(list.id))
                            }
                        }
                        Text(destination == .weekOfUs
                             ? "This task is shared with your Week of Us household and appears on the web."
                             : "This task is saved in Apple Reminders and appears only in the iPhone app.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Schedule") {
                    LabeledContent("When", value: planningDate.map(WeekDate.longDay) ?? "This week")
                    if destination == .weekOfUs {
                        Toggle("Remind me", isOn: $reminderEnabled)
                        if reminderEnabled {
                            DatePicker("Reminder", selection: $reminderDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        }
                    } else {
                        Toggle("Include due time", isOn: $appleDueTimeEnabled)
                        if appleDueTimeEnabled {
                            DatePicker("Due time", selection: $appleDueDate, displayedComponents: [.hourAndMinute])
                        }
                    }
                }
                if let saveError {
                    Section { Text(saveError).font(.footnote).foregroundStyle(.red) }
                }
                if let item {
                    Section { Button("Delete item", role: .destructive) { Task { if await viewModel.deleteItem(item) { dismiss() } } } }
                }
            }
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
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .onChange(of: type) { _, nextType in
            if nextType != .task { destination = .weekOfUs }
        }
    }

    private var canChooseDestination: Bool {
        item == nil && planningDate != nil && type == .task && !appleReminders.writableSelectedLists.isEmpty
    }

    private func save() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if case .appleReminders(let listId) = destination,
           item == nil,
           type == .task,
           planningDate != nil {
            do {
                try await appleReminders.createReminder(
                    title: trimmed,
                    listId: listId,
                    dueDate: appleDueDate,
                    includesTime: appleDueTimeEnabled,
                    timeZoneIdentifier: data.household.timezone
                )
                dismiss()
            } catch {
                saveError = error.localizedDescription
            }
            return
        }
        let draft = PlanningItemDraft(
            id: item?.id,
            text: trimmed,
            type: type,
            planningDate: item?.planningDate ?? planningDate,
            weekStartDate: data.weekStart,
            remindAt: reminderEnabled ? WeekDate.iso8601.string(from: reminderDate) : nil
        )
        if await viewModel.saveItem(draft) { dismiss() }
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
                Section("Person") {
                    Picker("Person", selection: $person) {
                        Text("Everyone").tag("everyone")
                        ForEach(day.memberLocations) { assignment in
                            Text(assignment.displayName).tag(assignment.memberId)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("Location") {
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
                    Section("Saved locations") {
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
                Section("Apply to") {
                    Picker("Range", selection: $scope) {
                        Text("This day").tag("day")
                        Text("Through Sunday").tag("through-sunday")
                        Text("Entire week").tag("week")
                    }.pickerStyle(.inline).labelsHidden()
                }
            }
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
            .navigationTitle("Set location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Set") {
                        Task {
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
                                succeeded = await viewModel.setLocation(location, for: day.date, memberIds: selectedMemberIds, scope: scope)
                            } else {
                                succeeded = false
                            }
                            if succeeded { dismiss() }
                            isSaving = false
                        }
                    }.disabled((selectedResult == nil && selectedId.isEmpty) || isSaving)
                }
            }
        }
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

    init(event: CalendarEvent?, date: String, data: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.event = event; self.date = date; self.data = data; self.viewModel = viewModel
        let defaultStart = WeekDate.calendarDate(date, hour: 9, timeZoneIdentifier: data.household.timezone)
        _title = State(initialValue: event?.title ?? "")
        _location = State(initialValue: event?.location ?? "")
        _notes = State(initialValue: event?.description ?? "")
        _calendarId = State(initialValue: event?.calendarPreferenceId ?? data.editableCalendars.first?.id ?? "")
        _allDay = State(initialValue: event?.allDay ?? false)
        _start = State(initialValue: event.flatMap { WeekDate.iso8601.date(from: $0.start) } ?? defaultStart)
        _end = State(initialValue: event.flatMap { WeekDate.iso8601.date(from: $0.end) } ?? defaultStart.addingTimeInterval(3600))
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                Form {
                Section("Event") {
                    TextField("Title", text: $title)
                    Picker("Calendar", selection: $calendarId) { ForEach(calendarChoices) { Text($0.name).tag($0.id) } }
                        .disabled(event != nil && !canMoveCalendar)
                    if event != nil && canMoveCalendar && calendarChoices.count > 1 {
                        Text("Moving an event changes its organizer calendar in Google Calendar.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Toggle("All-day event", isOn: $allDay)
                }
                Section("When") {
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                }
                Section("Details") {
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
                }
                if event?.recurringEventId != nil {
                    Section("Recurring event") {
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
                    }
                }
                if let event {
                    Section { Button(event.recurringEventId == nil ? "Delete from Google Calendar" : "Delete this occurrence", role: .destructive) { confirmingDelete = true } }
                }
            }
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
                .navigationTitle(event == nil ? "Add event" : "Edit event")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                            .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || calendarId.isEmpty || end < start || isSaving)
                    }
                }
            }
        }
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
        isSaving = true
        let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(identifier: data.household.timezone) ?? .current; time.dateFormat = "HH:mm"
        let draft = CalendarEventDraft(requestId: UUID().uuidString, calendarPreferenceId: calendarId, sourceCalendarPreferenceId: event?.calendarPreferenceId, providerEventId: event?.providerEventId, etag: event?.etag, title: title.trimmingCharacters(in: .whitespacesAndNewlines), description: notes, location: location, allDay: allDay, startDate: WeekDate.string(start, timeZoneIdentifier: data.household.timezone), endDate: WeekDate.string(end, timeZoneIdentifier: data.household.timezone), startTime: time.string(from: start), endTime: time.string(from: end), recurringEventId: event?.recurringEventId, recurringScope: event?.recurringEventId == nil ? nil : recurringScope)
        if await viewModel.saveEvent(draft, editing: event != nil) { dismiss() }
        isSaving = false
    }

    private var calendarChoices: [EditableCalendar] {
        data.editableCalendars
    }

    private var canMoveCalendar: Bool {
        event?.recurringEventId == nil || recurringScope == "series"
    }
}
