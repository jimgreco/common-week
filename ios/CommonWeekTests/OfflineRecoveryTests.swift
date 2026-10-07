import XCTest
@testable import CommonWeek

@MainActor final class OfflineRecoveryTests: XCTestCase {
    private let user = PreviewData.user
    private var scope: OfflineIdentity { .init(userId: user.userId, householdId: user.householdId!) }

    private func fixture(_ mutations: [OfflineMutation]? = nil, corrupt: Data? = nil) async throws -> (OfflineRecoveryModel, OfflineStore, URL, RecoveryHTTPFixture) {
        let directory = FileManager.default.temporaryDirectory.appending(path: "recovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let data = try corrupt ?? encoder.encode(mutations ?? [draft()])
        try data.write(to: directory.appending(path: "mutations-\(user.userId).json"))
        let fixture = RecoveryHTTPFixture(user: user)
        let host = UUID().uuidString.lowercased() + ".recovery.test"
        RecoveryURLProtocol.register(fixture, host: host)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: config)
        addTeardownBlock { session.invalidateAndCancel(); RecoveryURLProtocol.unregister(host: host) }
        let prior = ProcessInfo.processInfo.environment["COMMON_WEEK_SESSION_TOKEN"]
        setenv("COMMON_WEEK_SESSION_TOKEN", "synthetic-recovery-token", 1)
        let api = APIClient(session: session, baseURL: URL(string: "https://\(host)")!)
        if let prior { setenv("COMMON_WEEK_SESSION_TOKEN", prior, 1) } else { unsetenv("COMMON_WEEK_SESSION_TOKEN") }
        let store = OfflineStore(directory: directory)
        let scope = self.scope
        let model = OfflineRecoveryModel(user: user, api: api, store: store) { fixture.active ? scope : nil }
        return (model, store, directory, fixture)
    }

    private func draft(kind: OfflineMutation.Kind = .createItem, identity: OfflineIdentity? = nil) -> OfflineMutation {
        .init(kind: kind, identity: identity, draft: .init(id: "00000000-0000-4000-8000-000000001077", text: "Synthetic private draft", type: .note, planningDate: nil, weekStartDate: "2026-10-05", remindAt: "2026-10-06T12:00:00Z", childId: "child-original", assignedMemberIds: ["original-person"]))
    }

    private func verify(_ model: OfflineRecoveryModel) async {
        await model.verify(email: user.email, householdId: user.householdId!, confirmedOriginal: true)
    }

    func testVerificationRequiresExplicitOriginalAccountAndHousehold() async throws {
        let (model, _, _, http) = try await fixture()
        for (email, household, confirmation) in [("wrong@example.invalid", scope.householdId, true), (user.email, "wrong-household", true), (user.email, scope.householdId, false)] {
            await model.verify(email: email, householdId: household, confirmedOriginal: confirmation)
            XCTAssertFalse(model.verified); XCTAssertTrue(model.files.isEmpty)
        }
        XCTAssertTrue(http.requests.isEmpty)
        await verify(model)
        XCTAssertTrue(model.verified); XCTAssertEqual(model.files.count, 1)
    }

    func testServerAccountAndHouseholdChangePreventsOpeningFiles() async throws {
        for changedUser in [false, true] {
            let (model, _, _, http) = try await fixture()
            http.user = SessionIdentity(userId: changedUser ? "another-user" : user.userId, email: user.email, displayName: user.displayName, avatarUrl: nil, householdId: changedUser ? scope.householdId : "another-household", role: "owner")
            await verify(model)
            XCTAssertFalse(model.verified); XCTAssertTrue(model.files.isEmpty)
        }
    }

