import XCTest
@testable import CommonWeek

final class WeekDateTests: XCTestCase {
    func testAddsDaysWithoutChangingDateShape() {
        XCTAssertEqual(WeekDate.addDays(6, to: "2026-08-10"), "2026-08-16")
    }

    func testWeekTitleUsesACompactSameMonthRange() {
        XCTAssertEqual(WeekDate.weekTitle("2026-08-10"), "August 10–16")
    }

    func testTodayComparisonDoesNotShiftDateAtEasternMidnight() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        let today = formatter.string(from: Date())
        XCTAssertTrue(WeekDate.isToday(today, timeZoneIdentifier: "America/New_York"))
        XCTAssertFalse(WeekDate.isToday(WeekDate.addDays(1, to: today), timeZoneIdentifier: "America/New_York"))
    }

    func testCalendarDateKeepsTheSelectedDayInTheHouseholdTimeZone() {
        let date = WeekDate.calendarDate(
            "2026-08-15",
            hour: 9,
            timeZoneIdentifier: "America/New_York"
        )
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!

        XCTAssertEqual(calendar.component(.day, from: date), 15)
        XCTAssertEqual(calendar.component(.hour, from: date), 9)
        XCTAssertEqual(
            WeekDate.string(date, timeZoneIdentifier: "America/New_York"),
            "2026-08-15"
        )
    }

    func testCalendarDateRoundTripsAheadOfUTC() {
        let date = WeekDate.calendarDate(
            "2026-08-15",
            timeZoneIdentifier: "Asia/Tokyo"
        )

        XCTAssertEqual(
            WeekDate.string(date, timeZoneIdentifier: "Asia/Tokyo"),
            "2026-08-15"
        )
    }

    func testPreviewContainsACompleteWeek() {
        XCTAssertEqual(PreviewData.planner.days.count, 7)
        XCTAssertFalse(PreviewData.planner.editableCalendars.isEmpty)
    }

    func testSessionIdentityDecodesGoogleAvatarURL() throws {
        let payload = Data(#"{"userId":"user","email":"jim@example.com","displayName":"Jim","avatarUrl":"https://lh3.googleusercontent.com/avatar","householdId":"household","role":"owner"}"#.utf8)
        let identity = try JSONDecoder().decode(SessionIdentity.self, from: payload)

        XCTAssertEqual(identity.avatarUrl?.host, "lh3.googleusercontent.com")
    }

    func testCalendarSettingsDecodeNativeManagementState() throws {
        let payload = Data(##"{"calendars":[{"id":"calendar-1","userId":"user-1","googleCalendarId":"family@example.com","calendarName":"Family","displayAlias":"Home","displayAbbreviation":"HM","color":"#123456","visibility":"share","isPrimary":true,"sectionGroup":"critical","accessRole":"owner"}],"connected":true,"writeEnabled":true}"##.utf8)
        let settings = try JSONDecoder().decode(CalendarSettings.self, from: payload)

        XCTAssertTrue(settings.connected)
        XCTAssertTrue(settings.writeEnabled)
        XCTAssertEqual(settings.calendars.first?.visibility, .share)
        XCTAssertEqual(settings.calendars.first?.displayAlias, "Home")
    }

    func testCalendarPreferenceUpdateEncodesTheNativeAction() throws {
        let calendar = CalendarPreference(id: "calendar-1", userId: "user-1", googleCalendarId: "family@example.com", calendarName: "Family", displayAlias: "Home", displayAbbreviation: "HM", color: "#123456", visibility: .private, isPrimary: true, sectionGroup: .supplemental, accessRole: "owner")
        let encoded = try JSONEncoder().encode(CalendarPreferenceUpdate(calendar))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: String])

        XCTAssertEqual(payload["action"], "updateCalendar")
        XCTAssertEqual(payload["visibility"], "private")
        XCTAssertEqual(payload["sectionGroup"], "supplemental")
    }

    func testGeocodingResultBuildsAReadableAssignmentName() throws {
        let payload = Data(#"{"id":"2988507","name":"Paris","admin1":"Île-de-France","country":"France","latitude":48.8566,"longitude":2.3522,"timezone":"Europe/Paris"}"#.utf8)
        let result = try JSONDecoder().decode(GeocodingResult.self, from: payload)

        XCTAssertEqual(result.assignmentName, "Paris, Île-de-France")
        XCTAssertEqual(result.detailName, "Île-de-France, France")
    }

    func testGeocodedLocationAssignmentPreservesTheReuseChoice() throws {
        let result = GeocodingResult(id: "2988507", name: "Paris", admin1: "Île-de-France", country: "France", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris")
        let request = GeocodedLocationAssignmentRequest(date: "2026-08-14", scope: "day", result: result, saveForReuse: false)
        let encoded = try JSONEncoder().encode(request)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let location = try XCTUnwrap(payload["location"] as? [String: Any])

        XCTAssertEqual(payload["startDate"] as? String, "2026-08-14")
        XCTAssertEqual(payload["scope"] as? String, "day")
        XCTAssertEqual(payload["saveForReuse"] as? Bool, false)
        XCTAssertEqual(location["name"] as? String, "Paris, Île-de-France")
    }

    func testEventLocationSuggestionDecodesGooglePlacePresentation() throws {
        let payload = Data(#"{"placeId":"place-1","primaryText":"Yankee Stadium","secondaryText":"East 161st Street, Bronx, NY, USA","fullText":"Yankee Stadium, East 161st Street, Bronx, NY, USA"}"#.utf8)
        let suggestion = try JSONDecoder().decode(EventLocationSuggestion.self, from: payload)

        XCTAssertEqual(suggestion.id, "place-1")
        XCTAssertEqual(suggestion.primaryText, "Yankee Stadium")
        XCTAssertEqual(suggestion.fullText, "Yankee Stadium, East 161st Street, Bronx, NY, USA")
    }

    func testOfflineStoreKeepsSnapshotsIsolatedByAccount() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "week-of-us-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflineStore(directory: directory)
        let planner = PreviewData.planner

        try await store.savePlanner(planner, userId: "user-a")

        let restored = await store.cachedPlanner(userId: "user-a", weekStart: planner.weekStart)
        let otherAccount = await store.cachedPlanner(userId: "user-b", weekStart: planner.weekStart)
        XCTAssertEqual(restored?.weekStart, planner.weekStart)
        XCTAssertNil(otherAccount)
    }

    func testOfflineMutationQueueSurvivesAStoreReloadAndRemovesOneAtATime() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "week-of-us-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstStore = OfflineStore(directory: directory)
        let mutation = OfflineMutation(
            kind: .toggleItem,
            itemId: "00000000-0000-4000-8000-000000000001",
            completed: true
        )
        try await firstStore.enqueue(mutation, userId: "user-a")

        let reloadedStore = OfflineStore(directory: directory)
        let userAMutations = await reloadedStore.pendingMutations(userId: "user-a")
        let userBMutations = await reloadedStore.pendingMutations(userId: "user-b")
        XCTAssertEqual(userAMutations.map(\.id), [mutation.id])
        XCTAssertEqual(userAMutations.map(\.kind), [.toggleItem])
        XCTAssertEqual(userAMutations.first?.completed, true)
        XCTAssertTrue(userBMutations.isEmpty)

        try await reloadedStore.removeMutation(mutation.id, userId: "user-a")
        let remaining = await reloadedStore.pendingMutations(userId: "user-a")
        XCTAssertTrue(remaining.isEmpty)
    }

    func testDailyCarryoverMovesOnlyOpenTasksAndPreservesIdentityAndReminder() {
        var planner = PreviewData.planner(weekStart: "2026-08-24")
        let reminder = NotificationReminder(id: "reminder-1", resourceKind: "planning_item", remindAt: "2026-08-24T13:00:00Z")
        for index in planner.days.indices { planner.days[index].items = [] }
        planner.days[0].items = [
            planningItem(id: "open", date: "2026-08-24", week: planner.weekStart, type: .task, reminder: reminder),
            planningItem(id: "done", date: "2026-08-24", week: planner.weekStart, type: .task, completed: true),
            planningItem(id: "note", date: "2026-08-24", week: planner.weekStart, type: .note),
        ]

        let carried = planner.carryingOpenTasks(
            to: "2026-08-27",
            at: Date(timeIntervalSince1970: 1_777_800_000)
        )

        XCTAssertEqual(carried.days[3].items.map(\.id), ["open"])
        XCTAssertEqual(carried.days[3].items.first?.planningDate, "2026-08-27")
        XCTAssertEqual(carried.days[3].items.first?.originalPlanningDate, "2026-08-24")
        XCTAssertEqual(carried.days[3].items.first?.originalWeekStartDate, "2026-08-24")
        XCTAssertEqual(carried.days[3].items.first?.carryoverCount, 3)
        XCTAssertEqual(carried.days[3].items.first?.reminder, reminder)
        XCTAssertEqual(carried.days[0].items.map(\.id), ["done", "note"])
    }

    func testCarryoverCrossesWeeksAndContinuesAcrossAMultiWeekGap() {
        var planner = PreviewData.planner(weekStart: "2026-08-10")
        for index in planner.days.indices { planner.days[index].items = [] }
        planner.days[1].items = [
            planningItem(id: "daily", date: "2026-08-11", week: planner.weekStart, type: .task),
            planningItem(id: "completed", date: "2026-08-11", week: planner.weekStart, type: .task, completed: true),
            planningItem(id: "plan", date: "2026-08-11", week: planner.weekStart, type: .note),
        ]
        planner.weeklyItems = [
            planningItem(id: "weekly", date: nil, week: planner.weekStart, type: .task),
            planningItem(id: "weekly-done", date: nil, week: planner.weekStart, type: .task, completed: true),
            planningItem(id: "weekly-note", date: nil, week: planner.weekStart, type: .note),
        ]

        let carried = planner.carryingOpenTasks(to: "2026-08-27")

        XCTAssertEqual(carried.weekStart, "2026-08-24")
        XCTAssertEqual(carried.days.count, 7)
        XCTAssertEqual(carried.days[3].items.map(\.id), ["daily"])
        XCTAssertEqual(carried.days[3].items.first?.carryoverCount, 16)
        XCTAssertEqual(carried.weeklyItems.map(\.id), ["weekly"])
        XCTAssertEqual(carried.weeklyItems.first?.weekStartDate, "2026-08-24")
        XCTAssertEqual(carried.weeklyItems.first?.carryoverCount, 2)
        XCTAssertTrue(carried.days.flatMap(\.items).allSatisfy { !$0.isCompleted && $0.type == .task })
    }

    func testLocalCarryoverIsIdempotentAndThenAdvancesAgain() {
        var planner = PreviewData.planner(weekStart: "2026-08-24")
        for index in planner.days.indices { planner.days[index].items = [] }
        planner.days[0].items = [
            planningItem(id: "daily", date: "2026-08-24", week: planner.weekStart, type: .task)
        ]

        let thursday = planner.carryingOpenTasks(to: "2026-08-27")
        let repeated = thursday.carryingOpenTasks(to: "2026-08-27")
        let friday = repeated.carryingOpenTasks(to: "2026-08-28")

        XCTAssertEqual(repeated.days[3].items.first?.carryoverCount, 3)
        XCTAssertEqual(friday.days[4].items.first?.id, "daily")
        XCTAssertEqual(friday.days[4].items.first?.carryoverCount, 4)
        XCTAssertEqual(friday.days.flatMap(\.items).filter { $0.id == "daily" }.count, 1)
    }

    func testPlanningItemDecodesForOlderCachedSnapshotsWithoutCarryoverFields() throws {
        let payload = Data(#"{"id":"task","planningDate":"2026-08-24","weekStartDate":"2026-08-24","type":"task","text":"Pack","isCompleted":false,"sortOrder":0,"createdBy":"user","createdByName":"Jim","updatedAt":"2026-08-24T12:00:00Z","saveState":"saved","reminder":null}"#.utf8)

        let item = try JSONDecoder().decode(PlanningItem.self, from: payload)

        XCTAssertNil(item.originalPlanningDate)
        XCTAssertNil(item.originalWeekStartDate)
        XCTAssertNil(item.carryoverCount)
        XCTAssertNil(item.lastCarriedAt)
    }

    func testAppleReminderPlacementMatchesDailyCarryoverWithoutChangingDueDate() {
        let placement = AppleReminderPlacement.resolve(
            dueDate: "2026-08-24",
            isCompleted: false,
            visibleWeekStart: "2026-08-24",
            currentWeekStart: "2026-08-24",
            today: "2026-08-27"
        )

        XCTAssertEqual(placement?.displayDate, "2026-08-27")
        XCTAssertEqual(placement?.carryoverCount, 3)
    }

    func testAppleReminderPlacementDoesNotCarryCompletedOrHistoricalReminders() {
        XCTAssertNil(AppleReminderPlacement.resolve(
            dueDate: "2026-08-17",
            isCompleted: true,
            visibleWeekStart: "2026-08-24",
            currentWeekStart: "2026-08-24",
            today: "2026-08-27"
        ))
        XCTAssertNil(AppleReminderPlacement.resolve(
            dueDate: "2026-08-17",
            isCompleted: false,
            visibleWeekStart: "2026-08-10",
            currentWeekStart: "2026-08-24",
            today: "2026-08-27"
        ))
    }

    func testAppleReminderCompletedAfterItsDueDateRemainsOnItsCarriedDay() {
        let placement = AppleReminderPlacement.resolve(
            dueDate: "2026-08-17",
            isCompleted: true,
            completionDate: "2026-08-27",
            visibleWeekStart: "2026-08-24",
            currentWeekStart: "2026-08-24",
            today: "2026-08-27"
        )

        XCTAssertEqual(placement?.displayDate, "2026-08-27")
        XCTAssertEqual(placement?.carryoverCount, 10)
    }

    func testWritableRecurringAppleReminderCanEditAndDeleteSeries() {
        let task = AppleReminderTask(
            id: "reminder-1",
            title: "Water plants",
            notes: "Use the watering can",
            url: "https://example.com/plants",
            priority: .medium,
            listId: "list-1",
            listTitle: "Home",
            dueDate: "2026-08-28",
            displayDate: "2026-08-28",
            dueAt: nil,
            dueTimeLabel: nil,
            isAllDay: true,
            isCompleted: false,
            canModify: true,
            isRecurring: true,
            carryoverCount: 0
        )

        XCTAssertTrue(task.canEditDetails)
        XCTAssertTrue(task.canDelete)
    }

    func testAppleReminderPriorityNormalizesEventKitValues() {
        XCTAssertEqual(AppleReminderPriority(eventKitValue: 0), .none)
        XCTAssertEqual(AppleReminderPriority(eventKitValue: 2), .high)
        XCTAssertEqual(AppleReminderPriority(eventKitValue: 5), .medium)
        XCTAssertEqual(AppleReminderPriority(eventKitValue: 8), .low)
    }

    func testOfflineStoreFindsTheMostRecentPriorSnapshotForCrossWeekCarryover() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "week-of-us-carryover-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflineStore(directory: directory)
        try await store.savePlanner(PreviewData.planner(weekStart: "2026-08-10"), userId: "user-a")
        try await store.savePlanner(PreviewData.planner(weekStart: "2026-08-17"), userId: "user-a")
        try await store.savePlanner(PreviewData.planner(weekStart: "2026-08-24"), userId: "user-b")

        let latest = await store.latestCachedPlanner(userId: "user-a", before: "2026-08-24")
        let noneBeforeFirst = await store.latestCachedPlanner(userId: "user-a", before: "2026-08-10")

        XCTAssertEqual(latest?.weekStart, "2026-08-17")
        XCTAssertNil(noneBeforeFirst)
    }

    private func planningItem(
        id: String,
        date: String?,
        week: String,
        type: PlanningItemType,
        completed: Bool = false,
        reminder: NotificationReminder? = nil
    ) -> PlanningItem {
        PlanningItem(
            id: id,
            planningDate: date,
            weekStartDate: week,
            type: type,
            text: id,
            isCompleted: completed,
            sortOrder: 0,
            createdBy: "user-a",
            createdByName: "Jim",
            updatedAt: "2026-08-24T12:00:00Z",
            saveState: "saved",
            reminder: reminder
        )
    }
}
