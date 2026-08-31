import Foundation
import EventKit
import XCTest
@testable import CommonWeek

final class AppleRemindersStoreTests: XCTestCase {
    @MainActor
    func testMacNavigationClearsInspectorSelectionWhenChangingSections() {
        let navigation = MacPlannerNavigation(selectedDay: "2026-08-30")

        navigation.selectPlanningItem("task-1")
        XCTAssertEqual(navigation.selection, .planningItem("task-1"))

        navigation.select(.appleReminders)
        XCTAssertEqual(navigation.section, .appleReminders)
        XCTAssertNil(navigation.selection)

        navigation.selectDay("2026-08-31")
        XCTAssertEqual(navigation.section, .week)
        XCTAssertEqual(navigation.selectedDay, "2026-08-31")
        XCTAssertNil(navigation.selection)
    }

    @MainActor
    func testMacNavigationRestoresSectionDayAndInspectorSelectionPerUser() {
        let suite = "week-of-us-navigation-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let key = "mac-navigation.user-1"
        let navigation = MacPlannerNavigation(defaults: defaults, persistenceKey: key)

        navigation.select(.appleReminders)
        navigation.selectedDay = "2026-08-31"
        navigation.selectAppleReminder("reminder-1")

        let restored = MacPlannerNavigation(defaults: defaults, persistenceKey: key)
        XCTAssertEqual(restored.section, .appleReminders)
        XCTAssertEqual(restored.selectedDay, "2026-08-31")
        XCTAssertEqual(restored.selection, .appleReminder("reminder-1"))
    }

    @MainActor
    func testMacUnsavedChangesRequireExplicitDiscardBeforeNavigation() {
        let coordinator = MacUnsavedChangesCoordinator()
        coordinator.setDirty(true)

        XCTAssertNil(coordinator.request(.section(.events)))
        XCTAssertTrue(coordinator.requiresConfirmation)
        XCTAssertEqual(coordinator.discardChanges(), .section(.events))
        XCTAssertFalse(coordinator.isDirty)
    }

    func testMacDragPayloadRoundTripsIdentifiersContainingColons() {
        let payload = MacPlannerDragPayload.appleReminder("local:calendar:item-1")
        XCTAssertEqual(MacPlannerDragPayload(encoded: payload.encoded), payload)
    }

    @MainActor
    func testSelectedListFilteringDueDatePlacementCarryoverAndReadOnlyState() async {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let week = WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
        let writable = AppleReminderList(id: "writable", title: "Family", sourceTitle: "iCloud", canModify: true)
        let readOnly = AppleReminderList(id: "readonly", title: "Shared", sourceTitle: "iCloud", canModify: false)
        let unselected = AppleReminderList(id: "other", title: "Other", sourceTitle: "Local", canModify: true)
        let client = FakeAppleRemindersClient(
            lists: [writable, readOnly, unselected],
            records: [
                record(id: "today", list: writable, dueDate: today),
                record(id: "overdue", list: writable, dueDate: WeekDate.addDays(-1, to: today)),
                record(id: "read-only", list: readOnly, dueDate: today),
                record(id: "not-selected", list: unselected, dueDate: today),
                record(id: "undated", list: writable, dueDate: nil),
            ]
        )
        let store = makeStore(client: client)

        await store.activate(userId: "user", weekStart: week, timeZoneIdentifier: timeZone)
        await store.setList(writable.id, selected: true)

        XCTAssertEqual(client.lastRequestedListIds, [writable.id])
        XCTAssertEqual(Set(store.tasks.map(\.id)), ["today", "overdue"])
        XCTAssertFalse(store.tasks.contains(where: { $0.id == "undated" }))
        let overdue = try? XCTUnwrap(store.tasks.first(where: { $0.id == "overdue" }))
        XCTAssertEqual(overdue?.dueDate, WeekDate.addDays(-1, to: today))
        XCTAssertEqual(overdue?.displayDate, today)
        XCTAssertEqual(overdue?.carryoverCount, 1)

        await store.setList(readOnly.id, selected: true)

        XCTAssertEqual(client.lastRequestedListIds, [writable.id, readOnly.id])
        let readOnlyTask = try? XCTUnwrap(store.tasks.first(where: { $0.id == "read-only" }))
        XCTAssertEqual(readOnlyTask?.canModify, false)
        XCTAssertFalse(store.tasks.contains(where: { $0.id == "not-selected" }))
    }

