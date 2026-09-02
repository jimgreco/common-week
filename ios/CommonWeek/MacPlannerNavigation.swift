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

enum MacAppStoreScreenshot: String {
    case week
    case events
    case tasks

    static var current: MacAppStoreScreenshot? {
        #if DEBUG
        ProcessInfo.processInfo.environment["APP_STORE_SCREENSHOTS"] == "1"
            ? ProcessInfo.processInfo.environment["APP_STORE_MAC_SCREENSHOT_SCENE"].flatMap(Self.init(rawValue:))
            : nil
        #else
        nil
        #endif
    }

    var section: MacPlannerSection {
        switch self {
        case .week: .week
        case .events: .events
        case .tasks: .weekOfUsTasks
        }
    }

    var selection: MacPlannerSelection? {
        switch self {
        case .week: nil
        case .events: .event("event-0")
        case .tasks: .planningItem("weekly-task-1")
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
    private struct State: Equatable {
        var section: MacPlannerSection
        var selectedDay: String
        var selection: MacPlannerSelection?
        var selections: Set<MacPlannerSelection>
    }

    @Published private var state: State

    var section: MacPlannerSection { state.section }
    var selectedDay: String {
        get { state.selectedDay }
        set { update { $0.selectedDay = newValue } }
    }
    var selection: MacPlannerSelection? { state.selection }
    var selections: Set<MacPlannerSelection> { state.selections }

    private let defaults: UserDefaults?
    private let persistenceKey: String?

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
            state = State(
                section: snapshot.restoredSection,
                selectedDay: snapshot.selectedDay,
                selection: snapshot.restoredSelection,
                selections: Set(snapshot.restoredSelection.map { [$0] } ?? [])
            )
        } else {
            state = State(
                section: section,
                selectedDay: selectedDay,
                selection: selection,
                selections: Set(selection.map { [$0] } ?? [])
            )
        }
    }

    func select(_ section: MacPlannerSection) {
        guard state.section != section else { return }
        update {
            $0.section = section
            $0.selection = nil
            $0.selections = []
        }
    }

    func selectDay(_ date: String) {
        update {
            $0.selectedDay = date
            $0.section = .week
            $0.selection = nil
            $0.selections = []
        }
    }

    func selectPlanningItem(_ id: String) {
        selectOne(.planningItem(id))
    }

    func selectEvent(_ id: String) {
        selectOne(.event(id))
    }

    func selectAppleReminder(_ id: String) {
        selectOne(.appleReminder(id))
    }

    func selectMany(_ newSelections: Set<MacPlannerSelection>) {
        update {
            let newlySelected = newSelections.subtracting($0.selections).first
            $0.selections = newSelections
            $0.selection = newlySelected ?? newSelections.first
        }
    }

    func clearSelection() {
        update {
            $0.selection = nil
            $0.selections = []
        }
    }

    private func selectOne(_ selection: MacPlannerSelection) {
        update {
            $0.selection = selection
            $0.selections = [selection]
        }
    }

    private func update(_ mutation: (inout State) -> Void) {
        var next = state
        mutation(&next)
        guard next != state else { return }
        state = next
        persist(next)
    }

    private func persist(_ state: State) {
        guard let defaults, let persistenceKey else { return }
        let snapshot = MacPlannerNavigationSnapshot(
            section: state.section,
            selectedDay: state.selectedDay,
            selection: state.selection
        )
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: persistenceKey)
        }
    }
}
