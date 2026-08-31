import SwiftUI

enum MacPlannerSection: String, CaseIterable, Identifiable {
    case week
    case events
    case plans
    case weekOfUsTasks
    case appleReminders
    case notifications
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .week: "Week"
        case .events: "Events"
        case .plans: "Plans"
        case .weekOfUsTasks: "Week of Us Tasks"
        case .appleReminders: "Apple Reminders"
        case .notifications: "Notifications"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .week: "calendar"
        case .events: "list.bullet.rectangle"
        case .plans: "note.text"
        case .weekOfUsTasks: "checkmark.square"
        case .appleReminders: "checklist"
        case .notifications: "bell"
        case .settings: "gearshape"
        }
    }
}

enum MacPlannerSelection: Hashable {
    case planningItem(String)
    case event(String)
    case appleReminder(String)
}

struct MacPlannerNavigationSnapshot: Codable, Equatable {
    let section: String
    let selectedDay: String
    let selectionKind: String?
    let selectionId: String?

    init(section: MacPlannerSection, selectedDay: String, selection: MacPlannerSelection?) {
        self.section = section.rawValue
        self.selectedDay = selectedDay
        switch selection {
        case .planningItem(let id): selectionKind = "planning-item"; selectionId = id
        case .event(let id): selectionKind = "event"; selectionId = id
        case .appleReminder(let id): selectionKind = "apple-reminder"; selectionId = id
        case nil: selectionKind = nil; selectionId = nil
        }
    }

    var restoredSection: MacPlannerSection { MacPlannerSection(rawValue: section) ?? .week }

    var restoredSelection: MacPlannerSelection? {
        guard let selectionId else { return nil }
        switch selectionKind {
        case "planning-item": return .planningItem(selectionId)
        case "event": return .event(selectionId)
        case "apple-reminder": return .appleReminder(selectionId)
        default: return nil
        }
    }
}

enum MacNavigationIntent: Equatable {
    case section(MacPlannerSection)
    case day(String)
    case selection(MacPlannerSelection)
    case selections(Set<MacPlannerSelection>)
    case weekOffset(Int)
    case currentWeek
}

enum MacPlannerDragPayload: Equatable {
    case planningItem(String)
    case event(String)
    case appleReminder(String)

    var encoded: String {
        switch self {
        case .planningItem(let id): "week-of-us:planning-item:\(id)"
        case .event(let id): "week-of-us:event:\(id)"
        case .appleReminder(let id): "week-of-us:apple-reminder:\(id)"
        }
    }

    init?(encoded: String) {
        let prefix = "week-of-us:"
        guard encoded.hasPrefix(prefix) else { return nil }
        let remainder = String(encoded.dropFirst(prefix.count))
        guard let separator = remainder.firstIndex(of: ":") else { return nil }
        let kind = String(remainder[..<separator])
        let id = String(remainder[remainder.index(after: separator)...])
        guard !id.isEmpty else { return nil }
        switch kind {
        case "planning-item": self = .planningItem(id)
        case "event": self = .event(id)
        case "apple-reminder": self = .appleReminder(id)
        default: return nil
        }
    }
}

@MainActor
final class MacUnsavedChangesCoordinator: ObservableObject {
    @Published private(set) var isDirty = false
    @Published private(set) var pendingIntent: MacNavigationIntent?

    var requiresConfirmation: Bool { pendingIntent != nil }

    func setDirty(_ dirty: Bool) {
        isDirty = dirty
        if !dirty { pendingIntent = nil }
    }

    func request(_ intent: MacNavigationIntent) -> MacNavigationIntent? {
        guard isDirty else { return intent }
        pendingIntent = intent
        return nil
    }

    func discardChanges() -> MacNavigationIntent? {
        let intent = pendingIntent
        pendingIntent = nil
        isDirty = false
        return intent
    }

    func cancelNavigation() {
        pendingIntent = nil
    }
}

@MainActor
final class MacPlannerNavigation: ObservableObject {
    @Published private(set) var section: MacPlannerSection { didSet { persist() } }
    @Published var selectedDay: String { didSet { persist() } }
    @Published var selection: MacPlannerSelection? { didSet { persist() } }
    @Published private(set) var selections: Set<MacPlannerSelection>

    private let defaults: UserDefaults?
    private let persistenceKey: String?
    private var hasFinishedInitializing = false

    init(
        section: MacPlannerSection = .week,
        selectedDay: String = "",
        selection: MacPlannerSelection? = nil,
        defaults: UserDefaults? = nil,
        persistenceKey: String? = nil
    ) {
        self.defaults = defaults
        self.persistenceKey = persistenceKey
        if let defaults,
           let persistenceKey,
           let data = defaults.data(forKey: persistenceKey),
           let snapshot = try? JSONDecoder().decode(MacPlannerNavigationSnapshot.self, from: data) {
            self.section = snapshot.restoredSection
            self.selectedDay = snapshot.selectedDay
            self.selection = snapshot.restoredSelection
            self.selections = Set(snapshot.restoredSelection.map { [$0] } ?? [])
        } else {
            self.section = section
            self.selectedDay = selectedDay
            self.selection = selection
            self.selections = Set(selection.map { [$0] } ?? [])
        }
        hasFinishedInitializing = true
    }

    func select(_ section: MacPlannerSection) {
        guard self.section != section else { return }
        self.section = section
        selection = nil
        selections = []
    }

    func selectDay(_ date: String) {
        selectedDay = date
        if section != .week {
            section = .week
        }
        selection = nil
        selections = []
    }

    func selectPlanningItem(_ id: String) {
        selection = .planningItem(id)
        selections = [.planningItem(id)]
    }

    func selectEvent(_ id: String) {
        selection = .event(id)
        selections = [.event(id)]
    }

    func selectAppleReminder(_ id: String) {
        selection = .appleReminder(id)
        selections = [.appleReminder(id)]
    }

    func selectMany(_ newSelections: Set<MacPlannerSelection>) {
        let newlySelected = newSelections.subtracting(selections).first
        selections = newSelections
        selection = newlySelected ?? newSelections.first
    }

    func clearSelection() {
        selection = nil
        selections = []
    }

    private func persist() {
        guard hasFinishedInitializing, let defaults, let persistenceKey else { return }
        let snapshot = MacPlannerNavigationSnapshot(
            section: section,
            selectedDay: selectedDay,
            selection: selection
        )
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: persistenceKey)
        }
    }
}