    @MainActor
    func testReminderCreateEditMoveToggleDeleteAndRecurrencePreservation() async throws {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let week = WeekDate.currentWeekStart(timeZoneIdentifier: timeZone)
        let first = AppleReminderList(id: "first", title: "Family", sourceTitle: "iCloud", canModify: true)
        let second = AppleReminderList(id: "second", title: "Work", sourceTitle: "iCloud", canModify: true)
        let client = FakeAppleRemindersClient(
            lists: [first, second],
            records: [record(id: "recurring", list: first, dueDate: today, isRecurring: true)]
        )
        let store = makeStore(client: client)
        await store.activate(userId: "user", weekStart: week, timeZoneIdentifier: timeZone)
        await store.setList(first.id, selected: true)
        await store.setList(second.id, selected: true)
        let recurring = try XCTUnwrap(store.tasks.first(where: { $0.id == "recurring" }))
        let due = WeekDate.calendarDate(today, hour: 14, timeZoneIdentifier: timeZone)

        try await store.createReminder(
            title: "Created",
            listId: first.id,
            dueDate: due,
            includesTime: true,
            timeZoneIdentifier: timeZone,
            notes: " Details ",
            url: URL(string: "https://weekofus.com/new"),
            priority: .medium
        )
        XCTAssertEqual(client.createdTitles, ["Created"])
        let created = try XCTUnwrap(client.records.first(where: { $0.title == "Created" }))
        XCTAssertEqual(created.notes, "Details")
        XCTAssertEqual(created.url?.absoluteString, "https://weekofus.com/new")
        XCTAssertEqual(created.priority, AppleReminderPriority.medium.rawValue)

        try await store.update(
            recurring,
            title: "Updated",
            notes: " Keep this ",
            url: URL(string: "https://weekofus.com"),
            priority: .high,
            listId: second.id,
            dueDate: due,
            includesTime: true,
            timeZoneIdentifier: timeZone
        )

        let updated = try XCTUnwrap(client.records.first(where: { $0.id == recurring.id }))
        XCTAssertEqual(updated.title, "Updated")
        XCTAssertEqual(updated.notes, "Keep this")
        XCTAssertEqual(updated.listId, second.id)
        XCTAssertEqual(updated.priority, AppleReminderPriority.high.rawValue)
        XCTAssertTrue(updated.isRecurring, "Editing metadata must preserve the existing recurrence rules")

        await store.toggle(try XCTUnwrap(store.tasks.first(where: { $0.id == recurring.id })))
        XCTAssertTrue(try XCTUnwrap(client.records.first(where: { $0.id == recurring.id })).isCompleted)

        try await store.delete(try XCTUnwrap(store.tasks.first(where: { $0.id == recurring.id })))
        XCTAssertFalse(client.records.contains(where: { $0.id == recurring.id }))
    }

    @MainActor
    func testNewReminderRecurrenceIsForwardedWhileExistingRecurrenceIsPreserved() async throws {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let list = AppleReminderList(id: "family", title: "Family", sourceTitle: "iCloud", canModify: true)
        let client = FakeAppleRemindersClient(
            lists: [list],
            records: [record(id: "existing", list: list, dueDate: today, isRecurring: true)]
        )
        let store = makeStore(client: client)
        await store.activate(
            userId: "user",
            weekStart: WeekDate.currentWeekStart(timeZoneIdentifier: timeZone),
            timeZoneIdentifier: timeZone
        )
        await store.setList(list.id, selected: true)
        let dueDate = WeekDate.calendarDate(today, hour: 9, timeZoneIdentifier: timeZone)
        let recurrence = AppleReminderRecurrence(
            frequency: .weekly,
            interval: 2,
            weekdays: [.monday, .wednesday, .friday],
            end: .afterOccurrences(12)
        )

        try await store.createReminder(
            title: "Recurring",
            listId: list.id,
            dueDate: dueDate,
            includesTime: true,
            timeZoneIdentifier: timeZone,
            recurrence: recurrence
        )

        XCTAssertEqual(client.lastCreatedMutation?.recurrence, recurrence)
        XCTAssertTrue(try XCTUnwrap(client.records.first(where: { $0.title == "Recurring" })).isRecurring)

        let existing = try XCTUnwrap(store.tasks.first(where: { $0.id == "existing" }))
        try await store.update(
            existing,
            title: "Still recurring",
            notes: "",
            url: nil,
            priority: .none,
            listId: list.id,
            dueDate: dueDate,
            includesTime: true,
            timeZoneIdentifier: timeZone
        )
        XCTAssertNil(client.lastUpdatedMutation?.recurrence)
        XCTAssertTrue(try XCTUnwrap(client.records.first(where: { $0.id == "existing" })).isRecurring)
    }

