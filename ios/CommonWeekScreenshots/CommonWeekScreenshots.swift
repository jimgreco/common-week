import XCTest

@MainActor
final class CommonWeekScreenshots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        setupSnapshot(app)
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["COMMON_WEEK_DEMO"] = "1"
        app.launchEnvironment["APP_STORE_SCREENSHOTS"] = "1"
        app.launch()
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["WEEKLY PLAN"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Interactive preview · Changes stay on this device"].waitForExistence(timeout: 15))
    }

    func testAppStoreScreenshots() throws {
        snapshot("01-Shared-Week")

        let tasks = app.buttons["Weekly tasks"]
        XCTAssertTrue(tasks.waitForExistence(timeout: 5))
        tasks.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Order groceries"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Confirm weekend plans"].waitForExistence(timeout: 5))
        snapshot("02-Weekly-Tasks")

        let settings = app.buttons["Settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        let calendarStatus = app.staticTexts["Google Calendar connected"]
        XCTAssertTrue(scrollToExistence(calendarStatus))
        app.swipeUp()
        snapshot("03-Calendar-Privacy")
    }

    private func scrollToExistence(_ element: XCUIElement, maxSwipes: Int = 6) -> Bool {
        if element.waitForExistence(timeout: 1) { return true }
        for _ in 0..<maxSwipes {
            app.swipeUp()
            if element.waitForExistence(timeout: 1) { return true }
        }
        return element.exists
    }
}
