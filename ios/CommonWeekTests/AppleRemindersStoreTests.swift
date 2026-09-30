import Combine
import EventKit
import Foundation
import XCTest
@testable import CommonWeek

final class AppleRemindersStoreTests: XCTestCase {
    @MainActor
    func testInlineEntryRetryKeepsTextIDAndWeeklyPlacement() async throws {
        let composer = MacInlineComposer()
        let placement = MacInlinePlacement(weekStart: "2026-09-28", date: nil, type: .note)
        let id = composer.begin(placement, after: "existing-plan")
        XCTAssertEqual(id, id.lowercased(), "Match PostgreSQL UUIDs so a refresh keeps the inline anchor")
        composer.setText("  Plan the weekend  ", for: id)
        await composer.submit(id, thenAddAnother: true) { _ in
            throw NSError(domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Try again"])
        }
        let failed = try XCTUnwrap(composer.drafts.first)
        XCTAssertEqual(failed.id, id)
        XCTAssertEqual(failed.text, "Plan the weekend")
        XCTAssertEqual(failed.error, "Try again")
        XCTAssertFalse(failed.isSaving)
        await composer.submit(id, thenAddAnother: true) { draft in
            XCTAssertEqual(draft.id, id)
            XCTAssertNil(draft.placement.date)
            XCTAssertEqual(draft.afterItemId, "existing-plan")
            return draft.id
        }
        let next = try XCTUnwrap(composer.drafts.first)
        XCTAssertNotEqual(next.id, id)
        XCTAssertEqual(next.afterItemId, id)
        XCTAssertEqual(next.placement, placement)
        XCTAssertEqual(next.text, "")
        XCTAssertEqual(composer.focusedID, next.id)
    }

    @MainActor
    func testInlineEntrySkipsBlankRowsAndDuplicateSubmits() async {
        let composer = MacInlineComposer()
        let placement = MacInlinePlacement(weekStart: "2026-09-28", date: "2026-09-30", type: .task)
        let blank = composer.begin(placement)
        composer.setText("   ", for: blank)
        await composer.submit(blank, thenAddAnother: true) { _ in XCTFail("Blank rows must not save"); return "" }
        XCTAssertTrue(composer.drafts.isEmpty)
        let id = composer.begin(placement)
        composer.setText("Buy milk", for: id)
        await composer.submit(id, thenAddAnother: true) { draft in
            await composer.submit(id, thenAddAnother: true) { _ in XCTFail("Save already in flight"); return "" }
            XCTAssertEqual(draft.placement.date, "2026-09-30")
            return draft.id
        }
        XCTAssertEqual(composer.drafts.count, 1)
    }

    @MainActor
    func testSlowInlineSaveDoesNotTakeFocusFromAnotherEntry() async {
        let composer = MacInlineComposer()
        let weekly = MacInlinePlacement(weekStart: "2026-09-28", date: nil, type: .note)
        let first = composer.begin(weekly)
        composer.setText("Weekend plan", for: first)
        var second: String?
        await composer.submit(first, thenAddAnother: true) { draft in
            second = composer.begin(MacInlinePlacement(weekStart: "2026-09-28", date: "2026-09-29", type: .task))
            return draft.id
        }
        XCTAssertEqual(composer.focusedID, second)
        XCTAssertEqual(composer.drafts.map(\.id), [second!])
    }

    @MainActor
    func testInlineDraftsKeepSeparateWeekAndProviderContexts() {
        let composer = MacInlineComposer()
        let weekly = MacInlinePlacement(weekStart: "2026-09-28", date: nil, type: .task)
        let first = composer.begin(weekly)
        composer.setText("Unfinished task", for: first)
        let reminder = MacInlinePlacement(weekStart: "2026-10-05", date: "2026-10-06", type: .task,
                                          destination: .appleReminders("personal"))
        composer.begin(reminder)
        XCTAssertEqual(composer.drafts.first?.text, "Unfinished task")
        XCTAssertEqual(composer.drafts.first?.placement, weekly)
        XCTAssertEqual(composer.drafts.last?.placement, reminder)
    }

    func testInlineInsertionAnchorSurvivesOfflineEncoding() throws {
        let draft = PlanningItemDraft(id: UUID().uuidString, text: "Plan", type: .note,
                                      planningDate: nil, weekStartDate: "2026-09-28", remindAt: nil,
                                      afterItemId: UUID().uuidString)
        let restored = try JSONDecoder().decode(PlanningItemDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(restored, draft)
    }

    #if targetEnvironment(macCatalyst)
    @MainActor
    func testDetailsPopoverReusesItsSessionWithoutReplacingTheOpenEditor() {
        let windows = MacDetailsPopoverStore()
        let original = PreviewData.planner
        let id = windows.open(selection: .planningItem("task-0"), data: original, userId: "user-1")
        var changed = original
        changed.weeklyItems.removeAll()
        let reopened = windows.open(selection: .planningItem("task-0"), data: changed, userId: "user-1")
        XCTAssertEqual(reopened, id)
        XCTAssertEqual(windows.sessions[id]?.data.weeklyItems.count, original.weeklyItems.count)
        let other = windows.open(selection: .event("event-0"), data: changed, userId: "user-1")
        XCTAssertNotEqual(other, id)
        XCTAssertEqual(windows.sessions[id]?.selection, .planningItem("task-0"))
        windows.remove(id)
        XCTAssertNil(windows.sessions[id])
        XCTAssertNotNil(windows.sessions[other])
    }

    @MainActor
    func testDetailsPopoverUsesVisibleItemAndFallsBackForOffscreenResults() {
        let popover = MacDetailsPopoverStore()
        let selection = MacPlannerSelection.planningItem("task-0")
        popover.visibleAnchors.insert(selection)
        let anchored = popover.open(selection: selection, data: PreviewData.planner, userId: "user-1")
        XCTAssertEqual(popover.presentedAnchor, selection)
        XCTAssertEqual(popover.presentedID, anchored)
        popover.remove(anchored)
        XCTAssertNil(popover.presentedID)

        popover.visibleAnchors.remove(selection)
        let fallback = popover.open(selection: selection, data: PreviewData.planner, userId: "user-1")
        XCTAssertNil(popover.presentedAnchor)
        XCTAssertEqual(popover.presentedID, fallback)
        // A delayed dismissal from an older presentation must leave the new one open.
        popover.remove(anchored)
        XCTAssertEqual(popover.presentedID, fallback)
    }

    @MainActor
    func testDetailsAnchorSurvivesOverlappingViewLifetimes() {
        let popover = MacDetailsPopoverStore()
        let event = MacPlannerSelection.event("event-0")
        let list = UUID(), calendar = UUID()
        popover.registerAnchor(event, id: list)
        popover.registerAnchor(event, id: calendar)
        popover.unregisterAnchor(id: list)
        popover.open(selection: event, data: PreviewData.planner, userId: "user-1")
        XCTAssertEqual(popover.presentedAnchor, event)
        popover.unregisterAnchor(id: calendar)
        XCTAssertFalse(popover.visibleAnchors.contains(event))
    }

    @MainActor
    func testDetailsPopoverDoesNotReuseAnotherAccountsSession() {
        let windows = MacDetailsPopoverStore()
        let first = windows.open(selection: .planningItem("task-0"), data: PreviewData.planner, userId: "user-1")
        let second = windows.open(selection: .planningItem("task-0"), data: PreviewData.planner, userId: "user-2")
        XCTAssertNotEqual(first, second)
    }
    #endif

    @MainActor
    func testSavingOpenDetailsAfterNavigatingWeeksPreservesItemMetadata() async throws {
        let previousDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"]
        setenv("COMMON_WEEK_DEMO", "1", 1)
        let model = PlannerViewModel()
        if let previousDemo { setenv("COMMON_WEEK_DEMO", previousDemo, 1) }
        else { unsetenv("COMMON_WEEK_DEMO") }
        let originalData = PreviewData.planner
        var item = try XCTUnwrap(originalData.days.flatMap(\.items).first { $0.type == .task })
        item.isCompleted = true
        let nextWeek = WeekDate.addDays(7, to: originalData.weekStart)
        var nextData = PreviewData.planner(weekStart: nextWeek)
        for index in nextData.days.indices { nextData.days[index].items.removeAll() }
        nextData.weeklyItems.removeAll()
        model.data = nextData
        let draft = PlanningItemDraft(id: item.id, text: "Updated in the separate window", type: item.type,
                                      planningDate: nextWeek, weekStartDate: nextWeek, remindAt: nil)
        let saved = await model.saveItem(draft, originalItem: item)
        XCTAssertTrue(saved)
        let updated = try XCTUnwrap(model.data?.days.flatMap(\.items).first { $0.id == item.id })
        XCTAssertTrue(updated.isCompleted)
        XCTAssertEqual(updated.createdBy, item.createdBy)
        XCTAssertEqual(updated.sortOrder, item.sortOrder)
        XCTAssertEqual(updated.text, draft.text)
        XCTAssertEqual(model.data?.weekStart, nextWeek)
    }

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
    func testMacNavigationPublishesOncePerDistinctUserAction() {
        let navigation = MacPlannerNavigation(selectedDay: "2026-08-30")
        var updates = 0
        let cancellable = navigation.objectWillChange.sink { updates += 1 }

        navigation.selectPlanningItem("task-1")
        XCTAssertEqual(updates, 1)

        navigation.select(.week)
        XCTAssertEqual(updates, 1, "Selecting the current sidebar section should be a no-op")
        XCTAssertEqual(navigation.selection, .planningItem("task-1"))

        navigation.selectPlanningItem("task-1")
        XCTAssertEqual(updates, 1, "Selecting the current row should be a no-op")

        navigation.selectDay("2026-08-31")
        XCTAssertEqual(updates, 2, "Day, section, and inspector changes should publish together")
        withExtendedLifetime(cancellable) {}
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

    @MainActor
    func testMacDetailsCloseKeepsEditsUntilDiscardedOrSaved() {
        let coordinator = MacUnsavedChangesCoordinator()
        coordinator.setDirty(true)

        XCTAssertNil(coordinator.request(.closeDetails))
        coordinator.cancelNavigation()
        XCTAssertTrue(coordinator.isDirty)
        XCTAssertFalse(coordinator.requiresConfirmation)

        XCTAssertNil(coordinator.request(.closeDetails))
        XCTAssertEqual(coordinator.discardChanges(), .closeDetails)
        XCTAssertFalse(coordinator.isDirty)

        coordinator.setDirty(true)
        coordinator.setDirty(false)
        XCTAssertEqual(coordinator.request(.closeDetails), .closeDetails)
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
