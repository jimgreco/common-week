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
                                .foregroundStyle(item.type == .task ? CWTheme.accent : Color(hex: item.categoryColor ?? "#7B8983"))
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
    @Environment(\.openURL) private var openURL
    @State private var name: String
    @State private var timezone: String
    @State private var temperature: TemperatureUnit
    @State private var isSaving = false

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
                    ForEach(data.members) { member in
                        HStack(spacing: 12) {
                            Text(member.displayName.prefix(1)).font(.caption.bold()).foregroundStyle(CWTheme.accentStrong).frame(width: 34, height: 34).background(CWTheme.mint, in: Circle())
                            VStack(alignment: .leading) { Text(member.displayName); Text(member.email).font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Text(member.role.capitalized).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Week preferences") {
                    Picker("Temperature", selection: $temperature) { Text("Fahrenheit · °F").tag(TemperatureUnit.fahrenheit); Text("Celsius · °C").tag(TemperatureUnit.celsius) }
                    Picker("Timezone", selection: $timezone) { ForEach(timezones) { Text($0.name).tag($0.id) } }
                    Button(isSaving ? "Saving…" : "Save preferences") { Task { await save() } }.disabled(isSaving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Section("Calendars & locations") {
                    Label("\(data.editableCalendars.count) editable calendar\(data.editableCalendars.count == 1 ? "" : "s")", systemImage: "calendar")
                    Label("\(data.locations.count) saved location\(data.locations.count == 1 ? "" : "s")", systemImage: "location")
                    Button { openURL(APIClient.shared.baseURL.appending(path: "/settings")) } label: { Label("Manage full settings on the web", systemImage: "safari") }
                }
                Section {
                    Button("Sign out", role: .destructive) { Task { await auth.signOut(); dismiss() } }
                }
                Section { Text(appVersion).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .center) }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func save() async {
        isSaving = true
        let updated = HouseholdSummary(id: data.household.id, name: name.trimmingCharacters(in: .whitespacesAndNewlines), timezone: timezone, temperatureUnit: temperature)
        _ = await viewModel.updateHousehold(updated)
        isSaving = false
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "Common Week \(version) (\(build))"
    }
}

private struct TimezoneChoice: Identifiable {
    let id: String
    let name: String
}
