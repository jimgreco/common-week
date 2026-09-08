import SwiftUI
import UIKit

enum PlannerMoment {
    static func date(from value: String) -> Date? {
        if let date = WeekDate.iso8601.date(from: value) { return date }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
    static func label(_ event: CalendarEvent, timezone: String) -> String {
        let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier: timezone)
        formatter.dateStyle = .medium; formatter.timeStyle = event.allDay ? .none : .short
        let start = date(from: event.start).map { formatter.string(from: $0) } ?? event.start
        formatter.dateStyle = .none
        let end = date(from: event.end).map { formatter.string(from: $0) } ?? ""
        return event.allDay ? start : "\(start) – \(end)"
    }
}

struct EventCoverage: Codable, Identifiable {
    var id: String { "\(calendarId):\(eventId):\(childId)" }
    var calendarId: String; var eventId: String; var childId: String
    var dropOffUserId: String? = nil; var pickupUserId: String? = nil
    var dropOffNeeded = true; var pickupNeeded = true
    var dropOffConfirmed = false; var pickupConfirmed = false
    var travelMinutes = 20; var notes = ""; var revision = 0
    var confirmation: String? = nil; var confirmed: Bool? = nil
    enum CodingKeys: String, CodingKey { case calendarId, eventId, childId, dropOffUserId, pickupUserId, dropOffNeeded, pickupNeeded, dropOffConfirmed, pickupConfirmed, travelMinutes, notes, revision, confirmation, confirmed }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(calendarId, forKey: .calendarId); try c.encode(eventId, forKey: .eventId); try c.encode(childId, forKey: .childId)
        try c.encode(dropOffUserId, forKey: .dropOffUserId); try c.encode(pickupUserId, forKey: .pickupUserId)
        try c.encode(dropOffNeeded, forKey: .dropOffNeeded); try c.encode(pickupNeeded, forKey: .pickupNeeded)
        try c.encode(dropOffConfirmed, forKey: .dropOffConfirmed); try c.encode(pickupConfirmed, forKey: .pickupConfirmed)
        try c.encode(travelMinutes, forKey: .travelMinutes); try c.encode(notes, forKey: .notes); try c.encode(revision, forKey: .revision)
        try c.encodeIfPresent(confirmation, forKey: .confirmation); try c.encodeIfPresent(confirmed, forKey: .confirmed)
    }
    var status: String {
        var issues: [String] = []
        if dropOffNeeded { if dropOffUserId == nil { issues.append("Drop-off needs an owner") } else if !dropOffConfirmed { issues.append("Drop-off awaiting confirmation") } }
        if pickupNeeded { if pickupUserId == nil { issues.append("Pickup needs an owner") } else if !pickupConfirmed { issues.append("Pickup awaiting confirmation") } }
        return issues.isEmpty ? "Coverage confirmed" : issues.joined(separator: " · ")
    }
}
struct CoveragePayload: Decodable { let ok: Bool; let data: [EventCoverage] }

