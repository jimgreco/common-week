import Foundation
import UIKit
import UserNotifications

struct PlannerNotificationDestination: Hashable {
    enum Target: Hashable {
        case planningItem(String)
        case calendarReminder(String)
    }

    let weekStart: String
    let target: Target
}

@MainActor
final class NotificationCoordinator: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCoordinator()
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var registrationError: String?
    @Published private(set) var pendingDestination: PlannerNotificationDestination?

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func refreshAuthorizationStatus() async {
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func enablePush() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            guard granted else { return false }
            UIApplication.shared.registerForRemoteNotifications()
            return true
        } catch {
            registrationError = error.localizedDescription
            return false
        }
    }

    func receivedDeviceToken(_ data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "pushDeviceToken")
        Task { await syncStoredToken() }
    }

    func registrationFailed(_ error: Error) {
        registrationError = error.localizedDescription
    }

    func syncStoredToken() async {
        guard APIClient.shared.token != nil,
              let token = UserDefaults.standard.string(forKey: "pushDeviceToken") else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            _ = try await APIClient.shared.registerPushDevice(token: token, environment: environment)
            registrationError = nil
        } catch {
            registrationError = error.localizedDescription
        }
    }

    func unregisterCurrentAccount() async {
        guard APIClient.shared.token != nil,
              let token = UserDefaults.standard.string(forKey: "pushDeviceToken") else { return }
        do {
            _ = try await APIClient.shared.unregisterPushDevice(token: token)
            registrationError = nil
        } catch {
            registrationError = error.localizedDescription
        }
    }

    func consume(_ destination: PlannerNotificationDestination) {
        if pendingDestination == destination { pendingDestination = nil }
    }

    nonisolated static func plannerDestination(for path: String) -> PlannerNotificationDestination? {
        guard let components = URLComponents(string: path),
              components.path == "/planner",
              let week = components.queryItems?.first(where: { $0.name == "week" })?.value,
              week.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        if let item = components.queryItems?.first(where: { $0.name == "item" })?.value,
           item.range(of: #"^[A-Za-z0-9:_-]{1,128}$"#, options: .regularExpression) != nil {
            return PlannerNotificationDestination(weekStart: week, target: .planningItem(item))
        }
        if let reminder = components.queryItems?.first(where: { $0.name == "reminder" })?.value,
           reminder.range(of: #"^[A-Za-z0-9:_-]{1,128}$"#, options: .regularExpression) != nil {
            return PlannerNotificationDestination(weekStart: week, target: .calendarReminder(reminder))
        }
        return nil
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let destination = (response.notification.request.content.userInfo["path"] as? String)
            .flatMap(Self.plannerDestination(for:))
        Task { @MainActor in
            if let destination { self.pendingDestination = destination }
            completionHandler()
        }
    }
}

final class CommonWeekAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in NotificationCoordinator.shared.receivedDeviceToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in NotificationCoordinator.shared.registrationFailed(error) }
    }
}