    func testRecurrenceDraftDefaultsWeeklyCreationToDueWeekday() throws {
        var draft = AppleReminderRecurrenceDraft()
        draft.isEnabled = true
        draft.frequency = .weekly
        draft.weekdays = []
        let timeZone = "America/New_York"
        let monday = WeekDate.calendarDate("2026-08-31", hour: 9, timeZoneIdentifier: timeZone)

        let recurrence = try XCTUnwrap(draft.recurrence(starting: monday, timeZoneIdentifier: timeZone))

        XCTAssertEqual(recurrence.weekdays, [.monday])
        XCTAssertNoThrow(try recurrence.validate(starting: monday, timeZoneIdentifier: timeZone))
    }

    @MainActor
    func testEventKitRecurrenceRuleMapsFrequencyWeekdaysIntervalAndEnd() throws {
        let recurrence = AppleReminderRecurrence(
            frequency: .weekly,
            interval: 3,
            weekdays: [.tuesday, .thursday],
            end: .afterOccurrences(8)
        )

        let rule = EventKitAppleRemindersClient.recurrenceRule(from: recurrence)

        XCTAssertEqual(rule.frequency, EKRecurrenceFrequency.weekly)
        XCTAssertEqual(rule.interval, 3)
        XCTAssertEqual(rule.daysOfTheWeek?.map(\.dayOfTheWeek), [.tuesday, .thursday])
        XCTAssertEqual(rule.recurrenceEnd?.occurrenceCount, 8)
    }

    @MainActor
    func testEventKitRecurrenceRuleMapsDailyMonthlyAndYearlySchedules() {
        let expected: [(AppleReminderRecurrenceFrequency, EKRecurrenceFrequency)] = [
            (.daily, .daily),
            (.monthly, .monthly),
            (.yearly, .yearly),
        ]
        let endDate = Date(timeIntervalSince1970: 2_000_000)

        for (frequency, eventKitFrequency) in expected {
            let recurrence = AppleReminderRecurrence(
                frequency: frequency,
                interval: 2,
                weekdays: [],
                end: .onDate(endDate)
            )
            let rule = EventKitAppleRemindersClient.recurrenceRule(from: recurrence)
            XCTAssertEqual(rule.frequency, eventKitFrequency)
            XCTAssertEqual(rule.interval, 2)
            XCTAssertEqual(rule.recurrenceEnd?.endDate, endDate)
        }
    }

    func testRecurrenceRejectsEndDateBeforeDueDate() {
        let dueDate = Date(timeIntervalSince1970: 2_000_000)
        let recurrence = AppleReminderRecurrence(
            frequency: .daily,
            interval: 1,
            weekdays: [],
            end: .onDate(Date(timeIntervalSince1970: 1_000_000))
        )

        XCTAssertThrowsError(try recurrence.validate(starting: dueDate, timeZoneIdentifier: "UTC"))
    }

    @MainActor
    func testCustomTaskMigrationCreatesDueDatedReminderBeforeRetiringSource() async throws {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let list = AppleReminderList(id: "family", title: "Family", sourceTitle: "iCloud", canModify: true)
        let client = FakeAppleRemindersClient(lists: [list], records: [])
        let store = makeStore(client: client)
        await store.activate(
            userId: "user",
            weekStart: WeekDate.currentWeekStart(timeZoneIdentifier: timeZone),
            timeZoneIdentifier: timeZone
        )
        await store.setList(list.id, selected: true)
        var task = planningItem(id: "task", type: .task, date: today)
        task.isCompleted = true
        var retirementObservedCreatedReminder = false

        let result = try await store.migrateTask(
            task,
            listId: list.id,
            dueDate: WeekDate.calendarDate(today, hour: 9, timeZoneIdentifier: timeZone),
            includesTime: false,
            timeZoneIdentifier: timeZone,
            retireSource: {
                retirementObservedCreatedReminder = client.records.contains(where: { $0.title == task.text })
                return true
            }
        )

        XCTAssertEqual(result, .moved)
        XCTAssertTrue(retirementObservedCreatedReminder)
        XCTAssertNotNil(client.records.first?.dueDateComponents)
        XCTAssertTrue(try XCTUnwrap(client.records.first).isCompleted)
        XCTAssertNil(client.lastCreatedMutation?.recurrence)
    }