struct CoverageView: View {
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [EventCoverage] = []
    @State private var error: String?
    @State private var loaded = false
    var events: [CalendarEvent] { Array(Dictionary(planner.days.flatMap(\.events).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values).sorted { $0.start < $1.start } }
    func children(_ event: CalendarEvent) -> [ChildProfile] { (planner.childProfiles ?? []).filter { child in event.assignedMemberIds.map { $0.contains(child.id) } ?? child.calendarPreferenceIds.contains(event.calendarPreferenceId ?? "") } }
    var body: some View {
        NavigationStack {
            List {
                Section { Text("Assign each handoff, then ask the assigned adult to confirm their own coverage.") }
                if let error { Text(error).foregroundStyle(.red) }
                if !loaded { ProgressView("Loading coverage…") }
                if loaded && events.allSatisfy({ children($0).isEmpty }) { Text("No child events this week. Assign children to calendars or events to plan their transport.") }
                ForEach(events) { event in
                    if let calendar = event.calendarPreferenceId, let provider = event.providerEventId, !children(event).isEmpty {
                        Section(event.title) {
                            Text(event.allDay ? "All day · Confirm handoff times in notes" : "Drop-off at start · Pickup at end").font(.caption)
                            Text(PlannerMoment.label(event, timezone: planner.household.timezone)).font(.caption).foregroundStyle(.secondary)
                            ForEach(children(event)) { child in
                                let entry = rows.first { $0.calendarId == calendar && $0.eventId == provider && $0.childId == child.id } ?? EventCoverage(calendarId: calendar, eventId: provider, childId: child.id)
                                CoverageEditor(entry: entry, name: child.name, members: planner.members, userId: viewModel.workspaceUserId, canEdit: viewModel.canEditHousehold, save: save).id("\(entry.id):\(entry.revision)")
                            }
                        }
                    }
                }
                Section("Travel checks") {
                    ForEach(CoverageTravel.warnings(events: events, rows: rows), id: \.self) { Text($0).foregroundStyle(.orange) }
                    Text("Warnings use scheduled times and your travel buffer, not live traffic. All-day events are excluded.").font(.caption)
                }
            }
            .navigationTitle("Pickup & drop-off")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.fixedSize() } }
            .task { await reload() }.refreshable { await reload() }
        }
    }
    func reload() async {
        do {
            if planner.isDemo { rows = (UserDefaults.standard.data(forKey: "demo-coverage-native").flatMap { try? JSONDecoder().decode([EventCoverage].self, from: $0) }) ?? [] }
            else { rows = try await APIClient.shared.coverage().data }
            loaded = true; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func save(_ entry: EventCoverage) async throws {
        if planner.isDemo {
            var updated = entry; updated.revision += 1
            if entry.confirmation == "dropOff" { updated.dropOffConfirmed = entry.confirmed ?? true }
            if entry.confirmation == "pickup" { updated.pickupConfirmed = entry.confirmed ?? true }
            rows.removeAll { $0.id == entry.id }; rows.append(updated)
            UserDefaults.standard.set(try JSONEncoder().encode(rows), forKey: "demo-coverage-native")
        } else { rows = try await APIClient.shared.saveCoverage(entry).data }
    }
}
private struct CoverageEditor: View {
    @State var entry: EventCoverage
    let name: String; let members: [HouseholdMember]; let userId: String; let canEdit: Bool
    let save: (EventCoverage) async throws -> Void
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(name).font(.headline)
            Text(entry.status).font(.caption).foregroundStyle(.secondary)
            Toggle("Drop-off needed", isOn: $entry.dropOffNeeded).onChange(of: entry.dropOffNeeded) { entry.dropOffConfirmed = false }
            if entry.dropOffNeeded {
                adultPicker("Drop-off adult", selection: $entry.dropOffUserId).onChange(of: entry.dropOffUserId) { entry.dropOffConfirmed = false }
                if entry.dropOffUserId == userId { Button(entry.dropOffConfirmed ? "Withdraw drop-off confirmation" : "I can do drop-off") { submit("dropOff", !entry.dropOffConfirmed) }.buttonStyle(.borderless) }
            }
            Toggle("Pickup needed", isOn: $entry.pickupNeeded).onChange(of: entry.pickupNeeded) { entry.pickupConfirmed = false }
            if entry.pickupNeeded {
                adultPicker("Pickup adult", selection: $entry.pickupUserId).onChange(of: entry.pickupUserId) { entry.pickupConfirmed = false }
                if entry.pickupUserId == userId { Button(entry.pickupConfirmed ? "Withdraw pickup confirmation" : "I can do pickup") { submit("pickup", !entry.pickupConfirmed) }.buttonStyle(.borderless) }
            }
            Stepper("Travel buffer: \(entry.travelMinutes) min", value: $entry.travelMinutes, in: 0...180, step: 5)
            TextField("Handoff notes", text: $entry.notes, axis: .vertical).lineLimit(2...5)
            if let error { Text(error).foregroundStyle(.red) }
            Button(busy ? "Saving…" : "Save coverage") { submit() }.buttonStyle(.borderedProminent)
        }.padding(.vertical, 8).disabled(!canEdit || busy)
    }
    func adultPicker(_ title: String, selection: Binding<String?>) -> some View {
        Picker(title, selection: selection) { Text("Needs an owner").tag(String?.none); ForEach(members.filter { $0.role != "viewer" }) { Text($0.displayName).tag(Optional($0.userId)) } }
    }
    func submit(_ confirmation: String? = nil, _ confirmed: Bool? = nil) {
        busy = true; error = nil
        var draft = entry; draft.confirmation = confirmation; draft.confirmed = confirmed
        Task { do { try await save(draft) } catch { self.error = error.localizedDescription }; busy = false }
    }
}
enum CoverageTravel {
    static func warnings(events: [CalendarEvent], rows: [EventCoverage]) -> [String] {
        struct Slot { let user: String; let time: Date; let buffer: Int; let title: String; let eventId: String; let leg: String }
        var slots: [Slot] = []
        for row in rows {
            guard let event = events.first(where: { $0.calendarPreferenceId == row.calendarId && $0.providerEventId == row.eventId }), !event.allDay else { continue }
            for (needed, user, value, leg) in [(row.dropOffNeeded, row.dropOffUserId, event.start, "Drop-off"), (row.pickupNeeded, row.pickupUserId, event.end, "Pickup")] {
                if needed, let user, let time = PlannerMoment.date(from: value), !slots.contains(where: { $0.user == user && $0.eventId == event.id && $0.leg == leg }) { slots.append(Slot(user: user, time: time, buffer: row.travelMinutes, title: "\(leg): \(event.title)", eventId: event.id, leg: leg)) }
            }
        }
        slots.sort { $0.time < $1.time }; var warnings = Set<String>()
        for (i, slot) in slots.enumerated() {
            if let next = slots.dropFirst(i + 1).first(where: { $0.user == slot.user }), next.time.timeIntervalSince(slot.time) < Double(max(slot.buffer, next.buffer) * 60) { warnings.insert("\(slot.title) → \(next.title): less than \(max(slot.buffer, next.buffer)) minutes for travel.") }
            for event in events where !event.allDay && event.id != slot.eventId && (event.assignedMemberIds ?? []).contains(slot.user) {
                if let start = PlannerMoment.date(from: event.start), let end = PlannerMoment.date(from: event.end), slot.time >= start && slot.time < end { warnings.insert("\(slot.title) overlaps \(event.title) for the assigned adult.") }
            }
        }
        return warnings.sorted()
    }
}