    func testExportRetainsExactCorruptBytesAndNeverQueuesAnything() async throws {
        let bytes = Data("damaged but recoverable source\n\u{0}keep every byte".utf8)
        let (model, store, directory, _) = try await fixture(corrupt: bytes)
        await verify(model)
        let file = try XCTUnwrap(model.files.first)
        XCTAssertNil(file.mutations)
        let exported = await model.export(file)
        XCTAssertEqual(exported, bytes)
        XCTAssertEqual(try Data(contentsOf: directory.appending(path: file.name)), bytes)
        let pending = await store.pendingMutations(userId: user.userId, householdId: scope.householdId)
        XCTAssertTrue(pending.isEmpty)
    }

    func testDuplicateIDsBecomeExportOnlyAndOtherAccountsAreNotEnumerated() async throws {
        let original = draft()
        let (model, _, directory, _) = try await fixture([original, original])
        try Data("another account".utf8).write(to: directory.appending(path: "mutations-other-account.json"))
        await verify(model)
        XCTAssertEqual(model.files.count, 1); XCTAssertNil(model.files.first?.mutations)
    }

    func testOnlyUnattributedCreatesWithStableIDsCanBeRecovered() async throws {
        let (model, _, _, _) = try await fixture()
        XCTAssertTrue(model.canRecover(draft()))
        for kind in [OfflineMutation.Kind.updateItem, .toggleItem, .deleteItem, .assignSavedLocation, .assignGeocodedLocation] {
            XCTAssertFalse(model.canRecover(draft(kind: kind)))
        }
        XCTAssertFalse(model.canRecover(draft(identity: scope)), "Already attributed queues use normal scoped replay")
        XCTAssertFalse(model.canReview(draft(identity: .init(userId: "different", householdId: scope.householdId))))
    }

