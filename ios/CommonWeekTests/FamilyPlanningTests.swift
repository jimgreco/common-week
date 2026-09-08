import XCTest
@testable import CommonWeek

final class FamilyPlanningTests: XCTestCase {
    func testChildAssignmentSurvivesOfflineQueueAndCanBeCleared() throws {
        let assigned = PlanningItemDraft(id: "task", text: "School bag", type: .task, planningDate: nil, weekStartDate: "2026-09-07", remindAt: nil, childId: "child")
        let cleared = PlanningItemDraft(id: "task", text: "School bag", type: .task, planningDate: nil, weekStartDate: "2026-09-07", remindAt: nil, childId: nil, childAssignmentIsSet: true)
        for draft in [assigned, cleared] {
            let mutation = OfflineMutation(kind: .updateItem, draft: draft)
            let restored = try JSONDecoder().decode(OfflineMutation.self, from: JSONEncoder().encode(mutation))
            XCTAssertEqual(restored.draft, draft)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(restored.draft!)) as? [String: Any])
            if draft.childId == nil { XCTAssertTrue(payload["childId"] is NSNull) }
            else { XCTAssertEqual(payload["childId"] as? String, "child") }
        }
    }

    func testLegacyOfflineDraftDoesNotClearChildAssignment() throws {
        let legacy = Data(#"{"id":"task","text":"School bag","type":"task","weekStartDate":"2026-09-07"}"#.utf8)
        let draft = try JSONDecoder().decode(PlanningItemDraft.self, from: legacy)
        XCTAssertFalse(draft.childAssignmentIsSet)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        XCTAssertNil(payload["childId"])
    }

    func testChildScheduleUsesLinkedCalendarsAndExplicitTaskTag() {
        let planner = PreviewData.planner(weekStart: "2026-09-07")
        let child = ChildProfile(id: "child", name: "Miriam", color: "#688173", calendarPreferenceIds: ["calendar-family"])
        let day = planner.days[3]
        XCTAssertEqual(ChildSchedule.events(for: child, in: day).map(\.calendarPreferenceId), ["calendar-family"])
        var tagged = day.items[0]
        tagged.childId = child.id
        XCTAssertEqual(ChildSchedule.items(for: child, in: day.items + [tagged]).map(\.id), [tagged.id])
    }

    func testRoutineProvenanceSurvivesPlannerCacheAndCarryover() throws {
        var planner = PreviewData.planner(weekStart: "2026-09-07")
        var task = planner.weeklyItems[0]
        task.childId = "child"; task.routineId = "routine"; task.routineOccurrenceDate = "2026-09-07"
        planner.weeklyItems = [task]
        let cached = try JSONDecoder().decode(WeeklyPlannerData.self, from: JSONEncoder().encode(planner))
        let carried = cached.carryingOpenTasks(to: "2026-09-14").weeklyItems[0]
        XCTAssertEqual(carried.id, task.id)
        XCTAssertEqual(carried.childId, "child")
        XCTAssertEqual(carried.routineId, "routine")
        XCTAssertEqual(carried.routineOccurrenceDate, "2026-09-07")
    }

    func testSundayPlanningDestinationOpensSelectedWeekReview() {
        XCTAssertEqual(NotificationCoordinator.plannerDestination(for: "/planner?week=2026-09-14&review=1"), .init(weekStart: "2026-09-14", target: .weeklyReview))
        XCTAssertNil(NotificationCoordinator.plannerDestination(for: "/planner?review=1"))
    }

    func testReviewTimestampAcceptsServerFractionalSecondsAndLegacyDates() {
        XCTAssertNotNil(WeeklyReview.Reviewer(userId: "user", displayName: "Alex", reviewedAt: "2026-09-08T01:06:20.123Z").date)
        XCTAssertNotNil(WeeklyReview.Reviewer(userId: "user", displayName: "Alex", reviewedAt: "2026-09-08T01:06:20Z").date)
    }

    @MainActor
    func testDailyRoutineKeepsWeekdayRestrictionOnRoundTripAndInOccurrences() throws {
        let routine = TaskRoutine(id: "daily-school", text: "School bag", childId: nil, frequency: "daily", interval: 1, weekdays: [0, 1, 2, 3, 4], startsOn: "2026-10-05", endsOn: nil, active: true)
        let decoded = try JSONDecoder().decode(TaskRoutine.self, from: JSONEncoder().encode(routine))
        XCTAssertEqual(decoded.weekdays, [0, 1, 2, 3, 4])
        XCTAssertEqual(decoded.scheduleDescription, "Every day · Mon, Tue, Wed, Thu, Fri")
        let demo = FamilyPlanningDemo()
        _ = try demo.apply(.init(action: "saveRoutine", weekStart: "2026-10-05", routine: decoded))
        let week = demo.planner(weekStart: "2026-10-05")
        XCTAssertEqual(week.days.flatMap(\.items).filter { $0.routineId == routine.id }.count, 5)
        XCTAssertFalse(week.days[5].items.contains { $0.routineId == routine.id })
        XCTAssertFalse(week.days[6].items.contains { $0.routineId == routine.id })
    }

    @MainActor
    func testDemoTemplatesAndRoutinesPersistAcrossWeeksWithoutDuplicateOccurrences() throws {
        let demo = FamilyPlanningDemo()
        let week = "2026-10-05"
        let child = ChildProfile(id: UUID().uuidString, name: "Alex", color: "#688173", calendarPreferenceIds: [])
        _ = try demo.apply(.init(action: "saveChild", weekStart: week, child: child))
        let routine = TaskRoutine(id: UUID().uuidString, text: "School bag", childId: child.id, frequency: "weekly", interval: 1, weekdays: [0, 2, 4], startsOn: week, endsOn: nil, active: true)
        _ = try demo.apply(.init(action: "saveRoutine", weekStart: week, routine: routine))
        let first = demo.planner(weekStart: week)
        let second = demo.planner(weekStart: week, capturing: first)
        XCTAssertEqual(second.days.flatMap(\.items).filter { $0.routineId == routine.id }.count, 3)
        let templateId = UUID().uuidString
        _ = try demo.apply(.init(action: "saveTemplate", weekStart: week, id: templateId, name: "School week"))
        let nextWeek = "2026-10-12"
        let countBefore = demo.planner(weekStart: nextWeek).weeklyItems.count
        _ = try demo.apply(.init(action: "applyTemplate", weekStart: nextWeek, id: templateId))
        let appliedCount = demo.planner(weekStart: nextWeek).weeklyItems.count
        _ = try demo.apply(.init(action: "applyTemplate", weekStart: nextWeek, id: templateId))
        XCTAssertGreaterThan(appliedCount, countBefore)
        XCTAssertEqual(demo.planner(weekStart: nextWeek).weeklyItems.count, appliedCount)
        XCTAssertEqual(demo.data(weekStart: nextWeek).children.first(where: { $0.id == child.id })?.name, "Alex")
        XCTAssertEqual(demo.planner(weekStart: nextWeek).days.flatMap(\.items).filter { $0.routineId == routine.id }.count, 3)
    }

    @MainActor
    func testEditingReviewInvalidatesAcknowledgementsAndRejectsStaleRevision() throws {
        let demo = FamilyPlanningDemo()
        let week = "2026-10-05"
        _ = try demo.apply(.init(action: "markReviewed", weekStart: week, revision: 0, reviewed: true))
        XCTAssertEqual(demo.data(weekStart: week).review.reviewedBy.count, 1)
        XCTAssertEqual(demo.data(weekStart: week).review.revision, 0)
        _ = try demo.apply(.init(action: "saveReview", weekStart: week, priorities: "New plan", meals: "", logistics: "", revision: 0))
        XCTAssertEqual(demo.data(weekStart: week).review.reviewedBy.count, 0)
        XCTAssertThrowsError(try demo.apply(.init(action: "markReviewed", weekStart: week, revision: 0, reviewed: true)))
    }
}