    @MainActor
    func testCustomTaskMigrationKeepsSourceWhenRetirementFails() async throws {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let list = AppleReminderList(id: "family", title: "Family", sourceTitle: "iCloud", canModify: true)
        let client = FakeAppleRemindersClient(lists: [list], records: [])
        let store = makeStore(client: client)
        await store.activate(
            userId: "user",
            weekStart: WeekDate.currentWeekStart(timeZoneIdentifier: timeZone),
            timeZoneIdentifier: timeZone
        )
        await store.setList(list.id, selected: true)

        let result = try await store.migrateTask(
            planningItem(id: "task", type: .task, date: today),
            listId: list.id,
            dueDate: WeekDate.calendarDate(today, hour: 9, timeZoneIdentifier: timeZone),
            includesTime: false,
            timeZoneIdentifier: timeZone,
            retireSource: { false }
        )

        XCTAssertEqual(result, .reminderCreatedSourceRetained)
        XCTAssertEqual(client.records.count, 1)
    }

    @MainActor
    func testReadOnlyListsRejectMutations() async throws {
        let timeZone = "America/New_York"
        let today = WeekDate.today(timeZoneIdentifier: timeZone)
        let readOnly = AppleReminderList(id: "readonly", title: "Shared", sourceTitle: "iCloud", canModify: false)
        let client = FakeAppleRemindersClient(
            lists: [readOnly],
            records: [record(id: "locked", list: readOnly, dueDate: today)]
        )
        let store = makeStore(client: client)
        await store.activate(
            userId: "user",
            weekStart: WeekDate.currentWeekStart(timeZoneIdentifier: timeZone),
            timeZoneIdentifier: timeZone
        )
        await store.setList(readOnly.id, selected: true)
        let task = try XCTUnwrap(store.tasks.first)

        do {
            try await store.createReminder(
                title: "Nope",
                listId: readOnly.id,
                dueDate: Date(),
                includesTime: false,
                timeZoneIdentifier: timeZone
            )
            XCTFail("Expected read-only creation to fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, AppleRemindersError.readOnly.localizedDescription)
        }

        do {
            try await store.update(
                task,
                title: "Nope",
                notes: "",
                url: nil,
                priority: .none,
                listId: readOnly.id,
                dueDate: Date(),
                includesTime: false,
                timeZoneIdentifier: timeZone
            )
            XCTFail("Expected read-only update to fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, AppleRemindersError.readOnly.localizedDescription)
        }

        do {
            try await store.delete(task)
            XCTFail("Expected read-only deletion to fail")
        } catch {
            XCTAssertEqual(error.localizedDescription, AppleRemindersError.readOnly.localizedDescription)
        }
    }

    func testSharedCopyIsPlatformNeutral() {
        for message in PlatformCopy.sharedMessages {
            XCTAssertFalse(message.localizedCaseInsensitiveContains("iPhone"), message)
        }
    }

    @MainActor
    func testMacActiveRefreshUsesAConservativeCadence() {
        XCTAssertEqual(BackgroundRefreshCoordinator.activeRefreshInterval, 15 * 60)
    }

    @MainActor
    private func makeStore(client: FakeAppleRemindersClient) -> AppleRemindersStore {
        let suite = "week-of-us-reminders-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return AppleRemindersStore(client: client, defaults: defaults)
    }

    private func record(
        id: String,
        list: AppleReminderList,
        dueDate: String?,
        isRecurring: Bool = false
    ) -> AppleReminderRecord {
        AppleReminderRecord(
            id: id,
            title: id,
            notes: nil,
            url: nil,
            priority: 0,
            listId: list.id,
            listTitle: list.title,
            dueDateComponents: dueDate.map(Self.dateComponents),
            completionDate: nil,
            isCompleted: false,
            canModify: list.canModify,
            isRecurring: isRecurring
        )
    }

    private static func dateComponents(_ date: String) -> DateComponents {
        let pieces = date.split(separator: "-").compactMap { Int($0) }
        return DateComponents(year: pieces[0], month: pieces[1], day: pieces[2])
    }

    private func planningItem(id: String, type: PlanningItemType, date: String?) -> PlanningItem {
        PlanningItem(
            id: id,
            planningDate: date,
            weekStartDate: date.map(WeekDate.weekStart) ?? WeekDate.currentWeekStart(timeZoneIdentifier: "UTC"),
            type: type,
            text: "Move me",
            isCompleted: false,
            sortOrder: 0,
            createdBy: "user",
            createdByName: "User",
            updatedAt: WeekDate.iso8601.string(from: Date()),
            saveState: "saved",
            reminder: nil
        )
    }
}

@MainActor
private final class FakeAppleRemindersClient: AppleRemindersClient {
    var access: AppleRemindersAccess = .fullAccess
    var changeNotificationObject: AnyObject? { nil }
    var lists: [AppleReminderList]
    var records: [AppleReminderRecord]
    var lastRequestedListIds: Set<String> = []
    var createdTitles: [String] = []
    var lastCreatedMutation: AppleReminderMutation?
    var lastUpdatedMutation: AppleReminderMutation?

    init(lists: [AppleReminderList], records: [AppleReminderRecord]) {
        self.lists = lists
        self.records = records
    }

    func requestAccess() async throws -> Bool {
        access = .fullAccess
        return true
    }

    func reminderLists() -> [AppleReminderList] { lists }

    func reminders(in listIds: Set<String>) async -> [AppleReminderRecord] {
        lastRequestedListIds = listIds
        return records.filter { listIds.contains($0.listId) }
    }

    func create(mutation: AppleReminderMutation) throws -> String {
        let list = try writableList(id: mutation.listId)
        createdTitles.append(mutation.title)
        lastCreatedMutation = mutation
        let components = Self.components(
            from: mutation.dueDate,
            includesTime: mutation.includesTime,
            timeZoneIdentifier: mutation.timeZoneIdentifier
        )
        let id = "created-\(records.count)"
        records.append(AppleReminderRecord(
            id: id,
            title: mutation.title,
            notes: mutation.notes,
            url: mutation.url,
            priority: mutation.priority,
            listId: list.id,
            listTitle: list.title,
            dueDateComponents: components,
            completionDate: nil,
            isCompleted: false,
            canModify: true,
            isRecurring: mutation.recurrence != nil
        ))
        return id
    }

    func update(id: String, mutation: AppleReminderMutation) throws {
        lastUpdatedMutation = mutation
        let index = try recordIndex(id: id)
        guard records[index].canModify else { throw AppleRemindersError.readOnly }
        let list = try writableList(id: mutation.listId)
        let previous = records[index]
        records[index] = AppleReminderRecord(
            id: previous.id,
            title: mutation.title,
            notes: mutation.notes,
            url: mutation.url,
            priority: mutation.priority,
            listId: list.id,
            listTitle: list.title,
            dueDateComponents: Self.components(
                from: mutation.dueDate,
                includesTime: mutation.includesTime,
                timeZoneIdentifier: mutation.timeZoneIdentifier
            ),
            completionDate: previous.completionDate,
            isCompleted: previous.isCompleted,
            canModify: true,
            isRecurring: previous.isRecurring
        )
    }

    func setCompleted(id: String, completed: Bool) throws {
        let index = try recordIndex(id: id)
        let previous = records[index]
        guard previous.canModify else { throw AppleRemindersError.readOnly }
        records[index] = AppleReminderRecord(
            id: previous.id,
            title: previous.title,
            notes: previous.notes,
            url: previous.url,
            priority: previous.priority,
            listId: previous.listId,
            listTitle: previous.listTitle,
            dueDateComponents: previous.dueDateComponents,
            completionDate: completed ? Date() : nil,
            isCompleted: completed,
            canModify: previous.canModify,
            isRecurring: previous.isRecurring
        )
    }

    func delete(id: String) throws {
        let index = try recordIndex(id: id)
        guard records[index].canModify else { throw AppleRemindersError.readOnly }
        records.remove(at: index)
    }

    private func writableList(id: String) throws -> AppleReminderList {
        guard let list = lists.first(where: { $0.id == id }) else {
            throw AppleRemindersError.listUnavailable
        }
        guard list.canModify else { throw AppleRemindersError.readOnly }
        return list
    }

    private func recordIndex(id: String) throws -> Int {
        guard let index = records.firstIndex(where: { $0.id == id }) else {
            throw AppleRemindersError.reminderUnavailable
        }
        return index
    }

    private static func components(
        from date: Date,
        includesTime: Bool,
        timeZoneIdentifier: String
    ) -> DateComponents {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        return calendar.dateComponents(
            includesTime ? [.year, .month, .day, .hour, .minute] : [.year, .month, .day],
            from: date
        )
    }
}
