import XCTest
import PDFKit
@testable import CommonWeek
final class WeekToolsTests: XCTestCase {
    @MainActor func testInlineCreateUsesPostWithAStableIdAndInsertsAfterItsAnchor() async throws {
        let previousDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"]
        unsetenv("COMMON_WEEK_DEMO")
        let model = PlannerViewModel(api: coverageClient(fixture: "inline"))
        if let previousDemo { setenv("COMMON_WEEK_DEMO", previousDemo, 1) }
        model.data = PreviewData.planner
        let anchor = try XCTUnwrap(model.data?.weeklyItems.first)
        let id = "00000000-0000-4000-8000-000000000099"
        let draft = PlanningItemDraft(id: id, text: "Inserted plan", type: .note,
                                      planningDate: nil, weekStartDate: anchor.weekStartDate,
                                      remindAt: nil, afterItemId: anchor.id)
        let saved = await model.saveItem(draft, creating: true)
        XCTAssertTrue(saved)
        let items = try XCTUnwrap(model.data?.weeklyItems)
        let anchorIndex = try XCTUnwrap(items.firstIndex { $0.id == anchor.id })
        XCTAssertEqual(items[anchorIndex + 1].id, id)
        XCTAssertNil(items[anchorIndex + 1].planningDate)
    }

    @MainActor func testCoverageLoadsRowsFromSingleAPIEnvelope() async throws {
        let client = coverageClient(fixture: "saved")
        let rows = try await client.coverage()
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(row.eventId, "school-visit")
        XCTAssertNil(row.dropOffUserId)
        XCTAssertEqual(row.pickupUserId, "adult")
        XCTAssertTrue(row.pickupConfirmed)
        XCTAssertEqual(row.notes, "Meet at the front door")
        XCTAssertEqual(row.revision, 3)
    }

    @MainActor func testCoverageLoadsEmptyRowsFromSingleAPIEnvelope() async throws {
        let rows = try await coverageClient(fixture: "empty").coverage()
        XCTAssertTrue(rows.isEmpty)
    }

    @MainActor func testCoverageSaveReturnsUpdatedRowsFromSingleAPIEnvelope() async throws {
        let entry = EventCoverage(calendarId: "calendar", eventId: "school-visit", childId: "child", pickupUserId: "adult", revision: 2)
        let rows = try await coverageClient(fixture: "save").saveCoverage(entry)
        XCTAssertEqual(rows.first?.revision, 3)
        XCTAssertEqual(rows.first?.pickupUserId, "adult")
        XCTAssertTrue(rows.first?.pickupConfirmed == true)
    }

    @MainActor func testCoveragePreservesServerErrorForRetry() async throws {
        do {
            _ = try await coverageClient(fixture: "failure").coverage()
            XCTFail("Expected the server failure")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Coverage is temporarily unavailable.")
        }
    }

    @MainActor func testGoogleConnectionExchangeSendsExistingSessionButNormalSignInDoesNot() async throws {
        let linked = try await coverageClient(fixture: "link").exchange(code: "completion", state: "state", connectingGoogle: true)
        let signedIn = try await coverageClient(fixture: "signin").exchange(code: "completion", state: "state")
        XCTAssertEqual(linked.token, "synthetic-new-session")
        XCTAssertEqual(signedIn.token, "synthetic-new-session")
    }

