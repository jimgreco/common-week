import BackgroundTasks
import Foundation

@MainActor
final class BackgroundRefreshCoordinator {
    static let shared = BackgroundRefreshCoordinator()
    static let identifier = "com.jimgreco.commonweek.refresh"

    private weak var planner: PlannerViewModel?

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
}
