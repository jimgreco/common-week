import SwiftUI

@main
struct CommonWeekApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var planner = PlannerViewModel()

    var body: some Scene {
        WindowGroup {
            RootView(auth: auth, planner: planner)
                .tint(CWTheme.accent)
                .task { await auth.restore() }
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
            case .signedIn(let user):
                PlannerView(viewModel: planner, auth: auth, user: user)
                    .task {
                        if planner.data == nil {
                            await planner.load()
                        }
                    }
            }
        }
    }
}