    @MainActor func testOfflineReplayRechecksHouseholdAndAccountBeforeSendingSavedDrafts() async throws {
        for fixture in ["changed-household", "changed-user"] {
            let directory = FileManager.default.temporaryDirectory.appending(path: "offline-preflight-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: directory) }
            let store = OfflineStore(directory: directory)
            let user = PreviewData.user
            let householdId = try XCTUnwrap(user.householdId)
            let draft = PlanningItemDraft(id: "draft-id", text: "Old household private draft", type: .note, planningDate: nil, weekStartDate: PreviewData.planner.weekStart, remindAt: nil)
            try await store.enqueue(OfflineMutation(kind: .createItem, draft: draft), userId: user.userId, householdId: householdId)
            try await store.savePlanner(PreviewData.planner, userId: user.userId)
            let previousDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"]
            unsetenv("COMMON_WEEK_DEMO")
            let model = PlannerViewModel(api: coverageClient(fixture: fixture), offlineStore: store)
            if let previousDemo { setenv("COMMON_WEEK_DEMO", previousDemo, 1) }
            await model.activate(user: user)
            XCTAssertNil(model.data)
            XCTAssertTrue(model.errorMessage?.contains("account or household changed") == true)
            model.deactivate()
            let original = await store.pendingMutations(userId: user.userId, householdId: householdId)
            XCTAssertEqual(original.first?.draft?.text, draft.text)
            XCTAssertEqual(original.count, 1)
            XCTAssertNil(model.data)
        }
    }

    @MainActor func testRejectedOfflineReplayKeepsOriginalDraftAndSendsBothScopeHeaders() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "offline-rejected-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = OfflineStore(directory: directory)
        let user = PreviewData.user
        let householdId = try XCTUnwrap(user.householdId)
        let draft = PlanningItemDraft(id: "draft-id", text: "Keep this failed draft", type: .note, planningDate: nil, weekStartDate: PreviewData.planner.weekStart, remindAt: nil)
        try await store.enqueue(OfflineMutation(kind: .createItem, draft: draft), userId: user.userId, householdId: householdId)
        let previousDemo = ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"]
        unsetenv("COMMON_WEEK_DEMO")
        let model = PlannerViewModel(api: coverageClient(fixture: "replay-failure"), offlineStore: store)
        if let previousDemo { setenv("COMMON_WEEK_DEMO", previousDemo, 1) }
        await model.activate(user: user)
        XCTAssertTrue(model.errorMessage?.contains("still saved") == true)
        model.deactivate()
        let pending = await store.pendingMutations(userId: user.userId, householdId: householdId)
        XCTAssertEqual(pending.first?.draft?.text, draft.text)
        XCTAssertEqual(pending.count, 1)
    }

    @MainActor private func coverageClient(fixture: String) -> APIClient {
        // Use the existing debug credential override without touching the user's Keychain.
        let previous = ProcessInfo.processInfo.environment["COMMON_WEEK_SESSION_TOKEN"]
        setenv("COMMON_WEEK_SESSION_TOKEN", "coverage-test-token", 1)
        defer {
            if let previous { setenv("COMMON_WEEK_SESSION_TOKEN", previous, 1) }
            else { unsetenv("COMMON_WEEK_SESSION_TOKEN") }
        }
        let configuration = URLSessionConfiguration.ephemeral
        if ["changed-household", "changed-user", "replay-failure"].contains(fixture) {
            configuration.protocolClasses = [OfflineReplayURLProtocol.self]
        } else {
            configuration.protocolClasses = fixture == "inline" ? [InlineCreateURLProtocol.self] : (fixture == "link" || fixture == "signin") ? [AuthExchangeURLProtocol.self] : [CoverageURLProtocol.self]
        }
        let session = URLSession(configuration: configuration)
        addTeardownBlock { session.invalidateAndCancel() }
        return APIClient(session: session, baseURL: URL(string: "https://\(fixture).coverage.test")!)
    }

    func testGoogleFractionalEventTimesAreParsed() {
        XCTAssertEqual(PlannerMoment.date(from: "2026-09-08T10:00:00.000Z"), PlannerMoment.date(from: "2026-09-08T10:00:00Z"))
    }
    func testUnassignedCoverageEncodesExplicitNulls() throws {
        let entry = EventCoverage(calendarId: UUID().uuidString, eventId: "google-occurrence", childId: UUID().uuidString)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(entry)) as? [String: Any])
        XCTAssertTrue(object["pickupUserId"] is NSNull)
        XCTAssertTrue(object["dropOffUserId"] is NSNull)
        XCTAssertNil(object["confirmation"])
    }
    @MainActor func testPDFPaginatesAndRetainsLongNotes() throws {
        let sentinel = "The final family handoff."
        let lines = ["Family week", String(repeating: "Long family note with several commitments. ", count: 700), String(repeating: "W", count: 240), sentinel]
        let url = try WeekPDF.create(lines: lines)
        defer { try? FileManager.default.removeItem(at: url) }
        let pdf = try XCTUnwrap(PDFDocument(url: url))
        XCTAssertGreaterThan(pdf.pageCount, 1)
        XCTAssertTrue(pdf.string?.contains(sentinel) == true)
        let image = try XCTUnwrap(pdf.page(at: 0)).thumbnail(of: CGSize(width: 1263, height: 893), for: .mediaBox)
        let attachment = XCTAttachment(image: image); attachment.name = "Family week PDF first page"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testQuickActionRoutesToCaptureAndMine() {
        NotificationCoordinator.shared.openQuickTasks(capture: true)
        XCTAssertEqual(NotificationCoordinator.shared.pendingDestination?.target, .taskWorkspace("quick-capture"))
        NotificationCoordinator.shared.openQuickTasks(capture: false)
        XCTAssertEqual(NotificationCoordinator.shared.pendingDestination?.target, .taskWorkspace("quick-mine"))
    }
    func testConfirmationStatusNeedsBothLegs() {
        var row = EventCoverage(calendarId: "calendar", eventId: "event", childId: "child")
        XCTAssertTrue(row.status.contains("Pickup needs an owner"))
        row.dropOffNeeded = false; row.pickupUserId = "adult"
        XCTAssertEqual(row.status, "Pickup awaiting confirmation")
        row.pickupConfirmed = true
        XCTAssertEqual(row.status, "Coverage confirmed")
    }
}

