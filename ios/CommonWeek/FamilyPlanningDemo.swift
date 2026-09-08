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
                let item = PlanningItem(id: identity, planningDate: occurrence, weekStartDate: weekStart, type: .task, text: routine.text, isCompleted: false, sortOrder: 0, createdBy: PreviewData.user.userId, createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved", reminder: nil, childId: routine.childId, routineId: routine.id, routineOccurrenceDate: occurrence ?? weekStart)
                insert(item, into: &value)
            }
        }
        for index in value.days.indices {
            value.days[index].events = value.days[index].events.map { event in
                var event = event
                event.assignedAdultUserIds = value.members.filter { member in
                    adultCalendars[member.userId]?.contains(event.calendarPreferenceId ?? event.calendarId) ?? (event.sourceUserId == member.userId)
                }.map(\.userId)
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
                        generated.insert("\(routine.id):\(updated.routineOccurrenceDate!)")
                        return updated
                    }
                }
            }
        case "saveTemplate":
            let snapshot = planner(weekStart: week)
            let items = (snapshot.weeklyItems + snapshot.days.flatMap(\.items)).filter { $0.routineId == nil }.map {
                WeekTemplate.Item(dayOffset: $0.planningDate.map { WeekDate.daysBetween(week, $0) }, type: $0.type, text: $0.text, childId: $0.childId)
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
                    insert(.init(id: "\(key):\(index)", planningDate: item.dayOffset.map { WeekDate.addDays($0, to: week) }, weekStartDate: week, type: item.type, text: item.text, isCompleted: false, sortOrder: index, createdBy: PreviewData.user.userId, createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved", reminder: nil, childId: item.childId), into: &value)
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