struct WeekShareView: View {
    let planner: WeeklyPlannerData
    @ObservedObject var viewModel: PlannerViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var selected = Set<String>()
    @State private var includeEvents = true
    @State private var includeTasks = true
    @State private var includeNotes = false
    @State private var includePrivate = false
    @State private var pdf: URL?
    @State private var error: String?
    @State private var display = false
    @State private var priorIdle = false
    var source: WeeklyPlannerData { viewModel.data ?? planner }
    func matches(_ ids: [String]) -> Bool { selected.isEmpty || !selected.isDisjoint(with: ids) }
    var lines: [String] {
        var result = [source.household.name, "Week of \(source.weekStart)"]
        func itemLines(_ items: [PlanningItem]) -> [String] { items.filter { ($0.type == .task ? includeTasks : includeNotes) && matches(($0.assignedMemberIds ?? ($0.childId.map { [$0] } ?? [])) + ($0.responsibleMemberId.map { [$0] } ?? [])) }.map { ($0.type == .task ? ($0.isCompleted ? "☑ " : "☐ ") : "") + $0.text } }
        let weekly = itemLines(source.weeklyItems); if !weekly.isEmpty { result += ["This week"] + weekly }
        for day in source.days {
            result.append(day.date)
            result += day.events.filter { includeEvents && matches($0.assignedMemberIds ?? []) }.filter { event in includePrivate || source.visibleCalendars?.first(where: { $0.id == event.calendarPreferenceId })?.visibility == "share" }.map { event in
                let time = PlannerMoment.date(from: event.start).map { date in let f = DateFormatter(); f.timeZone = TimeZone(identifier: source.household.timezone); f.timeStyle = .short; return f.string(from: date) } ?? ""
                return "\(event.allDay ? "All day" : time) · \(event.title)"
            }
            result += itemLines(day.items)
        }
        return result
    }
    var body: some View {
        NavigationStack {
            List {
                if !display {
                    Section("People") {
                        Button("Everyone, including unassigned plans") { selected = [] }.buttonStyle(.borderless)
                        ForEach(source.members) { member in personToggle(member.displayName, id: member.userId) }
                        ForEach(source.childProfiles ?? []) { child in personToggle(child.name, id: child.id) }
                    }
                    Section("Details") { Toggle("Events", isOn: $includeEvents); Toggle("Tasks", isOn: $includeTasks); Toggle("Notes", isOn: $includeNotes); Toggle("My private calendars", isOn: $includePrivate) }
                    Section { Button("Create PDF") { export() }.buttonStyle(.borderedProminent); if let pdf { ShareLink("Share PDF", item: pdf) }; if let error { Text(error).foregroundStyle(.red) }; Button("Kitchen display") { display = true } }
                }
                Section(display ? "Family week" : "Preview") { ForEach(Array(lines.enumerated()), id: \.offset) { _, line in Text(line).font(display ? .title2 : .body).padding(.vertical, display ? 6 : 0) } }
            }
            .navigationTitle(display ? "Kitchen display" : "Share your week")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(display ? "Exit display" : "Done") { if display { display = false } else { dismiss() } }.fixedSize() } }
            .onAppear { priorIdle = UIApplication.shared.isIdleTimerDisabled }
            .onChange(of: display) { UIApplication.shared.isIdleTimerDisabled = display || priorIdle }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = priorIdle }
            .task(id: display) { guard display else { return }; while !Task.isCancelled { try? await Task.sleep(for: .seconds(60)); if !Task.isCancelled { await viewModel.load(quietly: true) } } }
            .onChange(of: lines) { pdf = nil }
        }
    }
    func personToggle(_ name: String, id: String) -> some View { Toggle(name, isOn: Binding(get: { selected.contains(id) }, set: { if $0 { selected.insert(id) } else { selected.remove(id) } })) }
    func export() {
        do { pdf = try WeekPDF.create(lines: lines) } catch { self.error = error.localizedDescription }
    }
}
enum WeekPDF {
    static func create(lines: [String]) throws -> URL {
        let bounds = CGRect(x: 0, y: 0, width: 842, height: 595)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let paragraph = NSMutableParagraphStyle(); paragraph.paragraphSpacing = 10
        let text = NSMutableAttributedString(string: lines.joined(separator: "\n"), attributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black, .paragraphStyle: paragraph])
        if let first = lines.first { text.addAttribute(.font, value: UIFont.boldSystemFont(ofSize: 24), range: NSRange(location: 0, length: (first as NSString).length)) }
        let storage = NSTextStorage(attributedString: text)
        let layout = NSLayoutManager(); storage.addLayoutManager(layout)
        let data = renderer.pdfData { context in
            var rendered = 0
            repeat {
                let container = NSTextContainer(size: CGSize(width: 762, height: 515)); container.lineFragmentPadding = 0
                layout.addTextContainer(container)
                let range = layout.glyphRange(for: container)
                context.beginPage()
                layout.drawBackground(forGlyphRange: range, at: CGPoint(x: 40, y: 40))
                layout.drawGlyphs(forGlyphRange: range, at: CGPoint(x: 40, y: 40))
                rendered = NSMaxRange(range)
                if range.length == 0 { break }
            } while rendered < layout.numberOfGlyphs
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("week-exports", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("Family-week-\(UUID().uuidString).pdf")
        try data.write(to: url, options: .atomic); return url
    }
}