private final class CoverageURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/coverage")
        XCTAssertEqual(request.httpMethod, request.url?.host == "save.coverage.test" ? "POST" : "GET")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer coverage-test-token")
        let response: String
        let status: Int
        switch request.url?.host {
        case "empty.coverage.test":
            status = 200
            response = #"{"ok":true,"data":[]}"#
        case "failure.coverage.test":
            status = 503
            response = #"{"ok":false,"error":"Coverage is temporarily unavailable."}"#
        default:
            status = 200
            response = #"{"ok":true,"data":[{"calendarId":"calendar","eventId":"school-visit","childId":"child","dropOffUserId":null,"pickupUserId":"adult","dropOffNeeded":true,"pickupNeeded":true,"dropOffConfirmed":false,"pickupConfirmed":true,"travelMinutes":20,"notes":"Meet at the front door","revision":3}]}"#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(response.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}


private final class InlineCreateURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url?.path == "/api/ios/planning-items" {
            XCTAssertEqual(request.httpMethod, "POST", "A stable client-generated id must still create, not patch")
            let item = PlanningItem(id: "00000000-0000-4000-8000-000000000099", planningDate: nil,
                                    weekStartDate: PreviewData.planner.weekStart, type: .note, text: "Inserted plan",
                                    isCompleted: false, sortOrder: 1, createdBy: "demo-jim", createdByName: "Jim",
                                    updatedAt: "2026-09-29T12:00:00Z", saveState: "saved", reminder: nil)
            let object = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(item))
            let body = try! JSONSerialization.data(withJSONObject: ["ok": true, "data": object])
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
                                 httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } else { client?.urlProtocol(self, didFailWithError: URLError(.cancelled)) }
    }
    override func stopLoading() {}
}


private final class AuthExchangeURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/ios/auth/exchange")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), request.url?.host == "link.coverage.test" ? "Bearer coverage-test-token" : nil)
        let body = Data(#"{"ok":true,"data":{"token":"synthetic-new-session","expiresAt":"2026-11-01T00:00:00Z"}}"#.utf8)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}


private final class OfflineReplayURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let fixture = request.url?.host?.components(separatedBy: ".").first
        let body: Data
        let status: Int
        if request.url?.path == "/api/ios/session" {
            XCTAssertEqual(request.httpMethod, "GET")
            let user = PreviewData.user
            let object: [String: Any] = ["ok": true, "data": [
                "userId": fixture == "changed-user" ? "new-user" : user.userId,
                "householdId": fixture == "changed-household" ? "new-household" : user.householdId!,
                "email": "synthetic@example.invalid", "displayName": "Synthetic", "role": "owner"
            ]]
            body = try! JSONSerialization.data(withJSONObject: object)
            status = 200
        } else if request.url?.path == "/api/ios/planning-items" {
            XCTAssertEqual(fixture, "replay-failure", "A changed account or household must not receive the old draft")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Week-Of-Us-User"), PreviewData.user.userId)
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Week-Of-Us-Household"), PreviewData.user.householdId)
            body = Data(#"{"ok":false,"error":"Synthetic rejected replay"}"#.utf8)
            status = 400
        } else {
            client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
            return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
