import Combine
import EventKit
import Foundation

enum TaskCreationDestination: Hashable, Identifiable {
    case weekOfUs
    case appleReminders(String)

    var id: String {
        switch self {
        case .weekOfUs: "week-of-us"
        case .appleReminders(let listId): "apple-reminders:\(listId)"
        }
    }

    init(storedValue: String?) {
        guard let storedValue,
              storedValue.hasPrefix("apple-reminders:") else {
            self = .weekOfUs
            return
        }
        self = .appleReminders(String(storedValue.dropFirst("apple-reminders:".count)))
    }
}

enum AppleRemindersAccess: Equatable {
    case notDetermined
    case denied
    case restricted
    case fullAccess
}

struct AppleReminderList: Identifiable, Hashable {
    let id: String
    let title: String
    let sourceTitle: String
    let canModify: Bool
}

enum AppleReminderPriority: Int, CaseIterable, Identifiable, Hashable {
    case none = 0
    case high = 1
    case medium = 5
    case low = 9

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .none: "None"
        case .high: "High"
        case .medium: "Medium"
        case .low: "Low"
        }
    }

    init(eventKitValue: Int) {
        switch eventKitValue {
        case 1...4: self = .high
        case 5: self = .medium
        case 6...9: self = .low
        default: self = .none
        }
    }
}

struct AppleReminderTask: Identifiable, Hashable {
    let id: String
    let title: String
    let notes: String?
    let url: String?
    let priority: AppleReminderPriority
    let listId: String
    let listTitle: String
    let dueDate: String
    let displayDate: String
    let dueAt: Date?
    let dueTimeLabel: String?
    let isAllDay: Bool
    let isCompleted: Bool
    let canModify: Bool
    let isRecurring: Bool
    let carryoverCount: Int

    var carryoverLabel: String? {
        carryoverCount > 0 ? "Carried from \(WeekDate.longDay(dueDate))" : nil
    }

    var canEditDetails: Bool { canModify }
    var canDelete: Bool { canModify }

}

struct AppleReminderPlacement: Equatable {
    let displayDate: String
    let carryoverCount: Int

    static func resolve(
        dueDate: String,
        isCompleted: Bool,
        completionDate: String? = nil,
        visibleWeekStart: String,
        currentWeekStart: String,
        today: String
    ) -> AppleReminderPlacement? {
        let weekEnd = WeekDate.addDays(7, to: visibleWeekStart)
        if isCompleted,
           let completionDate,
           completionDate > dueDate,
           completionDate >= visibleWeekStart,
           completionDate < weekEnd {
            return AppleReminderPlacement(
                displayDate: completionDate,
                carryoverCount: max(0, WeekDate.daysBetween(dueDate, completionDate))
            )
        }
        let shouldCarry = visibleWeekStart == currentWeekStart && !isCompleted && dueDate < today
        if shouldCarry {
            return AppleReminderPlacement(
                displayDate: today,
                carryoverCount: max(0, WeekDate.daysBetween(dueDate, today))
            )
        }
        guard dueDate >= visibleWeekStart && dueDate < weekEnd else { return nil }
        return AppleReminderPlacement(displayDate: dueDate, carryoverCount: 0)
    }
}

enum AppleRemindersError: LocalizedError {
    case accessDenied
    case listUnavailable
    case reminderUnavailable
    case readOnly

    var errorDescription: String? {
        switch self {
        case .accessDenied: "Allow Reminders access in iPhone Settings to use this feature."
        case .listUnavailable: "That Reminders list is no longer available."
        case .reminderUnavailable: "That reminder changed or is no longer available."
        case .readOnly: "That Reminders list is read-only."
        }
    }
}

@MainActor
final class AppleRemindersStore: ObservableObject {
    static let shared = AppleRemindersStore()

    @Published private(set) var access: AppleRemindersAccess = .notDetermined
    @Published private(set) var lists: [AppleReminderList] = []
    @Published private(set) var selectedListIds: Set<String> = []
    @Published private(set) var defaultDestination: TaskCreationDestination = .weekOfUs
    @Published private(set) var tasks: [AppleReminderTask] = []
    @Published private(set) var isLoading = false
    @Published var notice: String?

