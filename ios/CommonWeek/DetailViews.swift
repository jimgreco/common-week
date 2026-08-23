import SwiftUI

struct WeatherDetailView: View {
    let day: DayPlan
    let unit: TemperatureUnit
    @Environment(\.dismiss) private var dismiss

    private var weather: DailyWeather? { day.weather }

    var body: some View {
        NavigationStack {
            ScrollView {
                if let weather {
                    VStack(spacing: 18) {
                        CardSurface {
                            VStack(spacing: 18) {
                                Image(systemName: weatherIcon(weather.conditionCode))
                                    .symbolRenderingMode(.multicolor).font(.system(size: 54))
                                Text("\(temperature(weather.highF))° / \(temperature(weather.lowF))°")
                                    .font(CWTheme.display(38)).tracking(-1)
                                Text(day.location?.name ?? "Weather").font(.headline).foregroundStyle(.secondary)
                                HStack {
                                    metric("umbrella.fill", "\(weather.precipitationProbability)%", "Rain")
                                    Divider().frame(height: 48)
                                    metric("wind", "\(Int(weather.windSpeedMph.rounded())) mph", "Wind")
                                    Divider().frame(height: 48)
                                    metric("drop.fill", String(format: "%.2f in", weather.precipitationAmount), "Amount")
                                }
                            }.padding(22)
                        }
                        if !weather.hourly.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Eyebrow(text: "Hourly")
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 10) {
                                        ForEach(weather.hourly) { hour in
                                            VStack(spacing: 8) {
                                                Text(WeekDate.eventTime(hour.time)).font(.caption2).foregroundStyle(.secondary)
                                                Image(systemName: weatherIcon(hour.conditionCode)).symbolRenderingMode(.multicolor)
                                                Text("\(temperature(hour.temperatureF))°").font(.headline)
                                                Text("\(hour.precipitationProbability)%").font(.caption2).foregroundStyle(.blue)
                                            }.frame(width: 68).padding(.vertical, 12).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                                        }
                                    }
                                }
                            }
                        }
                    }.padding(16)
                } else {
                    ContentUnavailableView("Forecast unavailable", systemImage: "cloud.slash")
                }
            }
            .background(AppBackground())
            .navigationTitle(WeekDate.longDay(day.date))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func metric(_ icon: String, _ value: String, _ label: String) -> some View {
        VStack(spacing: 4) { Image(systemName: icon).foregroundStyle(CWTheme.accent); Text(value).font(.subheadline.bold()); Text(label).font(.caption2).foregroundStyle(.secondary) }.frame(maxWidth: .infinity)
    }

    private func temperature(_ fahrenheit: Double) -> Int {
        unit == .fahrenheit ? Int(fahrenheit.rounded()) : Int(((fahrenheit - 32) * 5 / 9).rounded())
    }
}

