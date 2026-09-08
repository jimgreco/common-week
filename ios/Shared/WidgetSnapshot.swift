import Foundation
struct WidgetSnapshot: Codable {
    struct Commitment: Codable { let title: String; let date: Date }
    let updated: Date
    let next: [Commitment]
    let tasks: [String]
    static let group = "group.com.jimgreco.commonweek"
    static let key = "plannerWidgetSnapshot"
    static func read() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key), let snapshot = try? JSONDecoder().decode(Self.self, from: data), Date().timeIntervalSince(snapshot.updated) < 86400 else { return nil }
        return snapshot
    }
}