    private let eventStore: EKEventStore
    private let defaults: UserDefaults
    private var activeUserId: String?
    private var visibleWeekStart: String?
    private var householdTimeZone = TimeZone.current.identifier
    private var storeChangeObserver: NSObjectProtocol?
    private var noticeTask: Task<Void, Never>?

    init(eventStore: EKEventStore = EKEventStore(), defaults: UserDefaults = .standard) {
        self.eventStore = eventStore
        self.defaults = defaults
        refreshAuthorizationStatus()
        storeChangeObserver = NotificationCenter.default.addObserver(
            forName: .EKEventStoreChanged,
            object: eventStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                await self.reloadVisibleWeek()
            }
        }
    }

    deinit {
        if let storeChangeObserver {
            NotificationCenter.default.removeObserver(storeChangeObserver)
        }
    }

    func activate(userId: String, weekStart: String, timeZoneIdentifier: String) async {
        if activeUserId != userId {
            activeUserId = userId
            selectedListIds = Set(defaults.stringArray(forKey: selectedListsKey(userId)) ?? [])
            defaultDestination = TaskCreationDestination(
                storedValue: defaults.string(forKey: defaultDestinationKey(userId))
            )
            tasks = []
        }
        visibleWeekStart = weekStart
        householdTimeZone = timeZoneIdentifier
        refreshAuthorizationStatus()
        guard access == .fullAccess else { return }
        await reloadVisibleWeek()
    }

    func deactivate() {
        activeUserId = nil
        visibleWeekStart = nil
        lists = []
        tasks = []
        selectedListIds = []
        defaultDestination = .weekOfUs
    }

    func applicationDidBecomeActive() {
        refreshAuthorizationStatus()
        guard activeUserId != nil, access == .fullAccess else { return }
        Task { await reloadVisibleWeek() }
    }

    func requestAccess() async {
        do {
            guard try await eventStore.requestFullAccessToReminders() else {
                refreshAuthorizationStatus()
                throw AppleRemindersError.accessDenied
            }
            refreshAuthorizationStatus()
            await reloadVisibleWeek()
        } catch {
            refreshAuthorizationStatus()
            show(error.localizedDescription)
        }
    }

    func refresh(weekStart: String, timeZoneIdentifier: String) async {
        visibleWeekStart = weekStart
        householdTimeZone = timeZoneIdentifier
        refreshAuthorizationStatus()
        guard access == .fullAccess else {
            lists = []
            tasks = []
            return
        }
        await reloadVisibleWeek()
    }

    func setList(_ listId: String, selected: Bool) async {
        if selected {
            selectedListIds.insert(listId)
        } else {
            selectedListIds.remove(listId)
            if defaultDestination == .appleReminders(listId) {
                defaultDestination = .weekOfUs
            }
        }
        persistPreferences()
        await reloadVisibleWeek()
    }

    func setDefaultDestination(_ destination: TaskCreationDestination) {
        if case .appleReminders(let listId) = destination,
           !writableSelectedLists.contains(where: { $0.id == listId }) {
            defaultDestination = .weekOfUs
        } else {
            defaultDestination = destination
        }
        persistPreferences()
    }

    var selectedLists: [AppleReminderList] {
        lists.filter { selectedListIds.contains($0.id) }
    }

    var writableSelectedLists: [AppleReminderList] {
        selectedLists.filter(\.canModify)
    }

    func tasks(for date: String) -> [AppleReminderTask] {
        tasks.filter { $0.displayDate == date }
    }

    func createReminder(
        title: String,
        listId: String,
        dueDate: Date,
        includesTime: Bool,
        timeZoneIdentifier: String
    ) async throws {
        try requireAccess()
        guard let calendar = eventStore.calendar(withIdentifier: listId) else {
            throw AppleRemindersError.listUnavailable
        }
        guard calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }

        let reminder = EKReminder(eventStore: eventStore)
        reminder.calendar = calendar
        reminder.title = title
        let components = dueComponents(
            from: dueDate,
            includesTime: includesTime,
            timeZoneIdentifier: timeZoneIdentifier
        )
        if reminder.startDateComponents == nil {
            reminder.startDateComponents = components
        }
        reminder.dueDateComponents = components
        try eventStore.save(reminder, commit: true)
        await reloadVisibleWeek()
        show("Reminder saved")
    }

    func toggle(_ task: AppleReminderTask) async {
        do {
            try requireAccess()
            let reminder = try reminder(for: task)
            guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
            reminder.isCompleted = !task.isCompleted
            try eventStore.save(reminder, commit: true)
            await reloadVisibleWeek()
            show(task.isCompleted ? "Reminder reopened" : "Reminder completed")
        } catch {
            await reloadVisibleWeek()
            show(error.localizedDescription)
        }
    }

    func update(
        _ task: AppleReminderTask,
        title: String,
        notes: String,
        url: URL?,
        priority: AppleReminderPriority,
        listId: String,
        dueDate: Date,
        includesTime: Bool,
        timeZoneIdentifier: String
    ) async throws {
        try requireAccess()
        let reminder = try reminder(for: task)
        guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        guard let targetCalendar = eventStore.calendar(withIdentifier: listId) else {
            throw AppleRemindersError.listUnavailable
        }
        guard targetCalendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        reminder.title = title
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        reminder.notes = trimmedNotes.isEmpty ? nil : trimmedNotes
        reminder.url = url
        reminder.priority = priority.rawValue
        reminder.calendar = targetCalendar
        // Recurrence rules intentionally remain untouched; these edits apply to the reminder series metadata.
        let components = dueComponents(
            from: dueDate,
            includesTime: includesTime,
            timeZoneIdentifier: timeZoneIdentifier
        )
        if reminder.startDateComponents == nil {
            reminder.startDateComponents = components
        }
        reminder.dueDateComponents = components
        try eventStore.save(reminder, commit: true)
        await reloadVisibleWeek()
        show("Reminder saved")
    }

    func delete(_ task: AppleReminderTask) async throws {
        try requireAccess()
        let reminder = try reminder(for: task)
        guard reminder.calendar.allowsContentModifications else { throw AppleRemindersError.readOnly }
        // EventKit has no occurrence-span overload for reminders, so removing a recurring reminder removes its series.
        try eventStore.remove(reminder, commit: true)
        await reloadVisibleWeek()
        show("Reminder deleted")
    }

    private func reloadVisibleWeek() async {
        guard access == .fullAccess else { return }
        loadLists()
        guard let visibleWeekStart else {
            tasks = []
            return
        }
        let calendars = eventStore.calendars(for: .reminder).filter {
            selectedListIds.contains($0.calendarIdentifier)
        }
        guard !calendars.isEmpty else {
            tasks = []
            validateDefaultDestination()
            return
        }

        isLoading = true
        defer { isLoading = false }
        let predicate = eventStore.predicateForReminders(in: calendars)
        let reminders = await withCheckedContinuation { continuation in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }
        tasks = reminders.compactMap {
            mapReminder($0, visibleWeekStart: visibleWeekStart, timeZoneIdentifier: householdTimeZone)
        }.sorted {
            if $0.displayDate != $1.displayDate { return $0.displayDate < $1.displayDate }
            if $0.isCompleted != $1.isCompleted { return !$0.isCompleted }
            return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
        validateDefaultDestination()
    }

    private func loadLists() {
        lists = eventStore.calendars(for: .reminder).map {
            AppleReminderList(
                id: $0.calendarIdentifier,
                title: $0.title,
                sourceTitle: $0.source.title,
                canModify: $0.allowsContentModifications
            )
        }.sorted {
            if $0.sourceTitle != $1.sourceTitle { return $0.sourceTitle < $1.sourceTitle }
            return $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
        }
        validateDefaultDestination()
    }

    private func mapReminder(
        _ reminder: EKReminder,
        visibleWeekStart: String,
        timeZoneIdentifier: String
    ) -> AppleReminderTask? {
        guard let due = reminder.dueDateComponents,
              let dueDate = dateString(from: due) else { return nil }
        let currentWeek = WeekDate.currentWeekStart(timeZoneIdentifier: timeZoneIdentifier)
        let today = WeekDate.today(timeZoneIdentifier: timeZoneIdentifier)
        guard let placement = AppleReminderPlacement.resolve(
            dueDate: dueDate,
            isCompleted: reminder.isCompleted,
            completionDate: reminder.completionDate.map {
                WeekDate.string($0, timeZoneIdentifier: timeZoneIdentifier)
            },
            visibleWeekStart: visibleWeekStart,
            currentWeekStart: currentWeek,
            today: today
        ) else { return nil }

        let includesTime = due.hour != nil || due.minute != nil || due.second != nil
        return AppleReminderTask(
            id: reminder.calendarItemIdentifier,
            title: reminder.title ?? "Untitled reminder",
            notes: reminder.notes,
            url: reminder.url?.absoluteString,
            priority: AppleReminderPriority(eventKitValue: reminder.priority),
            listId: reminder.calendar.calendarIdentifier,
            listTitle: reminder.calendar.title,
            dueDate: dueDate,
            displayDate: placement.displayDate,
            dueAt: includesTime ? absoluteDate(from: due, fallbackTimeZoneIdentifier: timeZoneIdentifier) : nil,
            dueTimeLabel: includesTime ? timeLabel(from: due, fallbackTimeZoneIdentifier: timeZoneIdentifier) : nil,
            isAllDay: !includesTime,
            isCompleted: reminder.isCompleted,
            canModify: reminder.calendar.allowsContentModifications,
            isRecurring: reminder.hasRecurrenceRules,
            carryoverCount: placement.carryoverCount
        )
    }

    private func reminder(for task: AppleReminderTask) throws -> EKReminder {
        guard let reminder = eventStore.calendarItem(withIdentifier: task.id) as? EKReminder else {
            throw AppleRemindersError.reminderUnavailable
        }
        return reminder
    }

    private func requireAccess() throws {
        refreshAuthorizationStatus()
        guard access == .fullAccess else { throw AppleRemindersError.accessDenied }
    }

    private func refreshAuthorizationStatus() {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess, .authorized: access = .fullAccess
        case .denied: access = .denied
        case .restricted: access = .restricted
        case .notDetermined, .writeOnly: access = .notDetermined
        @unknown default: access = .denied
        }
    }

    private func validateDefaultDestination() {
        guard case .appleReminders(let listId) = defaultDestination else { return }
        if !writableSelectedLists.contains(where: { $0.id == listId }) {
            defaultDestination = .weekOfUs
            persistPreferences()
        }
    }

    private func persistPreferences() {
        guard let activeUserId else { return }
        defaults.set(Array(selectedListIds).sorted(), forKey: selectedListsKey(activeUserId))
        defaults.set(defaultDestination.id, forKey: defaultDestinationKey(activeUserId))
    }

    private func selectedListsKey(_ userId: String) -> String {
        "apple-reminders.selected-lists.\(userId)"
    }

    private func defaultDestinationKey(_ userId: String) -> String {
        "apple-reminders.default-destination.\(userId)"
    }

    private func dateString(from components: DateComponents) -> String? {
        guard let year = components.year, let month = components.month, let day = components.day else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func absoluteDate(from components: DateComponents, fallbackTimeZoneIdentifier: String) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = components.timeZone
            ?? TimeZone(identifier: fallbackTimeZoneIdentifier)
            ?? .current
        return calendar.date(from: components)
    }

    private func timeLabel(from components: DateComponents, fallbackTimeZoneIdentifier: String) -> String? {
        guard let date = absoluteDate(from: components, fallbackTimeZoneIdentifier: fallbackTimeZoneIdentifier) else {
            return nil
        }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        formatter.timeZone = components.timeZone
            ?? TimeZone(identifier: fallbackTimeZoneIdentifier)
            ?? .current
        return formatter.string(from: date)
    }

    private func dueComponents(
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

    private func show(_ message: String) {
        noticeTask?.cancel()
        notice = message
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }
}
