import XCTest
import PDFKit
@testable import CommonWeek
final class WeekToolsTests: XCTestCase {
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
