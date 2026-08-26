import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationCoordinator: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCoordinator()
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published private(set) var registrationError: String?

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

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
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
