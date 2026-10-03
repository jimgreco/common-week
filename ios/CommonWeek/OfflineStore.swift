import Foundation

struct OfflineIdentity: Codable, Equatable {
    let userId: String
    let householdId: String
}

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
    var identity: OfflineIdentity?
    let createdAt: Date
    let kind: Kind
    let draft: PlanningItemDraft?
    let itemId: String?
    let completed: Bool?
    let startDate: String?
    let scope: String?
    let locationId: String?
    let memberIds: [String]?
    let location: GeocodingResult?
    let saveForReuse: Bool?

    init(
        id: UUID = UUID(),
        createdAt: Date = Date(),
        kind: Kind,
        identity: OfflineIdentity? = nil,
        draft: PlanningItemDraft? = nil,
        itemId: String? = nil,
        completed: Bool? = nil,
        startDate: String? = nil,
        scope: String? = nil,
        locationId: String? = nil,
        memberIds: [String]? = nil,
        location: GeocodingResult? = nil,
        saveForReuse: Bool? = nil
    ) {
        self.id = id
        self.identity = identity
        self.createdAt = createdAt
        self.kind = kind
        self.draft = draft
        self.itemId = itemId
        self.completed = completed
        self.startDate = startDate
        self.scope = scope
        self.locationId = locationId
        self.memberIds = memberIds
        self.location = location
        self.saveForReuse = saveForReuse
    }
}

private struct PlannerSnapshot: Codable {
    let savedAt: Date
    let planner: WeeklyPlannerData
}

actor OfflineStore {
    static let shared = OfflineStore()
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

    func cachedPlanner(userId: String, householdId: String, weekStart: String) -> WeeklyPlannerData? {
        let scoped = snapshotURL(userId: userId, householdId: householdId, weekStart: weekStart)
        let legacy = directory.appending(path: "planner-\(safe(userId))-\(safe(weekStart)).json")
        // Legacy snapshots contain their household identity; unlike old mutations,
        // they can be safely read when that identity matches the current account.
        for url in [scoped, legacy] {
            if let planner = try? read(PlannerSnapshot.self, from: url).planner,
               planner.household.id == householdId { return planner }
        }
        return nil
    }

    func latestCachedPlanner(userId: String, householdId: String, before weekStart: String?) -> WeeklyPlannerData? {
        let prefix = "planner-\(safe(userId))-"
        guard let urls = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return nil }
        return urls
            .filter { $0.lastPathComponent.hasPrefix(prefix) && $0.pathExtension == "json" }
            .compactMap { try? read(PlannerSnapshot.self, from: $0).planner }
            .filter { $0.household.id == householdId && (weekStart == nil || $0.weekStart < weekStart!) }
            .max { $0.weekStart < $1.weekStart }
    }

    func savePlanner(_ planner: WeeklyPlannerData, userId: String, savedAt: Date = Date()) throws {
        let url = snapshotURL(userId: userId, householdId: planner.household.id, weekStart: planner.weekStart)
        if let current = try? read(PlannerSnapshot.self, from: url), current.savedAt > savedAt { return }
        try write(PlannerSnapshot(savedAt: savedAt, planner: planner), to: url)
    }

    func pendingMutations(userId: String, householdId: String) -> [OfflineMutation] {
        let identity = OfflineIdentity(userId: userId, householdId: householdId)
        return ((try? queue(at: queueURL(identity))) ?? []).filter { $0.identity == identity }
    }

    func heldMutationCount(userId: String, householdId: String?) -> Int {
        let legacyName = "mutations-\(safe(userId)).json"
        let scopedPrefix = "mutations-v2-\(safe(userId))-"
        let current = householdId.map { OfflineIdentity(userId: userId, householdId: $0) }
        guard let urls = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return 0 }
        return urls.filter { $0.lastPathComponent == legacyName || $0.lastPathComponent.hasPrefix(scopedPrefix) }
            .reduce(0) { count, url in
                guard let mutations = try? queue(at: url) else { return count + 1 }
                return count + mutations.filter { current == nil || $0.identity == nil || $0.identity != current || url != queueURL(current!) }.count
            }
    }

    func enqueue(_ mutation: OfflineMutation, userId: String, householdId: String) throws {
        let identity = OfflineIdentity(userId: userId, householdId: householdId)
        guard mutation.identity == nil || mutation.identity == identity else { throw CocoaError(.fileWriteInvalidFileName) }
        let url = queueURL(identity)
        var mutations = try queue(at: url)
        var scoped = mutation
        scoped.identity = identity
        mutations.append(scoped)
        guard mutations.count <= 500 else { throw CocoaError(.fileWriteOutOfSpace) }
        try write(mutations, to: url)
    }

    func removeMutation(_ id: UUID, userId: String, householdId: String) throws {
        let identity = OfflineIdentity(userId: userId, householdId: householdId)
        let url = queueURL(identity)
        var mutations = try queue(at: url)
        mutations.removeAll { $0.id == id && $0.identity == identity }
        try write(mutations, to: url)
    }

    func clearAll() {
        try? fileManager.removeItem(at: directory)
    }

    private func snapshotURL(userId: String, householdId: String, weekStart: String) -> URL {
        directory.appending(path: "planner-\(safe(userId))-\(safe(householdId))-\(safe(weekStart)).json")
    }

    private func queueURL(_ identity: OfflineIdentity) -> URL {
        directory.appending(path: "mutations-v2-\(safe(identity.userId))-\(safe(identity.householdId)).json")
    }

    private func queue(at url: URL) throws -> [OfflineMutation] {
        guard fileManager.fileExists(atPath: url.path) else { return [] }
        // A damaged file may still contain recoverable drafts. Never overwrite it
        // with an empty queue merely because decoding or file protection failed.
        return try read([OfflineMutation].self, from: url)
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
