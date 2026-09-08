import Foundation

/// In-memory previews use the same family features across sheets and weeks during one launch.
@MainActor
final class FamilyPlanningDemo {
    static let shared = FamilyPlanningDemo()
    private var children = [ChildProfile(id: "demo-child", name: "Miriam", color: "#688173", calendarPreferenceIds: ["calendar-family"])]
    private var adultCalendars: [String: [String]] = [:]
    private var routines: [TaskRoutine] = []
    private var templates: [WeekTemplate] = []
    private var applied = Set<String>()
    private var reviews: [String: WeeklyReview] = [:]
    private var weeks: [String: WeeklyPlannerData] = [:]
    private var generated = Set<String>()

    func capture(_ planner: WeeklyPlannerData?) {
        if let planner, planner.isDemo { weeks[planner.weekStart] = planner }
    }

    func planner(weekStart: String, capturing existing: WeeklyPlannerData? = nil) -> WeeklyPlannerData {
        capture(existing)
        var value = weeks[weekStart] ?? PreviewData.planner(weekStart: weekStart)
        for routine in routines where routine.active {
            for occurrence in occurrences(routine, weekStart: weekStart) {
                let identity = "\(routine.id):\(occurrence ?? weekStart)"
                guard !generated.contains(identity) else { continue }
                generated.insert(identity)
                let item = PlanningItem(id: identity, planningDate: occurrence, weekStartDate: weekStart, type: .task, text: routine.text, isCompleted: false, sortOrder: 0, createdBy: PreviewData.user.userId, createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved", reminder: nil, childId: routine.childId, assignedMemberIds: routine.assignedMemberIds, routineId: routine.id, routineOccurrenceDate: occurrence ?? weekStart)
                insert(item, into: &value)
            }
        }
        value.childProfiles = children
        for index in value.days.indices {
            value.days[index].events = value.days[index].events.map { event in
                var event = event
                event.assignedAdultUserIds = value.members.filter { member in
                    adultCalendars[member.userId]?.contains(event.calendarPreferenceId ?? event.calendarId) ?? (event.sourceUserId == member.userId)
                }.map(\.userId)
                event.defaultMemberIds = (event.assignedAdultUserIds ?? []) + children.filter { $0.calendarPreferenceIds.contains(event.calendarPreferenceId ?? event.calendarId) }.map(\.id)
                event.assignedMemberIds = event.memberOverrideIds ?? event.defaultMemberIds
                return event
            }
        }
        weeks[weekStart] = value
        return value
    }

    func data(weekStart: String) -> FamilyPlanningData {
        let review = reviews[weekStart] ?? .init(weekStart: weekStart, priorities: "Keep Saturday afternoon open", meals: "Dinner at home Monday through Thursday", logistics: "Confirm camp pickup plans", revision: 0, reviewedBy: [])
        let planner = weeks[weekStart] ?? PreviewData.planner(weekStart: weekStart)
        let adults = planner.members.map { member in
            AdultCalendarAssignment(userId: member.userId, displayName: member.displayName, calendarPreferenceIds: adultCalendars[member.userId] ?? CalendarEventFilter.calendars(in: planner).filter { $0.sourceUserId == member.userId }.map(\.id))
        }
        return FamilyPlanningData(weekStart: weekStart, currentUserId: PreviewData.user.userId, canEdit: true, children: children, routines: routines, templates: templates.map { .init(id: $0.id, name: $0.name, items: $0.items, appliedToWeek: applied.contains("\($0.id):\(weekStart)")) }, review: review, openTasks: weeks.values.filter { $0.weekStart < weekStart }.flatMap { $0.weeklyItems + $0.days.flatMap(\.items) }.filter { $0.type == .task && !$0.isCompleted }, adults: adults)
    }

    func apply(_ mutation: FamilyPlanningMutation) throws -> FamilyPlanningData {
        let week = mutation.weekStart
        var review = data(weekStart: week).review
        switch mutation.action {
        case "saveAdultCalendars":
            if let userId = mutation.userId, let ids = mutation.calendarPreferenceIds { adultCalendars[userId] = ids }
        case "saveChild":
            if let child = mutation.child { children.removeAll { $0.id == child.id }; children.append(child) }
        case "deleteChild":
            children.removeAll { $0.id == mutation.id }
            for key in Array(weeks.keys) {
                transformItems(in: key) { item in var item = item; if item.childId == mutation.id { item.childId = nil }; return item }
            }
        case "saveRoutine", "deleteRoutine":
            let id = mutation.routine?.id ?? mutation.id
            routines.removeAll { $0.id == id }
            if let routine = mutation.routine, mutation.action == "saveRoutine" { routines.append(routine) }
            for key in Array(weeks.keys) {
                transformItems(in: key) { item in
                    guard item.routineId == id, !item.isCompleted, (item.routineOccurrenceDate ?? item.weekStartDate) >= WeekDate.today(timeZoneIdentifier: "America/New_York") else { return item }
                    generated.remove("\(item.routineId ?? ""):\(item.routineOccurrenceDate ?? item.weekStartDate)")
                    return nil
                }
            }
            if let sourceId = mutation.sourceItemId, let routine = mutation.routine {
                for key in Array(weeks.keys) {
                    transformItems(in: key) { item in
                        guard item.id == sourceId else { return item }
                        var updated = item
                        updated.routineId = routine.id
                        updated.routineOccurrenceDate = item.planningDate ?? item.weekStartDate
                        updated.childId = routine.childId
                        updated.assignedMemberIds = routine.assignedMemberIds
                        generated.insert("\(routine.id):\(updated.routineOccurrenceDate!)")
                        return updated
                    }
                }
            }
        case "saveTemplate":
            let snapshot = planner(weekStart: week)
            let items = (snapshot.weeklyItems + snapshot.days.flatMap(\.items)).filter { $0.routineId == nil }.map {
                WeekTemplate.Item(dayOffset: $0.planningDate.map { WeekDate.daysBetween(week, $0) }, type: $0.type, text: $0.text, childId: $0.childId, assignedMemberIds: $0.assignedMemberIds)
            }
            guard !items.isEmpty else { throw APIError.server("Add a plan or one-off task to save as a template.") }
            let id = mutation.id ?? UUID().uuidString
            if !templates.contains(where: { $0.id == id }) {
                templates.append(.init(id: id, name: mutation.name ?? "Week template", items: items, appliedToWeek: false))
                applied.insert("\(id):\(week)")
            }
        case "deleteTemplate": templates.removeAll { $0.id == mutation.id }
        case "applyTemplate":
            guard let template = templates.first(where: { $0.id == mutation.id }) else { throw APIError.invalidResponse }
            let key = "\(template.id):\(week)"
            if !applied.contains(key) {
                var value = planner(weekStart: week)
                for (index, item) in template.items.enumerated() {
                    insert(.init(id: "\(key):\(index)", planningDate: item.dayOffset.map { WeekDate.addDays($0, to: week) }, weekStartDate: week, type: item.type, text: item.text, isCompleted: false, sortOrder: index, createdBy: PreviewData.user.userId, createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved", reminder: nil, childId: item.childId, assignedMemberIds: item.assignedMemberIds), into: &value)
                }
                weeks[week] = value; applied.insert(key)
            }
        case "saveReview":
            guard mutation.revision == review.revision else { throw APIError.server("The shared plan changed. Reload before saving your notes.") }
            review = .init(weekStart: week, priorities: mutation.priorities ?? "", meals: mutation.meals ?? "", logistics: mutation.logistics ?? "", revision: review.revision + 1, reviewedBy: [])
            reviews[week] = review
        case "markReviewed":
            guard mutation.revision == review.revision else { throw APIError.server("The shared plan changed. Read the latest plan before marking it reviewed.") }
            reviews[week] = .init(weekStart: week, priorities: review.priorities, meals: review.meals, logistics: review.logistics, revision: review.revision, reviewedBy: mutation.reviewed == true ? [.init(userId: PreviewData.user.userId, displayName: "Jim", reviewedAt: WeekDate.iso8601.string(from: Date()))] : [])
        default: throw APIError.invalidResponse
        }
        return data(weekStart: week)
    }

    private func insert(_ item: PlanningItem, into planner: inout WeeklyPlannerData) {
        if let date = item.planningDate, let index = planner.days.firstIndex(where: { $0.date == date }) { planner.days[index].items.append(item) }
        else { planner.weeklyItems.append(item) }
    }

    private func transformItems(in week: String, transform: (PlanningItem) -> PlanningItem?) {
        guard var planner = weeks[week] else { return }
        planner.weeklyItems = planner.weeklyItems.compactMap(transform)
        for index in planner.days.indices { planner.days[index].items = planner.days[index].items.compactMap(transform) }
        weeks[week] = planner
    }

    private func occurrences(_ routine: TaskRoutine, weekStart: String) -> [String?] {
        if routine.frequency == "weekly", routine.weekdays.isEmpty {
            let distance = WeekDate.daysBetween(WeekDate.weekStart(for: routine.startsOn), weekStart) / 7
            return distance >= 0 && distance % max(1, routine.interval) == 0 && (routine.endsOn == nil || weekStart <= routine.endsOn!) ? [nil] : []
        }
        return (0..<7).compactMap { offset -> String? in
            let date = WeekDate.addDays(offset, to: weekStart)
            guard date >= routine.startsOn, routine.endsOn == nil || date <= routine.endsOn! else { return nil }
            if routine.frequency == "daily" {
                return WeekDate.daysBetween(routine.startsOn, date) % max(1, routine.interval) == 0
                    && (routine.weekdays.isEmpty || routine.weekdays.contains(offset)) ? date : nil
            }
            let weeks = WeekDate.daysBetween(WeekDate.weekStart(for: routine.startsOn), weekStart) / 7
            return weeks % max(1, routine.interval) == 0 && routine.weekdays.contains(offset) ? date : nil
        }.map(Optional.some)
    }
}

@MainActor enum WorkspaceAccess {
    private struct DemoState: Codable {
        var tasks: [String: WorkspaceTask] = [:]
        var entries: [String: [WorkspaceEntry]] = [:]
        var files: [String: Data] = [:]
        var pendingTasks: [String]? = nil
    }
    private static var state: DemoState {
        get { UserDefaults.standard.data(forKey: "workspace-demo").flatMap { try? JSONDecoder().decode(DemoState.self, from: $0) } ?? DemoState() }
        set { if let data = try? JSONEncoder().encode(newValue) { UserDefaults.standard.set(data, forKey: "workspace-demo") } }
    }
    private static func key(_ resource: [String: String]) -> String { resource.sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: "|") }
    static func load(planner: WeeklyPlannerData, resource: [String: String] = [:]) async throws -> TaskWorkspacePayload {
        if !planner.isDemo { return try await APIClient.shared.taskWorkspace(resource: resource) }
        var d = state
        for item in planner.weeklyItems + planner.days.flatMap(\.items) where d.tasks[item.id] == nil {
            d.tasks[item.id] = WorkspaceTask(id: item.id, text: item.text, type: item.type.rawValue, responsibleMemberId: nil, deadline: nil, isBacklog: false, planningDate: item.planningDate, weekStartDate: item.weekStartDate, isCompleted: item.isCompleted)
        }
        state = d
        return TaskWorkspacePayload(tasks: resource.isEmpty ? d.tasks.values.filter { $0.type == "task" }.sorted { $0.text < $1.text } : [], entries: d.entries[key(resource)] ?? [], task: resource["itemId"].flatMap { d.tasks[$0] })
    }
    static func mutate(_ body: [String: WorkspaceValue], planner: WeeklyPlannerData, userId: String) async throws {
        if !planner.isDemo { try await APIClient.shared.mutateTaskWorkspace(body); return }
        var d = state
        let action = body["action"]?.stringValue ?? ""
        var resource: [String: String] = [:]
        if case .object(let values) = body["resource"] { resource = values.compactMapValues(\.stringValue) }
        let resourceKey = key(resource)
        let id = body["id"]?.stringValue ?? UUID().uuidString
        if action == "capture" {
            d.pendingTasks = Array(Set((d.pendingTasks ?? []) + [id]))
            d.tasks[id] = WorkspaceTask(id: id, text: body["text"]?.stringValue ?? "", type: "task", responsibleMemberId: nil, deadline: nil, isBacklog: true, planningDate: nil, weekStartDate: planner.weekStart, isCompleted: false)
        } else if action == "task", let itemId = resource["itemId"], var task = d.tasks[itemId] {
            d.pendingTasks = Array(Set((d.pendingTasks ?? []) + [itemId]))
            if let text = body["text"]?.stringValue { task.text = text }
            if body["claim"]?.boolValue == true { task.responsibleMemberId = userId }
            if let value = body["responsibleMemberId"] { task.responsibleMemberId = value.stringValue }
            if let value = body["deadline"] { task.deadline = value.stringValue }
            if let value = body["isBacklog"]?.boolValue { task.isBacklog = value }
            if let value = body["planningDate"] { task.planningDate = value.stringValue }
            if let value = body["weekStartDate"]?.stringValue { task.weekStartDate = value }
            if let value = body["isCompleted"]?.boolValue { task.isCompleted = value }
            if task.isBacklog { task.planningDate = nil }
            else if let date = task.planningDate { task.weekStartDate = WeekDate.weekStart(for: date) }
            d.tasks[itemId] = task
        } else if action == "add" {
            d.entries[resourceKey, default: []].append(WorkspaceEntry(id: id, kind: body["kind"]?.stringValue ?? "comment", text: body["text"]?.stringValue ?? "", completed: false, createdBy: userId, author: planner.members.first { $0.userId == userId }?.displayName ?? "You", createdAt: ISO8601DateFormatter().string(from: Date())))
            if let raw = body["fileData"]?.stringValue { d.files[id] = Data(base64Encoded: raw) }
        } else if action == "check", let index = d.entries[resourceKey]?.firstIndex(where: { $0.id == id }) {
            d.entries[resourceKey]?[index].completed = body["completed"]?.boolValue ?? false
        } else if action == "remove" { d.entries[resourceKey]?.removeAll { $0.id == id }; d.files[id] = nil }
        state = d
    }
    static func applying(to planner: WeeklyPlannerData) -> WeeklyPlannerData {
        var result = planner
        var d = state
        for var task in d.tasks.values {
            let existing = (result.weeklyItems + result.days.flatMap(\.items)).first { $0.id == task.id }
            if let existing, !(d.pendingTasks ?? []).contains(task.id) {
                task.text = existing.text; task.isCompleted = existing.isCompleted; task.planningDate = existing.planningDate; task.weekStartDate = existing.weekStartDate
                d.tasks[task.id] = task
            }
            var item = existing ?? PlanningItem(id: task.id, planningDate: task.planningDate, weekStartDate: task.weekStartDate, type: task.type == "task" ? .task : .note, text: task.text, isCompleted: task.isCompleted, sortOrder: 0, createdBy: planner.members.first?.userId ?? "demo", createdByName: nil, updatedAt: "", saveState: "saved", reminder: nil)
            item.text = task.text; item.planningDate = task.planningDate; item.weekStartDate = task.weekStartDate; item.isCompleted = task.isCompleted
            item.responsibleMemberId = task.responsibleMemberId; item.deadline = task.deadline; item.isBacklog = task.isBacklog
            result.weeklyItems.removeAll { $0.id == task.id }
            for index in result.days.indices { result.days[index].items.removeAll { $0.id == task.id } }
            guard !task.isBacklog && task.weekStartDate == result.weekStart else { continue }
            if let date = task.planningDate, let index = result.days.firstIndex(where: { $0.date == date }) { result.days[index].items.append(item) }
            else if task.planningDate == nil { result.weeklyItems.append(item) }
        }
        d.pendingTasks = []; state = d
        return result
    }
    static func file(_ entry: WorkspaceEntry, planner: WeeklyPlannerData) async throws -> URL {
        if !planner.isDemo { return try await APIClient.shared.workspaceFile(id: entry.id, name: entry.text) }
        guard let data = state.files[entry.id] else { throw APIError.server("File not found.") }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent((entry.text as NSString).lastPathComponent)
        try data.write(to: url); return url
    }
}