    func testReviewThenExplicitRecoveryPreservesEverySourceByteAndOmitsAssignments() async throws {
        let (model, store, directory, http) = try await fixture()
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, [])
        await model.review(mutation, in: file, confirmedHousehold: false)
        XCTAssertEqual(http.recoveryActions, [])
        await model.review(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(model.result?.status, "ready")
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(model.result?.status, "recovered")
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review", "recover"])
        XCTAssertEqual(try Data(contentsOf: directory.appending(path: file.name)), file.bytes)
        let pending = await store.pendingMutations(userId: user.userId, householdId: scope.householdId)
        XCTAssertTrue(pending.isEmpty)
        let request = try XCTUnwrap(http.requests.last)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Week-Of-Us-User"), scope.userId)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Week-Of-Us-Household"), scope.householdId)
        let body = try XCTUnwrap(http.bodies.last)
        let sent = try XCTUnwrap(body["draft"] as? [String: Any])
        XCTAssertEqual(sent["id"] as? String, mutation.draft?.id)
        XCTAssertTrue(sent["planningDate"] is NSNull)
        XCTAssertNil(sent["assignedMemberIds"]); XCTAssertNil(sent["childId"]); XCTAssertNil(sent["remindAt"])
    }

    func testOldEditsCanCompareCurrentTextButNeverReplay() async throws {
        let (model, _, _, http) = try await fixture([draft(kind: .updateItem)])
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        XCTAssertTrue(model.canCheckCurrent(mutation))
        await model.review(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(model.result?.status, "ready")
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review"])
    }

    func testConflictCannotBeRecoveredAndSourceChangeInvalidatesReview() async throws {
        let (model, _, directory, http) = try await fixture()
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        http.status = "existing"
        await model.review(mutation, in: file, confirmedHousehold: true)
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review"])
        http.status = "ready"
        await model.review(mutation, in: file, confirmedHousehold: true)
        try Data("changed source bytes".utf8).write(to: directory.appending(path: file.name))
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review", "review"])
        XCTAssertNil(model.result)
        let export = await model.export(file); XCTAssertNil(export)
    }

    func testCancelAndLateVerificationCallbackNeverRestoreDrafts() async throws {
        let (model, _, _, http) = try await fixture()
        let started = expectation(description: "session started")
        http.started = { started.fulfill() }; http.delay = 0.15
        let task = Task { await verify(model) }
        await fulfillment(of: [started], timeout: 2)
        model.cancel()
        await task.value
        XCTAssertFalse(model.verified); XCTAssertTrue(model.files.isEmpty); XCTAssertNil(model.result)
    }

    func testAccountSwitchAndLateReviewCallbackCannotPublishResultOrRecover() async throws {
        let (model, _, _, http) = try await fixture()
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        let started = expectation(description: "review started")
        http.recoveryStarted = { started.fulfill() }; http.delay = 0.1
        let task = Task { await model.review(mutation, in: file, confirmedHousehold: true) }
        await fulfillment(of: [started], timeout: 2)
        http.active = false
        await task.value
        XCTAssertNil(model.result)
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review"])
    }

    func testCancellationAfterSubmitIgnoresCallbackAndKeepsSource() async throws {
        let (model, _, directory, http) = try await fixture()
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        await model.review(mutation, in: file, confirmedHousehold: true)
        let submitted = expectation(description: "recovery submitted")
        http.recoveryStarted = { submitted.fulfill() }; http.delay = 0.1
        let task = Task { await model.recover(mutation, in: file, confirmedHousehold: true) }
        await fulfillment(of: [submitted], timeout: 2)
        model.cancel()
        await task.value
        XCTAssertFalse(model.verified); XCTAssertNil(model.result); XCTAssertTrue(model.files.isEmpty)
        XCTAssertEqual(http.recoveryActions, ["review", "recover"])
        XCTAssertEqual(try Data(contentsOf: directory.appending(path: file.name)), file.bytes)
    }

    func testLostResponseRequiresNewReviewAndDoesNotAutomaticallyRetry() async throws {
        let (model, _, _, http) = try await fixture()
        await verify(model)
        let file = try XCTUnwrap(model.files.first), mutation = try XCTUnwrap(file.mutations?.first)
        await model.review(mutation, in: file, confirmedHousehold: true)
        http.failRecover = true
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertNil(model.result)
        await model.recover(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(http.recoveryActions, ["review", "recover"])
        http.status = "recovered"
        await model.review(mutation, in: file, confirmedHousehold: true)
        XCTAssertEqual(model.result?.status, "recovered")
    }
}

private final class RecoveryHTTPFixture: @unchecked Sendable {
    var user: SessionIdentity
    var requests: [URLRequest] = []
    var bodies: [[String: Any]] = []
    var recoveryActions: [String] = []
    var status = "ready"
    var active = true
    var delay: TimeInterval = 0
    var failRecover = false
    var started: (() -> Void)?
    var recoveryStarted: (() -> Void)?
    init(user: SessionIdentity) { self.user = user }
}

private final class RecoveryURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var fixtures: [String: RecoveryHTTPFixture] = [:]
    static func register(_ fixture: RecoveryHTTPFixture, host: String) { lock.lock(); defer { lock.unlock() }; fixtures[host] = fixture }
    static func unregister(host: String) { lock.lock(); defer { lock.unlock() }; fixtures.removeValue(forKey: host) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let fixture = Self.fixtures[request.url!.host!]; Self.lock.unlock()
        guard let fixture else { return }
        fixture.requests.append(request)
        let data: Data
        var fail = false
        if request.url!.path == "/api/ios/session" {
            let encoded = try! JSONEncoder().encode(fixture.user)
            data = Data("{\"ok\":true,\"data\":".utf8) + encoded + Data("}".utf8)
            fixture.started?()
        } else {
            var bytes = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 2048)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; bytes.append(buffer, count: count) }
            }
            let body = try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            fixture.bodies.append(body)
            let action = body["action"] as! String
            fixture.recoveryActions.append(action)
            fail = action == "recover" && fixture.failRecover
            data = try! JSONSerialization.data(withJSONObject: ["ok": true, "data": ["status": action == "recover" ? "recovered" : fixture.status]])
            fixture.recoveryStarted?()
        }
        let shouldFail = fail
        DispatchQueue.global().asyncAfter(deadline: .now() + fixture.delay) { [self] in
            if shouldFail { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
