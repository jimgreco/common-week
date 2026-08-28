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
        WindowGroup {
            RootView(auth: auth, planner: planner)
                .tint(CWTheme.accent)
                .task { await auth.restore() }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        planner.applicationDidBecomeActive()
                        AppleRemindersStore.shared.applicationDidBecomeActive()
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
    }
}
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
                PlannerView(viewModel: planner, auth: auth, user: user)
                    .task(id: user.userId) {
                        await planner.activate(user: user)
                        await NotificationCoordinator.shared.syncStoredToken()
                    }
            }
        }
    }
}
