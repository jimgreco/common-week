import XCTest
@testable import CommonWeek

final class WeekDateTests: XCTestCase {
    func testAddsDaysWithoutChangingDateShape() {
        XCTAssertEqual(WeekDate.addDays(6, to: "2026-08-10"), "2026-08-16")
    }

    func testWeekTitleUsesACompactSameMonthRange() {
        XCTAssertEqual(WeekDate.weekTitle("2026-08-10"), "August 10–16")
    }

    func testTodayComparisonDoesNotShiftDateAtEasternMidnight() {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        let today = formatter.string(from: Date())
        XCTAssertTrue(WeekDate.isToday(today, timeZoneIdentifier: "America/New_York"))
        XCTAssertFalse(WeekDate.isToday(WeekDate.addDays(1, to: today), timeZoneIdentifier: "America/New_York"))
    }

    func testCalendarDateKeepsTheSelectedDayInTheHouseholdTimeZone() {
        let date = WeekDate.calendarDate(
            "2026-08-15",
            hour: 9,
            timeZoneIdentifier: "America/New_York"
        )
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!

        XCTAssertEqual(calendar.component(.day, from: date), 15)
        XCTAssertEqual(calendar.component(.hour, from: date), 9)
        XCTAssertEqual(
            WeekDate.string(date, timeZoneIdentifier: "America/New_York"),
            "2026-08-15"
        )
    }

    func testCalendarDateRoundTripsAheadOfUTC() {
        let date = WeekDate.calendarDate(
            "2026-08-15",
            timeZoneIdentifier: "Asia/Tokyo"
        )

        XCTAssertEqual(
            WeekDate.string(date, timeZoneIdentifier: "Asia/Tokyo"),
            "2026-08-15"
        )
    }

    func testPreviewContainsACompleteWeek() {
        XCTAssertEqual(PreviewData.planner.days.count, 7)
        XCTAssertFalse(PreviewData.planner.editableCalendars.isEmpty)
    }

    func testSessionIdentityDecodesGoogleAvatarURL() throws {
        let payload = Data(#"{"userId":"user","email":"jim@example.com","displayName":"Jim","avatarUrl":"https://lh3.googleusercontent.com/avatar","householdId":"household","role":"owner"}"#.utf8)
        let identity = try JSONDecoder().decode(SessionIdentity.self, from: payload)

        XCTAssertEqual(identity.avatarUrl?.host, "lh3.googleusercontent.com")
    }

    func testCalendarSettingsDecodeNativeManagementState() throws {
        let payload = Data(##"{"calendars":[{"id":"calendar-1","userId":"user-1","googleCalendarId":"family@example.com","calendarName":"Family","displayAlias":"Home","displayAbbreviation":"HM","color":"#123456","visibility":"share","isPrimary":true,"sectionGroup":"critical","accessRole":"owner"}],"connected":true,"writeEnabled":true}"##.utf8)
        let settings = try JSONDecoder().decode(CalendarSettings.self, from: payload)

        XCTAssertTrue(settings.connected)
        XCTAssertTrue(settings.writeEnabled)
        XCTAssertEqual(settings.calendars.first?.visibility, .share)
        XCTAssertEqual(settings.calendars.first?.displayAlias, "Home")
    }

    func testCalendarPreferenceUpdateEncodesTheNativeAction() throws {
        let calendar = CalendarPreference(id: "calendar-1", userId: "user-1", googleCalendarId: "family@example.com", calendarName: "Family", displayAlias: "Home", displayAbbreviation: "HM", color: "#123456", visibility: .private, isPrimary: true, sectionGroup: .supplemental, accessRole: "owner")
        let encoded = try JSONEncoder().encode(CalendarPreferenceUpdate(calendar))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: String])

        XCTAssertEqual(payload["action"], "updateCalendar")
        XCTAssertEqual(payload["visibility"], "private")
        XCTAssertEqual(payload["sectionGroup"], "supplemental")
    }
}
