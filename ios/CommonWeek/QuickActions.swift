import SwiftUI
import AppIntents
import WidgetKit

@MainActor
enum WidgetPublisher {
    static func publish(_ data: WeeklyPlannerData?, userId: String) {
        #if !targetEnvironment(macCatalyst)
        let defaults = UserDefaults(suiteName: WidgetSnapshot.group)
        guard let data, !data.isDemo else { defaults?.removeObject(forKey: WidgetSnapshot.key); WidgetCenter.shared.reloadAllTimelines(); return }
        guard data.weekStart == WeekDate.currentWeekStart(timeZoneIdentifier: data.household.timezone) else { return }
        let now = Date()
        let events = Array(Dictionary(data.days.flatMap(\.events).filter { event in
            data.visibleCalendars?.first(where: { $0.id == event.calendarPreferenceId })?.visibility == "share" && !event.allDay
        }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }).values)
        let next = events.compactMap { e -> WidgetSnapshot.Commitment? in guard let date = PlannerMoment.date(from: e.start), date > now else { return nil }; return .init(title: e.title, date: date) }.sorted { $0.date < $1.date }
        let tasks = (data.weeklyItems + data.days.flatMap(\.items)).filter { $0.type == .task && !$0.isCompleted && $0.responsibleMemberId == userId }.map(\.text)
        let snapshot = WidgetSnapshot(updated: now, next: Array(next.prefix(20)), tasks: tasks)
        if let bytes = try? JSONEncoder().encode(snapshot) { defaults?.set(bytes, forKey: WidgetSnapshot.key) }
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
struct AddFamilyTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a family task"
    static var description = IntentDescription("Save a task to your household backlog.")
    static var openAppWhenRun = true
    @Parameter(title: "Task") var title: String
    @MainActor func perform() async throws -> some IntentResult & ProvidesDialog {
        guard APIClient.shared.token != nil else { throw APIError.unauthorized }
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw APIError.server("Give your task a name.") }
        try await APIClient.shared.mutateTaskWorkspace(["action": .string("capture"), "id": .string(UUID().uuidString), "text": .string(value)])
        NotificationCoordinator.shared.openQuickTasks(capture: true)
        return .result(dialog: "Added to your household backlog.")
    }
}
struct OpenFamilyTasksIntent: AppIntent {
    static var title: LocalizedStringResource = "Open my family tasks"
    static var openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult { NotificationCoordinator.shared.openQuickTasks(capture: false); return .result() }
}
struct FamilyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AddFamilyTaskIntent(), phrases: ["Add a task in \(.applicationName)"], shortTitle: "Add family task", systemImageName: "plus.circle")
        AppShortcut(intent: OpenFamilyTasksIntent(), phrases: ["Open my tasks in \(.applicationName)"], shortTitle: "My family tasks", systemImageName: "checklist")
    }
}
