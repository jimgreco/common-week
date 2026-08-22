import Foundation

struct OfflineMutation: Codable, Identifiable, Equatable {
    enum Kind: String, Codable {
        case createItem
        case updateItem
        case toggleItem
        case deleteItem
        case assignSavedLocation
        case assignGeocodedLocation
    }

    let id: UUID
    let createdAt: Date
    let kind: Kind
    let draft: PlanningItemDraft?
    let itemId: String?
    let completed: Bool?
    let startDate: String?
    let scope: String?
    let locationId: String?
    let location: GeocodingResult?
    let saveForReuse: Bool?

    init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        kind: Kind,
        draft: PlanningItemDraft? = nil,
        itemId: String? = nil,
        completed: Bool? = nil,
        startDate: String? = nil,
        scope: String? = nil,
        locationId: String? = nil,
        location: GeocodingResult? = nil,
        saveForReuse: Bool? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.kind = kind
        self.draft = draft
        self.itemId = itemId
        self.completed = completed
        self.startDate = startDate
        self.scope = scope
        self.locationId = locationId
        self.location = location
        self.saveForReuse = saveForReuse
    }
}

private struct PlannerSnapshot: Codable {
    let savedAt: Date
    let planner: WeeklyPlannerData
}

actor OfflineStore {
    private let fileManager: FileManager
    private let directory: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileManager: FileManager = .default, directory: URL? = nil) {
        self.fileManager = fileManager
        self.directory = directory ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "WeekOfUs", directoryHint: .isDirectory)
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func cachedPlanner(userId: String, weekStart: String) -> WeeklyPlannerData? {
        try? read(PlannerSnapshot.self, from: snapshotURL(userId: userId, weekStart: weekStart)).planner
    }

    func savePlanner(_ planner: WeeklyPlannerData, userId: String, savedAt: Date = Date()) throws {
        let url = snapshotURL(userId: userId, weekStart: planner.weekStart)
        if let current = try? read(PlannerSnapshot.self, from: url), current.savedAt > savedAt { return }
        try write(PlannerSnapshot(savedAt: savedAt, planner: planner), to: url)
    }

    func pendingMutations(userId: String) -> [OfflineMutation] {
        (try? read([OfflineMutation].self, from: queueURL(userId: userId))) ?? []
    }

    func enqueue(_ mutation: OfflineMutation, userId: String) throws {
        var mutations = pendingMutations(userId: userId)
        mutations.append(mutation)
        guard mutations.count <= 500 else { throw CocoaError(.fileWriteOutOfSpace) }
        try write(mutations, to: queueURL(userId: userId))
    }

    func removeMutation(_ id: UUID, userId: String) throws {
        var mutations = pendingMutations(userId: userId)
        mutations.removeAll { $0.id == id }
        try write(mutations, to: queueURL(userId: userId))
    }

    private func snapshotURL(userId: String, weekStart: String) -> URL {
        directory.appending(path: "planner-\(safe(userId))-\(safe(weekStart)).json")
    }

    private func queueURL(userId: String) -> URL {
        directory.appending(path: "mutations-\(safe(userId)).json")
    }

    private func safe(_ value: String) -> String {
        value.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "_" }.reduce(into: "") { $0.append($1) }
    }

    private func read<Value: Decodable>(_ type: Value.Type, from url: URL) throws -> Value {
        try decoder.decode(type, from: Data(contentsOf: url))
    }

    private func write<Value: Encodable>(_ value: Value, to url: URL) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var directoryValues = URLResourceValues()
        directoryValues.isExcludedFromBackup = true
        var protectedDirectory = directory
        try? protectedDirectory.setResourceValues(directoryValues)

        try encoder.encode(value).write(to: url, options: .atomic)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        var fileValues = URLResourceValues()
        fileValues.isExcludedFromBackup = true
        var protectedFile = url
        try? protectedFile.setResourceValues(fileValues)
    }
}
