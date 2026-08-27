import XCTest

@MainActor
final class CommonWeekScreenshots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testAppStoreScreenshots() throws {
        launchDemo()
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

    func testAuthenticatedTaskAndNoteSaves() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let baseURL = environment["COMMON_WEEK_INTEGRATION_BASE_URL"],
              let token = environment["COMMON_WEEK_INTEGRATION_SESSION_TOKEN"] else {
            throw XCTSkip("Authenticated planning-item integration environment is not configured.")
        }

        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["COMMON_WEEK_API_BASE_URL"] = baseURL
        app.launchEnvironment["COMMON_WEEK_SESSION_TOKEN"] = token
        app.launch()
        XCUIDevice.shared.orientation = .portrait

        XCTAssertTrue(app.staticTexts["WEEKLY PLAN"].waitForExistence(timeout: 20))

        let taskText = "Simulator save task"
        app.buttons["Weekly tasks"].tap()
        XCTAssertTrue(app.buttons["Add a weekly task"].waitForExistence(timeout: 5))
        app.buttons["Add a weekly task"].tap()
        let taskField = app.textFields["What needs doing?"]
        XCTAssertTrue(taskField.waitForExistence(timeout: 5))
        taskField.tap()
        taskField.typeText(taskText)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons[taskText].waitForExistence(timeout: 10))

        let noteText = "Simulator save note"
        app.buttons["Weekly plans"].tap()
        XCTAssertTrue(app.buttons["Add a weekly plan"].waitForExistence(timeout: 5))
        app.buttons["Add a weekly plan"].tap()
        let noteField = app.textFields["What are you planning?"]
        XCTAssertTrue(noteField.waitForExistence(timeout: 5))
        noteField.tap()
        noteField.typeText(noteText)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons[noteText].waitForExistence(timeout: 10))
    }

    private func launchDemo() {
        setupSnapshot(app)
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["COMMON_WEEK_DEMO"] = "1"
        app.launchEnvironment["APP_STORE_SCREENSHOTS"] = "1"
        app.launch()
        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["WEEKLY PLAN"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Interactive preview · Changes stay on this device"].waitForExistence(timeout: 15))
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
