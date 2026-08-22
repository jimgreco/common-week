import SwiftUI

struct ItemEditorView: View {
    let item: PlanningItem?
    let planningDate: String?
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var isSaving = false

    init(item: PlanningItem?, planningDate: String?, defaultType: PlanningItemType, data: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.item = item
        self.planningDate = planningDate
        self.data = data
        self.viewModel = viewModel
        _text = State(initialValue: item?.text ?? "")
        _type = State(initialValue: item?.type ?? defaultType)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField(type == .note ? "What are you planning?" : "What needs doing?", text: $text, axis: .vertical)
                        .lineLimit(3...7)
                    Picker("Type", selection: $type) { Text("Plan or note").tag(PlanningItemType.note); Text("Task").tag(PlanningItemType.task) }
                }
                Section("Schedule") {
                    LabeledContent("When", value: planningDate.map(WeekDate.longDay) ?? "This week")
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
                        Task {
                            isSaving = true
                            let draft = PlanningItemDraft(id: item?.id, text: text.trimmingCharacters(in: .whitespacesAndNewlines), type: type, planningDate: item?.planningDate ?? planningDate, weekStartDate: data.weekStart)
                            if await viewModel.saveItem(draft) { dismiss() }
                            isSaving = false
                        }
                    }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
    }
}

struct LocationPickerView: View {
    let day: DayPlan
    let locations: [HouseholdLocation]
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var scope = "day"
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
                                    scope: scope,
                                    saveForReuse: saveForReuse
                                )
                            } else if let location = locations.first(where: { $0.id == selectedId }) {
                                succeeded = await viewModel.setLocation(location, for: day.date, scope: scope)
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
                    Text(event.canEdit == true ? (event.recurringEventId == nil ? "This event can be edited in Week of Us." : "Changes here apply only to this occurrence. Use Google Calendar to change the entire series.") : "This calendar is read-only here. You can still hide the event from the shared planner.")
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
            .confirmationDialog(event.recurringEventId == nil ? "Delete this event from Google Calendar?" : "Delete this occurrence from Google Calendar?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button(event.recurringEventId == nil ? "Delete event" : "Delete occurrence", role: .destructive) {
                    Task {
                        deleting = true
                        if await viewModel.deleteEvent(event) { dismiss() }
                        deleting = false
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
}

struct CalendarEventEditorView: View {
    let event: CalendarEvent?
    let date: String
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var location: String
    @State private var notes: String
    @State private var calendarId: String
    @State private var allDay: Bool
    @State private var start: Date
    @State private var end: Date
    @State private var isSaving = false
    @State private var confirmingDelete = false

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
            Form {
                Section("Event") {
                    TextField("Title", text: $title)
                    Picker("Calendar", selection: $calendarId) { ForEach(data.editableCalendars) { Text($0.name).tag($0.id) } }
                        .disabled(event != nil)
                    Toggle("All-day event", isOn: $allDay)
                }
                Section("When") {
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                }
                Section("Details") {
                    TextField("Location", text: $location)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...7)
                }
                if event?.recurringEventId != nil {
                    Section { Text("Changes apply only to this occurrence. Use Google Calendar to change the entire series.").font(.footnote).foregroundStyle(.secondary) }
                }
                if let event {
                    Section { Button(event.recurringEventId == nil ? "Delete from Google Calendar" : "Delete this occurrence", role: .destructive) { confirmingDelete = true } }
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
        .environment(\.timeZone, TimeZone(identifier: data.household.timezone) ?? .current)
        .confirmationDialog(event?.recurringEventId == nil ? "Delete this event from Google Calendar?" : "Delete this occurrence from Google Calendar?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            if let event {
                Button(event.recurringEventId == nil ? "Delete event" : "Delete occurrence", role: .destructive) {
                    Task { if await viewModel.deleteEvent(event) { dismiss() } }
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone from Week of Us.")
        }
    }

    private func save() async {
        isSaving = true
        let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(identifier: data.household.timezone) ?? .current; time.dateFormat = "HH:mm"
        let draft = CalendarEventDraft(requestId: UUID().uuidString, calendarPreferenceId: calendarId, providerEventId: event?.providerEventId, etag: event?.etag, title: title.trimmingCharacters(in: .whitespacesAndNewlines), description: notes, location: location, allDay: allDay, startDate: WeekDate.string(start, timeZoneIdentifier: data.household.timezone), endDate: WeekDate.string(end, timeZoneIdentifier: data.household.timezone), startTime: time.string(from: start), endTime: time.string(from: end))
        if await viewModel.saveEvent(draft, editing: event != nil) { dismiss() }
        isSaving = false
    }
}
