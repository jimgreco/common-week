import SwiftUI

struct ItemEditorView: View {
    let item: PlanningItem?
    let planningDate: String?
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var type: PlanningItemType
    @State private var categoryId: String?
    @State private var isSaving = false

    init(item: PlanningItem?, planningDate: String?, defaultType: PlanningItemType, data: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.item = item
        self.planningDate = planningDate
        self.data = data
        self.viewModel = viewModel
        _text = State(initialValue: item?.text ?? "")
        _type = State(initialValue: item?.type ?? defaultType)
        _categoryId = State(initialValue: item?.categoryId)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField(type == .note ? "What are you planning?" : "What needs doing?", text: $text, axis: .vertical)
                        .lineLimit(3...7)
                    Picker("Type", selection: $type) { Text("Plan or note").tag(PlanningItemType.note); Text("Task").tag(PlanningItemType.task) }
                }
                Section("Organize") {
                    Picker("Category", selection: $categoryId) {
                        Text("No category").tag(String?.none)
                        ForEach(data.categories) { Text($0.name).tag(Optional($0.id)) }
                    }
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
                            let draft = PlanningItemDraft(id: item?.id, text: text.trimmingCharacters(in: .whitespacesAndNewlines), type: type, planningDate: item?.planningDate ?? planningDate, weekStartDate: data.weekStart, categoryId: categoryId)
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
    @State private var isSaving = false

    init(day: DayPlan, locations: [HouseholdLocation], viewModel: PlannerViewModel) {
        self.day = day; self.locations = locations; self.viewModel = viewModel
        _selectedId = State(initialValue: day.location?.id ?? locations.first?.id ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Location") {
                    ForEach(locations) { location in
                        Button { selectedId = location.id } label: {
                            HStack {
                                Image(systemName: "location.fill").foregroundStyle(CWTheme.accent)
                                Text(location.name).foregroundStyle(CWTheme.ink)
                                Spacer()
                                if selectedId == location.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(CWTheme.accent) }
                            }
                        }
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
            .navigationTitle("Set location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Set") {
                        guard let location = locations.first(where: { $0.id == selectedId }) else { return }
                        Task { isSaving = true; if await viewModel.setLocation(location, for: day.date, scope: scope) { dismiss() }; isSaving = false }
                    }.disabled(selectedId.isEmpty || isSaving)
                }
            }
        }
    }
}

struct EventDetailView: View {
    let event: CalendarEvent
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false

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
                    Text(event.canEdit == true ? "This event can be edited in Common Week." : "This calendar is read-only here. You can still hide the event from the shared planner.")
                        .font(.footnote).foregroundStyle(.secondary).padding(14).background(CWTheme.mint.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
                    Button(role: .destructive) { Task { if await viewModel.hideEvent(event) { dismiss() } } } label: { Label("Hide from Common Week", systemImage: "eye.slash") }
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

    init(event: CalendarEvent?, date: String, data: WeeklyPlannerData, viewModel: PlannerViewModel) {
        self.event = event; self.date = date; self.data = data; self.viewModel = viewModel
        let defaultStart = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: WeekDate.parse(date)) ?? WeekDate.parse(date)
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
                if let event {
                    Section { Button("Delete from Google Calendar", role: .destructive) { Task { if await viewModel.deleteEvent(event) { dismiss() } } } }
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

    private func save() async {
        isSaving = true
        let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.dateFormat = "HH:mm"
        let draft = CalendarEventDraft(requestId: UUID().uuidString, calendarPreferenceId: calendarId, providerEventId: event?.providerEventId, etag: event?.etag, title: title.trimmingCharacters(in: .whitespacesAndNewlines), description: notes, location: location, allDay: allDay, startDate: WeekDate.string(start), endDate: WeekDate.string(end), startTime: time.string(from: start), endTime: time.string(from: end))
        if await viewModel.saveEvent(draft, editing: event != nil) { dismiss() }
        isSaving = false
    }
}
