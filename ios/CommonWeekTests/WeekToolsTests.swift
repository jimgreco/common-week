import XCTest
import PDFKit
@testable import CommonWeek
final class WeekToolsTests: XCTestCase {
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

    @MainActor private func coverageClient(fixture: String) -> APIClient {
        // Use the existing debug credential override without touching the user's Keychain.
        let previous = ProcessInfo.processInfo.environment["COMMON_WEEK_SESSION_TOKEN"]
        setenv("COMMON_WEEK_SESSION_TOKEN", "coverage-test-token", 1)
        defer {
            if let previous { setenv("COMMON_WEEK_SESSION_TOKEN", previous, 1) }
            else { unsetenv("COMMON_WEEK_SESSION_TOKEN") }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CoverageURLProtocol.self]
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