struct PlannerSearchView: View {
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if query.count < 2 {
                    ContentUnavailableView("Search your plans", systemImage: "magnifyingglass", description: Text("Find plans, notes, and tasks from any week."))
                } else if viewModel.isSearching {
                    ProgressView("Searching…")
                } else if viewModel.searchResults.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(viewModel.searchResults) { item in
                        HStack(spacing: 12) {
                            Image(systemName: item.type == .task ? (item.isCompleted ? "checkmark.square.fill" : "square") : "circle.fill")
                                .foregroundStyle(item.type == .task ? CWTheme.accent : Color(hex: "#7B8983"))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.text).font(.body)
                                Text(item.planningDate.map(WeekDate.longDay) ?? "Week of \(item.weekStartDate)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }.listStyle(.plain)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search plans and tasks")
            .onChange(of: query) { _, newValue in
                searchTask?.cancel()
                searchTask = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    await viewModel.search(newValue)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct SettingsView: View {
    let data: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @ObservedObject var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var timezone: String
    @State private var temperature: TemperatureUnit
    @State private var isSaving = false
    @State private var calendarSettings: CalendarSettings?
    @State private var isLoadingCalendars = false
    @State private var isAuthorizingCalendar = false
    @State private var calendarMessage: String?
    @State private var accountMessage: String?
    @State private var showingDeleteConfirmation = false
    @State private var members: [HouseholdMember]
    @State private var inviteEmail = ""

    private let timezones: [TimezoneChoice] = [
        .init(id: "America/New_York", name: "Eastern Time"), .init(id: "America/Chicago", name: "Central Time"),
        .init(id: "America/Denver", name: "Mountain Time"), .init(id: "America/Los_Angeles", name: "Pacific Time"),
        .init(id: "Europe/London", name: "London"), .init(id: "Europe/Paris", name: "Central European Time"),
    ]

    init(data: WeeklyPlannerData, viewModel: PlannerViewModel, auth: AuthStore) {
        self.data = data; self.viewModel = viewModel; self.auth = auth
        _name = State(initialValue: data.household.name)
        _timezone = State(initialValue: data.household.timezone)
        _temperature = State(initialValue: data.household.temperatureUnit)
        _members = State(initialValue: data.members)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 14) {
                        BrandMark(compact: true)
                        Spacer()
                        Text("iPhone").font(.caption.bold()).foregroundStyle(CWTheme.accent).padding(.horizontal, 10).padding(.vertical, 5).background(CWTheme.mint, in: Capsule())
                    }.padding(.vertical, 5)
                }
                Section("Household") {
                    TextField("Household name", text: $name)
                    ForEach(members) { member in
                        HStack(spacing: 12) {
                            Text(member.displayName.prefix(1)).font(.caption.bold()).foregroundStyle(CWTheme.accentStrong).frame(width: 34, height: 34).background(CWTheme.mint, in: Circle())
                            VStack(alignment: .leading) { Text(member.displayName); Text(member.email).font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Text(member.role.capitalized).font(.caption2).foregroundStyle(.secondary)
                            if isCurrentUserOwner && member.userId != currentUserId {
                                Menu {
                                    Button("Make owner") { Task { await transferOwnership(to: member) } }
                                    Button("Remove member", role: .destructive) { Task { await removeMember(member) } }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                }
                            }
                        }
                    }
                    if isCurrentUserOwner {
                        TextField("Invite by email", text: $inviteEmail)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                        Button("Send invitation") { Task { await inviteMember() } }
                            .disabled(inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section("Week preferences") {
                    Picker("Temperature", selection: $temperature) { Text("Fahrenheit · °F").tag(TemperatureUnit.fahrenheit); Text("Celsius · °C").tag(TemperatureUnit.celsius) }
                    Picker("Timezone", selection: $timezone) { ForEach(timezones) { Text($0.name).tag($0.id) } }
                    Button(isSaving ? "Saving…" : "Save preferences") { Task { await save() } }.disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Section("Google Calendar") {
                    calendarManagement
                }
                Section("Locations") {
                    Label("\(data.locations.count) saved location\(data.locations.count == 1 ? "" : "s")", systemImage: "location")
                }
                Section {
                    Button("Sign out", role: .destructive) { Task { await auth.signOut(); dismiss() } }
                    Button("Delete account", role: .destructive) { showingDeleteConfirmation = true }
                    if let accountMessage { Text(accountMessage).font(.caption).foregroundStyle(.red) }
                }
                Section("Legal and support") {
                    Link("Manage household on the web", destination: URL(string: "https://weekofus.com/settings")!)
                    Link("Privacy Policy", destination: URL(string: "https://weekofus.com/privacy")!)
                    Link("Terms of Service", destination: URL(string: "https://weekofus.com/terms")!)
                    Link("Contact support", destination: URL(string: "https://weekofus.com/support")!)
                }
                Section { Text(appVersion).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center) }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await loadCalendarSettings() }
            .alert("Permanently delete your account?", isPresented: $showingDeleteConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete account", role: .destructive) {
                    Task {
                        do {
                            _ = try await APIClient.shared.deleteAccount()
                            auth.accountWasDeleted()
                            dismiss()
                        } catch {
                            accountMessage = error.localizedDescription
                        }
                    }
                }
            } message: {
                Text("This removes your Week of Us account and planner data. If you own a household with other members, transfer ownership first.")
            }
        }
    }

    @ViewBuilder
    private var calendarManagement: some View {
        if isLoadingCalendars && calendarSettings == nil {
            HStack { ProgressView(); Text("Loading calendars…").foregroundStyle(.secondary) }
        } else if let settings = calendarSettings {
            HStack {
                Label(settings.connected ? "Google Calendar connected" : "Google Calendar not connected", systemImage: settings.connected ? "checkmark.circle.fill" : "calendar.badge.exclamationmark")
                    .foregroundStyle(settings.connected ? CWTheme.accentStrong : .secondary)
                Spacer()
                if settings.writeEnabled { Text("Editing on").font(.caption.bold()).foregroundStyle(CWTheme.accentStrong) }
            }

            if !settings.connected {
                Button { Task { await connectCalendar(writeAccess: false) } } label: {
                    Label(isAuthorizingCalendar ? "Connecting…" : "Connect Google Calendar", systemImage: "link")
                }.disabled(isAuthorizingCalendar)
            } else {
                if !settings.writeEnabled {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Calendar access is read-only.").font(.subheadline)
                        Text("Enable editing to add, edit, and delete events on writable calendars you share with your household.").font(.caption).foregroundStyle(.secondary)
                        Button { Task { await connectCalendar(writeAccess: true) } } label: {
                            Label(isAuthorizingCalendar ? "Authorizing…" : "Enable calendar editing", systemImage: "pencil.and.outline")
                        }.disabled(isAuthorizingCalendar)
                    }
                }

                Button { Task { await refreshCalendars() } } label: {
                    Label(isLoadingCalendars ? "Refreshing…" : "Refresh calendars", systemImage: "arrow.clockwise")
                }.disabled(isLoadingCalendars || isAuthorizingCalendar)
            }

            if let calendarMessage {
                Text(calendarMessage).font(.caption).foregroundStyle(calendarMessage.hasPrefix("Couldn’t") ? .red : .secondary)
            }

            if settings.connected && settings.calendars.isEmpty {
                Text("No calendars have been discovered yet. Tap Refresh calendars to load them from Google.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            ForEach(settings.calendars) { calendar in
                CalendarPreferenceEditor(calendar: calendar, disabled: isLoadingCalendars || isAuthorizingCalendar) { updated in
                    await saveCalendar(updated)
                }
            }
        } else {
            ContentUnavailableView("Calendars unavailable", systemImage: "calendar.badge.exclamationmark", description: Text(calendarMessage ?? "Try loading Calendar settings again."))
            Button("Try again") { Task { await loadCalendarSettings() } }
        }
    }

    private func save() async {
        isSaving = true
        let updated = HouseholdSummary(id: data.household.id, name: name.trimmingCharacters(in: .whitespacesAndNewlines), timezone: timezone, temperatureUnit: temperature)
        _ = await viewModel.updateHousehold(updated)
        isSaving = false
    }

    private var currentUserId: String? {
        if case .signedIn(let identity) = auth.state { return identity.userId }
        return nil
    }

    private var isCurrentUserOwner: Bool {
        members.first { $0.userId == currentUserId }?.role == "owner"
    }

    private func inviteMember() async {
        do {
            _ = try await APIClient.shared.householdAction("invite", email: inviteEmail.trimmingCharacters(in: .whitespacesAndNewlines))
            inviteEmail = ""
            accountMessage = nil
        } catch { accountMessage = error.localizedDescription }
    }

    private func transferOwnership(to member: HouseholdMember) async {
        do {
            _ = try await APIClient.shared.householdAction("transferOwnership", id: member.id)
            members = members.map { current in
                HouseholdMember(id: current.id, userId: current.userId, displayName: current.displayName, email: current.email, role: current.id == member.id ? "owner" : current.userId == currentUserId ? "member" : current.role)
            }
            accountMessage = nil
        } catch { accountMessage = error.localizedDescription }
    }

    private func removeMember(_ member: HouseholdMember) async {
        do {
            _ = try await APIClient.shared.householdAction("removeMember", id: member.id)
            members.removeAll { $0.id == member.id }
            accountMessage = nil
        } catch { accountMessage = error.localizedDescription }
    }

    private func loadCalendarSettings(refreshPlanner: Bool = false) async {
        if data.isDemo {
            calendarSettings = CalendarSettings(
                calendars: data.editableCalendars.map { calendar in
                    CalendarPreference(id: calendar.id, userId: "demo-jim", googleCalendarId: calendar.id, calendarName: calendar.name, displayAlias: nil, displayAbbreviation: nil, color: calendar.color, visibility: .share, isPrimary: calendar.id == data.editableCalendars.first?.id, sectionGroup: calendar.sectionGroup == "supplemental" ? .supplemental : .critical, accessRole: "owner")
                },
                connected: true,
                writeEnabled: true
            )
            return
        }
        isLoadingCalendars = true
        defer { isLoadingCalendars = false }
        do {
            calendarSettings = try await APIClient.shared.calendarSettings()
            if refreshPlanner { await viewModel.load(week: data.weekStart, quietly: true) }
        } catch {
            calendarMessage = "Couldn’t load calendars: \(error.localizedDescription)"
        }
    }

    private func connectCalendar(writeAccess: Bool) async {
        isAuthorizingCalendar = true
        calendarMessage = nil
        defer { isAuthorizingCalendar = false }
        do {
            try await auth.connectGoogleCalendar(writeAccess: writeAccess)
            do { _ = try await APIClient.shared.refreshGoogleCalendars() }
            catch {
                calendarMessage = "Google Calendar connected, but calendars couldn’t refresh: \(error.localizedDescription)"
                await loadCalendarSettings(refreshPlanner: true)
                return
            }
            await loadCalendarSettings(refreshPlanner: true)
            calendarMessage = writeAccess ? "Calendar editing enabled." : "Google Calendar connected."
        } catch AuthStoreError.cancelled {
            return
        } catch {
            calendarMessage = "Couldn’t authorize Calendar: \(error.localizedDescription)"
        }
    }

    private func refreshCalendars() async {
        isLoadingCalendars = true
        calendarMessage = nil
        defer { isLoadingCalendars = false }
        do {
            _ = try await APIClient.shared.refreshGoogleCalendars()
            calendarSettings = try await APIClient.shared.calendarSettings()
            await viewModel.load(week: data.weekStart, quietly: true)
            calendarMessage = "Calendars refreshed."
        } catch {
            calendarSettings = try? await APIClient.shared.calendarSettings()
            calendarMessage = "Couldn’t refresh calendars: \(error.localizedDescription)"
        }
    }

    private func saveCalendar(_ calendar: CalendarPreference) async -> Bool {
        guard !data.isDemo else {
            replaceCalendar(calendar)
            calendarMessage = "Demo calendar settings saved."
            return true
        }
        do {
            _ = try await APIClient.shared.updateCalendarPreference(calendar)
            replaceCalendar(calendar)
            await viewModel.load(week: data.weekStart, quietly: true)
            calendarMessage = calendar.visibility == .share ? "Calendar shared with your household." : "Calendar settings saved."
            return true
        } catch {
            calendarMessage = "Couldn’t save calendar: \(error.localizedDescription)"
            return false
        }
    }

    private func replaceCalendar(_ calendar: CalendarPreference) {
        guard var settings = calendarSettings,
              let index = settings.calendars.firstIndex(where: { $0.id == calendar.id }) else { return }
        settings.calendars[index] = calendar
        calendarSettings = settings
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "Week of Us \(version) (\(build))"
    }
}

private struct CalendarPreferenceEditor: View {
    @State private var calendar: CalendarPreference
    @State private var isSaving = false
    let disabled: Bool
    let onSave: (CalendarPreference) async -> Bool

    init(calendar: CalendarPreference, disabled: Bool, onSave: @escaping (CalendarPreference) async -> Bool) {
        _calendar = State(initialValue: calendar)
        self.disabled = disabled
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 11) {
                Text(calendar.displayAbbreviation ?? abbreviation(for: calendar.displayAlias ?? calendar.calendarName))
                    .font(.caption.bold()).foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Color(hex: calendar.color), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 2) {
                    Text(calendar.calendarName).font(.headline)
                    Text([calendar.accessRole.capitalized, calendar.isPrimary ? "Primary" : nil].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            Picker("Access", selection: $calendar.visibility) {
                ForEach(CalendarVisibility.allCases) { visibility in Text(visibility.title).tag(visibility) }
            }.pickerStyle(.segmented)

            Text(calendar.visibility == .share ? "Household owners and members can view this calendar and edit it when Google grants write access and Calendar editing is enabled." : calendar.visibility == .private ? "Only you can see and edit this calendar in Week of Us." : "This calendar is removed from Week of Us.")
                .font(.caption).foregroundStyle(.secondary)

            TextField("Display alias", text: optionalBinding(\CalendarPreference.displayAlias))
            TextField("Badge (2 characters)", text: optionalBinding(\CalendarPreference.displayAbbreviation))
                .textInputAutocapitalization(.characters)
                .onChange(of: calendar.displayAbbreviation) { _, value in
                    let normalized = String((value ?? "").uppercased().filter { $0.isLetter || $0.isNumber }.prefix(2))
                    calendar.displayAbbreviation = normalized.isEmpty ? nil : normalized
                }
            Picker("Planner section", selection: $calendar.sectionGroup) {
                ForEach(CalendarSectionGroup.allCases) { section in Text(section.title).tag(section) }
            }
            Button(isSaving ? "Saving…" : "Save calendar") {
                Task {
                    isSaving = true
                    _ = await onSave(calendar)
                    isSaving = false
                }
            }.disabled(disabled || isSaving)
        }.padding(.vertical, 6)
    }

    private func optionalBinding(_ keyPath: WritableKeyPath<CalendarPreference, String?>) -> Binding<String> {
        Binding(
            get: { calendar[keyPath: keyPath] ?? "" },
            set: { calendar[keyPath: keyPath] = $0.isEmpty ? nil : $0 }
        )
    }

    private func abbreviation(for name: String) -> String {
        let words = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        if words.count > 1 { return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased() }
        return String(name.prefix(2)).uppercased()
    }
}

private struct TimezoneChoice: Identifiable {
    let id: String
    let name: String
}
