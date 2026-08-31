import Foundation

enum AppleReminderRecurrenceFrequency: String, CaseIterable, Identifiable, Hashable {
    case daily
    case weekly
    case monthly
    case yearly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        case .yearly: "Yearly"
        }
    }

    var intervalUnit: String {
        switch self {
        case .daily: "day"
        case .weekly: "week"
        case .monthly: "month"
        case .yearly: "year"
        }
    }
}

enum AppleReminderWeekday: Int, CaseIterable, Identifiable, Hashable {
    case sunday = 1
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday

    var id: Int { rawValue }

    var shortTitle: String {
        switch self {
        case .sunday: "S"
        case .monday: "M"
        case .tuesday: "T"
        case .wednesday: "W"
        case .thursday: "T"
        case .friday: "F"
        case .saturday: "S"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .sunday: "Sunday"
        case .monday: "Monday"
        case .tuesday: "Tuesday"
        case .wednesday: "Wednesday"
        case .thursday: "Thursday"
        case .friday: "Friday"
        case .saturday: "Saturday"
        }
    }
}

enum AppleReminderRecurrenceEnd: Equatable {
    case never
    case onDate(Date)
    case afterOccurrences(Int)
}

struct AppleReminderRecurrence: Equatable {
    let frequency: AppleReminderRecurrenceFrequency
    let interval: Int
    let weekdays: Set<AppleReminderWeekday>
    let end: AppleReminderRecurrenceEnd

    func validate(starting startDate: Date, timeZoneIdentifier: String) throws {
        guard (1...999).contains(interval) else {
            throw AppleRemindersError.invalidRecurrence("Repeat interval must be between 1 and 999.")
        }
        if frequency == .weekly, weekdays.isEmpty {
            throw AppleRemindersError.invalidRecurrence("Choose at least one weekday for a weekly reminder.")
        }
        switch end {
        case .never:
            break
        case .onDate(let endDate):
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
            guard calendar.startOfDay(for: endDate) >= calendar.startOfDay(for: startDate) else {
                throw AppleRemindersError.invalidRecurrence("The repeat end date cannot be before the due date.")
            }
        case .afterOccurrences(let count):
            guard (1...999).contains(count) else {
                throw AppleRemindersError.invalidRecurrence("Occurrence count must be between 1 and 999.")
            }
        }
    }
}

enum AppleReminderRecurrenceEndMode: String, CaseIterable, Identifiable {
    case never
    case onDate
    case afterOccurrences

    var id: String { rawValue }

    var title: String {
        switch self {
        case .never: "Never"
        case .onDate: "On date"
        case .afterOccurrences: "After count"
        }
    }
}

struct AppleReminderRecurrenceDraft: Equatable {
    var isEnabled = false
    var frequency = AppleReminderRecurrenceFrequency.weekly
    var interval = 1
    var weekdays: Set<AppleReminderWeekday> = []
    var endMode = AppleReminderRecurrenceEndMode.never
    var endDate = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    var occurrenceCount = 10

    func recurrence(starting startDate: Date, timeZoneIdentifier: String) -> AppleReminderRecurrence? {
        guard isEnabled else { return nil }
        var selectedWeekdays = weekdays
        if frequency == .weekly, selectedWeekdays.isEmpty {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
            if let weekday = AppleReminderWeekday(rawValue: calendar.component(.weekday, from: startDate)) {
                selectedWeekdays = [weekday]
            }
        }
        let end: AppleReminderRecurrenceEnd = switch endMode {
        case .never: .never
        case .onDate: .onDate(endDate)
        case .afterOccurrences: .afterOccurrences(occurrenceCount)
        }
        return AppleReminderRecurrence(
            frequency: frequency,
            interval: interval,
            weekdays: selectedWeekdays,
            end: end
        )
    }
}
