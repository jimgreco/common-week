import XCTest
@testable import CommonWeek

final class WeekDateTests: XCTestCase {
    func testAddsDaysWithoutChangingDateShape() {
        XCTAssertEqual(WeekDate.addDays(6, to: "2026-08-10"), "2026-08-16")
    }

    func testWeekTitleUsesACompactSameMonthRange() {
        XCTAssertEqual(WeekDate.weekTitle("2026-08-10"), "August 10–16")
    }

    func testPreviewContainsACompleteWeek() {
        XCTAssertEqual(PreviewData.planner.days.count, 7)
        XCTAssertFalse(PreviewData.planner.editableCalendars.isEmpty)
    }
}
