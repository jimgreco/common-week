import XCTest
@testable import CommonWeek

final class CalendarTimelineTests: XCTestCase {
    private let date = "2026-09-14"
    private let timezone = "America/New_York"

    private func event(_ id: String, _ start: String, _ end: String, allDay: Bool = false) throws -> CalendarEvent {
        let source = PreviewData.planner.days[0].events[0]
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(source)) as? [String: Any])
        json["id"] = id; json["start"] = start; json["end"] = end; json["allDay"] = allDay
        return try JSONDecoder().decode(CalendarEvent.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func timed(_ id: String, _ start: String, _ end: String) throws -> CalendarEvent {
        try event(id, "\(date)T\(start):00-04:00", "\(date)T\(end):00-04:00")
    }

    func testOverlapGroupsReuseColumnsAndLeaveGaps() throws {
        let events = try [timed("a", "09:00", "12:00"), timed("b", "09:30", "10:30"), timed("c", "10:00", "11:00"), timed("d", "11:00", "12:00"), timed("later", "13:00", "14:00")]
        let blocks = CalendarTimelineLayout.blocks(events: events, date: date, timezone: timezone)
        XCTAssertEqual(blocks.map(\.column), [0, 1, 2, 1, 0])
        XCTAssertEqual(blocks.map(\.columnCount), [3, 3, 3, 3, 1])
        XCTAssertEqual(blocks.map(\.overlaps), [true, true, true, true, false])
        XCTAssertEqual(blocks.first?.startMinute, 540)
    }

    func testAdjacentEventsAndFilteredEventsHaveNoOverlap() throws {
        let a = try timed("a", "09:00", "10:00")
        let b = try timed("b", "10:00", "11:00")
        let blocks = CalendarTimelineLayout.blocks(events: [a, b], date: date, timezone: timezone)
        XCTAssertTrue(blocks.allSatisfy { !$0.overlaps && $0.columnCount == 1 })
        XCTAssertFalse(CalendarTimelineLayout.blocks(events: [a], date: date, timezone: timezone)[0].overlaps)
    }

    func testOvernightClippingAndExclusiveMidnightEnd() throws {
        let night = try event("night", "2026-09-13T23:00:00-04:00", "2026-09-14T02:00:00-04:00")
        let block = try XCTUnwrap(CalendarTimelineLayout.blocks(events: [night], date: date, timezone: timezone).first)
        XCTAssertEqual(block.startMinute, 0); XCTAssertEqual(block.endMinute, 120)
        let midnight = try event("midnight", "2026-09-13T23:00:00-04:00", "2026-09-14T00:00:00-04:00")
        XCTAssertTrue(CalendarTimelineLayout.blocks(events: [midnight], date: date, timezone: timezone).isEmpty)
    }

    func testAllDayInvalidAndDuplicateEventsAreExcluded() throws {
        let a = try timed("a", "09:00", "10:00")
        let allDay = try event("all", date, "2026-09-15", allDay: true)
        let invalid = try event("bad", "invalid", "invalid")
        XCTAssertEqual(CalendarTimelineLayout.blocks(events: [a, a, allDay, invalid], date: date, timezone: timezone).map(\.id), ["a"])
    }

    func testHouseholdTimeZoneAheadOfUTC() throws {
        let tokyo = try event("tokyo", "2026-09-13T23:30:00Z", "2026-09-14T01:00:00Z")
        let block = try XCTUnwrap(CalendarTimelineLayout.blocks(events: [tokyo], date: date, timezone: "Asia/Tokyo").first)
        XCTAssertEqual(block.startMinute, 510); XCTAssertEqual(block.endMinute, 600)
    }

    func testPreviewEventsBelongToTheirDisplayedDay() {
        let planner = PreviewData.planner
        for day in planner.days {
            let blocks = CalendarTimelineLayout.blocks(events: day.events, date: day.date, timezone: planner.household.timezone)
            XCTAssertEqual(blocks.count, day.events.filter { !$0.allDay }.count, day.date)
        }
    }

    func testDaylightSavingTransitionsKeepEventsVisible() throws {
        let spring = try event("spring", "2026-03-08T01:30:00-05:00", "2026-03-08T03:30:00-04:00")
        let block = try XCTUnwrap(CalendarTimelineLayout.blocks(events: [spring], date: "2026-03-08", timezone: timezone).first)
        XCTAssertEqual(block.startMinute, 90); XCTAssertEqual(block.endMinute, 210)
        let fall = try event("fall", "2026-11-01T01:45:00-04:00", "2026-11-01T01:15:00-05:00")
        let repeated = try XCTUnwrap(CalendarTimelineLayout.blocks(events: [fall], date: "2026-11-01", timezone: timezone).first)
        XCTAssertGreaterThan(repeated.endMinute, repeated.startMinute)
        XCTAssertEqual(CalendarTimelineLayout.label(fall, date: "2026-11-01", timezone: timezone), "1:45 AM EDT – 1:15 AM EST")
    }
}
