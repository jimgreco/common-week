import EventKit
import Foundation

struct AppleReminderRecord: Equatable {
    let id: String
    let title: String
    let notes: String?
    let url: URL?
    let priority: Int
    let listId: String
    let listTitle: String
    let dueDateComponents: DateComponents?
    let completionDate: Date?
    let isCompleted: Bool
    let canModify: Bool
    let isRecurring: Bool
}

struct AppleReminderMutation: Equatable {
    let title: String
    let notes: String?
    let url: URL?
    let priority: Int
    let listId: String
    let dueDate: Date
    let includesTime: Bool
    let timeZoneIdentifier: String
    let recurrence: AppleReminderRecurrence?
}

@MainActor
protocol AppleRemindersClient: AnyObject {
    var access: AppleRemindersAccess { get }
    var changeNotificationObject: AnyObject? { get }

    func requestAccess() async throws -> Bool
    func reminderLists() -> [AppleReminderList]
    func reminders(in listIds: Set<String>) async -> [AppleReminderRecord]
    func create(mutation: AppleReminderMutation) throws -> String
    func update(id: String, mutation: AppleReminderMutation) throws
    func setCompleted(id: String, completed: Bool) throws
    func delete(id: String) throws
}

@MainActor
final class EventKitAppleRemindersClient: AppleRemindersClient {
    private let eventStore: EKEventStore

    init(eventStore: EKEventStore = EKEventStore()) {
        self.eventStore = eventStore
    }

    var access: AppleRemindersAccess {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess, .authorized: .fullAccess
        case .denied: .denied
        case .restricted: .restricted
        case .notDetermined, .writeOnly: .notDetermined
        @unknown default: .denied
        }
    }

    var changeNotificationObject: AnyObject? { eventStore }

    func requestAccess() async throws -> Bool {
        try await eventStore.requestFullAccessToReminders()
    }

    func reminderLists() -> [AppleReminderList] {
        eventStore.calendars(for: .reminder).map {
            AppleReminderList(
                id: $0.calendarIdentifier,
                title: $0.title,
                sourceTitle: $0.source.title,
                canModify: $0.allowsContentModifications
            )
        }
    }

    func reminders(in listIds: Set<String>) async -> [AppleReminderRecord] {
        let calendars = eventStore.calendars(for: .reminder).filter {
            listIds.contains($0.calendarIdentifier)
        }
        guard !calendars.isEmpty else { return [] }
        let predicate = eventStore.predicateForReminders(in: calendars)
        let reminders = await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
        return reminders.compactMap { reminder in
            guard let calendar = reminder.calendar else { return nil }
            return AppleReminderRecord(
                id: reminder.calendarItemIdentifier,
                title: reminder.title ?? "Untitled reminder",
                notes: reminder.notes,
                url: reminder.url,
                priority: reminder.priority,
                listId: calendar.calendarIdentifier,
                listTitle: calendar.title,
                dueDateComponents: reminder.dueDateComponents,
                completionDate: reminder.completionDate,
                isCompleted: reminder.isCompleted,
                canModify: calendar.allowsContentModifications,
                isRecurring: reminder.hasRecurrenceRules
            )
        }
    }

    func create(mutation: AppleReminderMutation) throws -> String {
        guard let calendar = eventStore.calendar(withIdentifier: mutation.listId) else {
            throw AppleRemindersError.listUnavailable
        }
        guard calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        let reminder = EKReminder(eventStore: eventStore)
        reminder.calendar = calendar
        reminder.title = mutation.title
        reminder.notes = mutation.notes
        reminder.url = mutation.url
        reminder.priority = mutation.priority
        let components = Self.dueComponents(
            from: mutation.dueDate,
            includesTime: mutation.includesTime,
            timeZoneIdentifier: mutation.timeZoneIdentifier
        )
        reminder.startDateComponents = components
        reminder.dueDateComponents = components
        if let recurrence = mutation.recurrence {
            reminder.addRecurrenceRule(Self.recurrenceRule(from: recurrence))
        }
        try eventStore.save(reminder, commit: true)
        return reminder.calendarItemIdentifier
    }

    func update(id: String, mutation: AppleReminderMutation) throws {
        let reminder = try reminder(withIdentifier: id)
        guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        guard let targetCalendar = eventStore.calendar(withIdentifier: mutation.listId) else {
            throw AppleRemindersError.listUnavailable
        }
        guard targetCalendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        reminder.title = mutation.title
        reminder.notes = mutation.notes
        reminder.url = mutation.url
        reminder.priority = mutation.priority
        reminder.calendar = targetCalendar
        let components = Self.dueComponents(
            from: mutation.dueDate,
            includesTime: mutation.includesTime,
            timeZoneIdentifier: mutation.timeZoneIdentifier
        )
        if reminder.startDateComponents == nil {
            reminder.startDateComponents = components
        }
        reminder.dueDateComponents = components
        // Intentionally do not touch recurrenceRules. EventKit applies these metadata
        // changes to the existing reminder while preserving its repeat schedule.
        try eventStore.save(reminder, commit: true)
    }

    func setCompleted(id: String, completed: Bool) throws {
        let reminder = try reminder(withIdentifier: id)
        guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        reminder.isCompleted = completed
        try eventStore.save(reminder, commit: true)
    }

    func delete(id: String) throws {
        let reminder = try reminder(withIdentifier: id)
        guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        // EventKit has no occurrence-span overload for reminders. Removing a
        // recurring reminder therefore removes its complete series.
        try eventStore.remove(reminder, commit: true)
    }

    private func reminder(withIdentifier id: String) throws -> EKReminder {
        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw AppleRemindersError.reminderUnavailable
        }
        return reminder
    }

    private static func dueComponents(
        from date: Date,
        includesTime: Bool,
        timeZoneIdentifier: String
    ) -> DateComponents {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
        var components = calendar.dateComponents(
            includesTime ? [.year, .month, .day, .hour, .minute] : [.year, .month, .day],
            from: date
        )
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        return components
    }

    static func recurrenceRule(from recurrence: AppleReminderRecurrence) -> EKRecurrenceRule {
        let end: EKRecurrenceEnd? = switch recurrence.end {
        case .never:
            nil
        case .onDate(let date):
            EKRecurrenceEnd(end: date)
        case .afterOccurrences(let count):
            EKRecurrenceEnd(occurrenceCount: count)
        }
        let frequency: EKRecurrenceFrequency = switch recurrence.frequency {
        case .daily: .daily
        case .weekly: .weekly
        case .monthly: .monthly
        case .yearly: .yearly
        }
        guard recurrence.frequency == .weekly else {
            return EKRecurrenceRule(
                recurrenceWith: frequency,
                interval: recurrence.interval,
                end: end
            )
        }
        let days = recurrence.weekdays.sorted { $0.rawValue < $1.rawValue }.map {
            EKRecurrenceDayOfWeek(EKWeekday(rawValue: $0.rawValue)!)
        }
        return EKRecurrenceRule(
            recurrenceWith: frequency,
            interval: recurrence.interval,
            daysOfTheWeek: days,
            daysOfTheMonth: nil,
            monthsOfTheYear: nil,
            weeksOfTheYear: nil,
            daysOfTheYear: nil,
            setPositions: nil,
            end: end
        )
    }
}
