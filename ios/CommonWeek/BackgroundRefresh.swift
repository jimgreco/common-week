import BackgroundTasks
import Foundation

@MainActor
final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()
    static let identifier = "com.jimgreco.commonweek.refresh"
    static let activeRefreshInterval: TimeInterval = 15 * 60

    private weak var planner: PlannerViewModel?
    private var activeRefreshTask: Task<Void, Never>?

    private init() {}

    func register(planner: PlannerViewModel) {
        self.planner = planner
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.identifier, using: nil) { [weak self] task in
            guard let refreshTask = task as? BGAppRefreshTask, let planner = self?.planner else {
                task.setTaskCompleted(success: false)
                return
            }
            self?.schedule()
            let operation = Task { @MainActor in
                let success = await planner.performBackgroundRefresh()
                refreshTask.setTaskCompleted(success: success)
            }
            refreshTask.expirationHandler = { operation.cancel() }
        }
    }

    func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    func applicationDidBecomeActive() {
        #if targetEnvironment(macCatalyst)
        guard activeRefreshTask == nil else { return }
        activeRefreshTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.activeRefreshInterval))
                guard !Task.isCancelled, let planner = self?.planner else { return }
                _ = await planner.performBackgroundRefresh()
            }
        }
        #endif
    }

    func applicationDidEnterBackground() {
        activeRefreshTask?.cancel()
        activeRefreshTask = nil
        schedule()
    }
}
