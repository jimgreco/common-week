import Foundation
import CryptoKit

struct OfflineRecoveryFile: Identifiable, Equatable {
    let name: String
    let bytes: Data
    let mutations: [OfflineMutation]?
    var id: String { name }
    var fingerprint: String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
}

struct OfflineRecoveryRequest: Encodable {
    struct Draft: Encodable {
        let id: String
        let text: String
        let type: PlanningItemType
        let planningDate: String?
        let weekStartDate: String
        enum CodingKeys: CodingKey { case id, text, type, planningDate, weekStartDate }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id); try c.encode(text, forKey: .text); try c.encode(type, forKey: .type)
            try c.encode(planningDate, forKey: .planningDate); try c.encode(weekStartDate, forKey: .weekStartDate)
        }
    }
    let action: String
    let originalUserId: String
    let originalHouseholdId: String
    let sourceMutationId: String
    let sourceDigest: String
    let draft: Draft
}

struct OfflineRecoveryResult: Decodable, Equatable {
    struct Item: Decodable, Equatable {
        let id: String
        let text: String
        let type: String
        let planningDate: String?
        let weekStartDate: String
        let isCompleted: Bool
    }
    let status: String
    let item: Item?
}

@MainActor
final class OfflineRecoveryModel: ObservableObject {
    let user: SessionIdentity
    let identity: OfflineIdentity
    @Published private(set) var files: [OfflineRecoveryFile] = []
    @Published private(set) var verified = false
    @Published private(set) var busy = false
    @Published private(set) var message: String?
    @Published private(set) var result: OfflineRecoveryResult?
    private var reviewedKey: String?
    private var generation = 0
    private var verifiedToken: String?
    private let api: APIClient
    private let store: OfflineStore
    private let currentIdentity: () -> OfflineIdentity?

    init(user: SessionIdentity, api: APIClient, store: OfflineStore, currentIdentity: @escaping () -> OfflineIdentity?) {
        self.user = user
        identity = OfflineIdentity(userId: user.userId, householdId: user.householdId ?? "")
        self.api = api; self.store = store; self.currentIdentity = currentIdentity
    }

    func cancel() {
        generation += 1
        verified = false; verifiedToken = nil; files = []; result = nil; reviewedKey = nil; busy = false; message = nil
    }

    func resetReview() { generation += 1; result = nil; reviewedKey = nil; busy = false; message = nil }

    private func valid(_ captured: Int, token: String?) -> Bool {
        generation == captured && !Task.isCancelled && currentIdentity() == identity && token != nil && api.token == token
    }

    func verify(email: String, householdId: String, confirmedOriginal: Bool) async {
        guard !busy else { return }
        cancel()
        guard confirmedOriginal, email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == user.email.lowercased(),
              householdId.trimmingCharacters(in: .whitespacesAndNewlines) == identity.householdId, !identity.householdId.isEmpty else {
            message = "Enter the original account email and household ID, and confirm they are correct. If unsure, stop here."
            return
        }
        let captured = generation, token = api.token
        busy = true
        defer { if generation == captured { busy = false } }
        do {
            let fresh = try await api.restoreSession()
            guard valid(captured, token: token) else { return }
            guard fresh.userId == identity.userId, fresh.householdId == identity.householdId, fresh.email.lowercased() == user.email.lowercased() else {
                cancel(); message = "The account or household changed. Close this screen and sign in to the original account and household."; return
            }
            let sources = try await store.recoveryFiles(userId: identity.userId)
            guard valid(captured, token: token) else { return }
            files = sources; verified = true; verifiedToken = token
        } catch {
            guard valid(captured, token: token) else { return }
            message = "Verification could not finish. Connect and try again. Every source file remains on this device."
        }
    }

    func canReview(_ mutation: OfflineMutation) -> Bool {
        mutation.identity == nil || mutation.identity == identity
    }

    func canCheckCurrent(_ mutation: OfflineMutation) -> Bool {
        canReview(mutation) && [.createItem, .updateItem].contains(mutation.kind)
            && mutation.draft?.id.flatMap(UUID.init(uuidString:)) != nil
    }

    func canRecover(_ mutation: OfflineMutation) -> Bool {
        mutation.identity == nil && mutation.kind == .createItem && canCheckCurrent(mutation)
    }

    private func request(_ mutation: OfflineMutation, action: String) throws -> OfflineRecoveryRequest {
        guard canCheckCurrent(mutation), let draft = mutation.draft, let id = draft.id else { throw APIError.invalidResponse }
        // Stable per-entry digest, independent of filename, order, or other drafts.
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.sortedKeys]
        let digest = SHA256.hash(data: try encoder.encode(mutation)).map { String(format: "%02x", $0) }.joined()
        return OfflineRecoveryRequest(action: action, originalUserId: identity.userId, originalHouseholdId: identity.householdId,
            sourceMutationId: mutation.id.uuidString, sourceDigest: digest,
            draft: .init(id: id, text: draft.text, type: draft.type, planningDate: draft.planningDate, weekStartDate: draft.weekStartDate))
    }

    func review(_ mutation: OfflineMutation, in file: OfflineRecoveryFile, confirmedHousehold: Bool) async {
        await perform(mutation, in: file, confirmedHousehold: confirmedHousehold, recovering: false)
    }

    func recover(_ mutation: OfflineMutation, in file: OfflineRecoveryFile, confirmedHousehold: Bool) async {
        await perform(mutation, in: file, confirmedHousehold: confirmedHousehold, recovering: true)
    }

    private func perform(_ mutation: OfflineMutation, in file: OfflineRecoveryFile, confirmedHousehold: Bool, recovering: Bool) async {
        guard !busy, verified, confirmedHousehold, file.mutations?.contains(mutation) == true else { return }
        let key = file.fingerprint + mutation.id.uuidString
        guard !recovering || (canRecover(mutation) && reviewedKey == key && result?.status == "ready") else { return }
        let captured = generation, token = verifiedToken
        guard valid(captured, token: token) else { cancel(); return }
        busy = true; message = nil
        defer { if generation == captured { busy = false } }
        do {
            let fresh = try await api.restoreSession()
            guard valid(captured, token: token) else { return }
            guard fresh.userId == identity.userId, fresh.householdId == identity.householdId else {
                cancel(); message = "Your account or household changed. Nothing else was sent."; return
            }
            guard !recovering || fresh.role != "viewer" else { message = "This household is read-only."; return }
            let unchanged = try await store.unchangedRecoveryFile(file, userId: identity.userId)
            guard valid(captured, token: token) else { return }
            guard unchanged else { resetReview(); message = "The source changed. Close and verify again before reviewing it."; return }
            let response = try await api.recoverOfflineDraft(request(mutation, action: recovering ? "recover" : "review"), identity: identity)
            guard valid(captured, token: token) else { return }
            result = response; reviewedKey = key
        } catch {
            guard valid(captured, token: token) else { return }
            result = nil; reviewedKey = nil
            message = "The result could not be confirmed. Review again before retrying; a completed recovery will not be repeated. The source file is unchanged."
        }
    }

    func export(_ file: OfflineRecoveryFile) async -> Data? {
        let captured = generation, token = verifiedToken
        guard verified, !busy, valid(captured, token: token), files.contains(file) else { return nil }
        guard (try? await store.unchangedRecoveryFile(file, userId: identity.userId)) == true,
              valid(captured, token: token) else { return nil }
        return file.bytes
    }
}
