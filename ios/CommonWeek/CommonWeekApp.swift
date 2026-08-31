import SwiftUI

@main
struct CommonWeekApp: App {
    @UIApplicationDelegateAdaptor(CommonWeekAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var auth = AuthStore()
    @StateObject private var planner: PlannerViewModel

    init() {
        let planner = PlannerViewModel()
        _planner = StateObject(wrappedValue: planner)
        BackgroundRefreshCoordinator.shared.register(planner: planner)
    }

    var body: some Scene {
        #if targetEnvironment(macCatalyst)
        WindowGroup("Week of Us") {
            RootView(auth: auth, planner: planner)
                .tint(CWTheme.accent)
                .task { await auth.restore() }
                .onChange(of: scenePhase) { _, phase in
                    handleScenePhase(phase)
                }
        }
        .defaultSize(width: 1280, height: 820)
        .commands { MacPlannerCommands() }
        WindowGroup("Week of Us Settings", id: "settings") {
            MacSettingsSceneView(auth: auth, planner: planner)
                .tint(CWTheme.accent)
                .frame(minWidth: 620, minHeight: 620)
                .task { await auth.restore() }
        }
        .defaultSize(width: 760, height: 760)
        #else
        WindowGroup {
            RootView(auth: auth, planner: planner)
                .tint(CWTheme.accent)
                .task { await auth.restore() }
                .onChange(of: scenePhase) { _, phase in
                    handleScenePhase(phase)
                }
        }
        #endif
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            planner.applicationDidBecomeActive()
            AppleRemindersStore.shared.applicationDidBecomeActive()
            Task { await NotificationCoordinator.shared.applicationDidBecomeActive() }
        case .background:
            planner.applicationDidEnterBackground()
            BackgroundRefreshCoordinator.shared.schedule()
        case .inactive:
            break
        @unknown default:
            break
        }
    }
}

#if targetEnvironment(macCatalyst)
private struct MacSettingsSceneView: View {
    @ObservedObject var auth: AuthStore
    @ObservedObject var planner: PlannerViewModel
    @StateObject private var appleReminders = AppleRemindersStore.shared

    var body: some View {
        ZStack {
            AppBackground()
            switch auth.state {
            case .signedIn(let user):
                if let data = planner.data {
                    SettingsView(
                        data: data,
                        viewModel: planner,
                        auth: auth,
                        appleReminders: appleReminders,
                        showsDoneButton: false
                    )
                    .task(id: user.userId) {
                        await appleReminders.activate(
                            userId: user.userId,
                            weekStart: data.weekStart,
                            timeZoneIdentifier: data.household.timezone
                        )
                    }
                } else {
                    ProgressView("Loading settings…")
                        .task { await planner.activate(user: user) }
                }
            case .restoring:
                ProgressView("Restoring your session…")
            case .signedOut, .signingIn:
                ContentUnavailableView(
                    "Sign in to Week of Us",
                    systemImage: "person.crop.circle.badge.exclamationmark",
                    description: Text("Open the main Week of Us window to sign in before changing settings.")
                )
            }
        }
    }
}
#endif

struct RootView: View {
    @ObservedObject var auth: AuthStore
    @ObservedObject var planner: PlannerViewModel

    var body: some View {
        ZStack {
            AppBackground()
            switch auth.state {
            case .restoring:
                ProgressView("Bringing your week together…")
                    .controlSize(.large)
            case .signedOut, .signingIn:
                SignInView(auth: auth)
                    .onAppear {
                        planner.deactivate()
                        AppleRemindersStore.shared.deactivate()
                    }
            case .signedIn(let user):
                #if targetEnvironment(macCatalyst)
                MacPlannerView(viewModel: planner, auth: auth, user: user)
                    .task(id: user.userId) {
                        await planner.activate(user: user)
                        await NotificationCoordinator.shared.syncStoredToken()
                        await NotificationCoordinator.shared.refreshInbox()
                    }
                #else
                PlannerView(viewModel: planner, auth: auth, user: user)
                    .task(id: user.userId) {
                        await planner.activate(user: user)
                        await NotificationCoordinator.shared.syncStoredToken()
                        await NotificationCoordinator.shared.refreshInbox()
                    }
                #endif
            }
        }
    }
}
