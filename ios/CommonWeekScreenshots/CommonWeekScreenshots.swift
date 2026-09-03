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

        let tasks = app.buttons["Weekly and daily tasks"]
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
        app.buttons["Weekly and daily tasks"].tap()
        XCTAssertTrue(app.buttons["Add a weekly task"].waitForExistence(timeout: 5))
        app.buttons["Add a weekly task"].tap()
        let taskField = app.textFields["What needs doing?"]
        XCTAssertTrue(taskField.waitForExistence(timeout: 5))
        taskField.tap()
        taskField.typeText(taskText)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons[taskText].waitForExistence(timeout: 10))

        let noteText = "Simulator save note"
        app.buttons["Weekly and daily plans"].tap()
        XCTAssertTrue(app.buttons["Add a weekly plan"].waitForExistence(timeout: 5))
        app.buttons["Add a weekly plan"].tap()
        let noteField = app.textFields["What are you planning?"]
        XCTAssertTrue(noteField.waitForExistence(timeout: 5))
        noteField.tap()
        noteField.typeText(noteText)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons[noteText].waitForExistence(timeout: 10))
    }

    func testEventLocationAutocomplete() throws {
        launchDemo()

        let addEvent = app.buttons["Add event"].firstMatch
        XCTAssertTrue(scrollToExistence(addEvent))
        addEvent.tap()
        XCTAssertTrue(app.navigationBars["Add event"].waitForExistence(timeout: 5))

        let locationField = app.textFields["event-location-search"]
        XCTAssertTrue(scrollToExistence(locationField))
        locationField.tap()
        locationField.typeText("Wolffer")

        let suggestion = app.buttons["event-location-suggestion-demo-wolffer"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5))
        let suggestionIsHittable = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"),
            object: suggestion
        )
        XCTAssertEqual(XCTWaiter.wait(for: [suggestionIsHittable], timeout: 3), .completed)
        XCTAssertTrue(app.staticTexts["event-location-attribution"].exists)

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "Event location autocomplete"
        attachment.lifetime = .keepAlways
        add(attachment)

        suggestion.tap()
        XCTAssertEqual(
            locationField.value as? String,
            "Wölffer Estate Vineyard, Sagg Road, Sagaponack, NY, USA"
        )
    }

    func testPlannerContentTabsShowFullWeekRollups() throws {
        launchDemo()

        XCTAssertTrue(app.buttons["Daily planner"].exists)
        XCTAssertTrue(app.buttons["Weekly events"].exists)
        XCTAssertTrue(app.buttons["Weekly and daily plans"].exists)
        XCTAssertTrue(app.buttons["Weekly and daily tasks"].exists)

        app.buttons["Weekly events"].tap()
        XCTAssertTrue(app.staticTexts["Weekly events"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Camp"].waitForExistence(timeout: 5))
        attachCurrentScreen(named: "Weekly events rollup")

        app.buttons["Weekly and daily plans"].tap()
        XCTAssertTrue(app.staticTexts["All plans"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Keep Saturday afternoon open"].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollToExistence(app.descendants(matching: .any)["Dinner: Pasta"]))
        attachCurrentScreen(named: "Weekly and daily plans rollup")

        app.buttons["Weekly and daily tasks"].tap()
        XCTAssertTrue(app.staticTexts["All tasks"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["Order groceries"].waitForExistence(timeout: 5))
        XCTAssertTrue(scrollToExistence(app.descendants(matching: .any)["Groceries"]))
        attachCurrentScreen(named: "Weekly and daily tasks rollup")
    }

    func testDailyItemEditorAllowsRescheduling() throws {
        launchDemo()

        app.buttons["Weekly and daily tasks"].tap()
        let task = app.buttons["Groceries"]
        XCTAssertTrue(scrollToExistence(task))
        task.tap()

        XCTAssertTrue(app.navigationBars["Edit item"].waitForExistence(timeout: 5))
        let when = app.datePickers["planning-date"]
        XCTAssertTrue(when.waitForExistence(timeout: 5))
        XCTAssertTrue(when.isEnabled)
    }

    #if targetEnvironment(macCatalyst)
    func testMacPlanModalUsesPolishedChrome() throws {
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["COMMON_WEEK_DEMO"] = "1"
        app.launch()

        let plansSection = app.descendants(matching: .any)["mac-sidebar-plans"]
        XCTAssertTrue(plansSection.waitForExistence(timeout: 15))
        plansSection.tap()
        app.buttons["New Item"].tap()

        XCTAssertTrue(app.staticTexts["Add plan"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Capture an idea, intention, or note for the week."].exists)
        XCTAssertTrue(app.buttons["Cancel"].exists)
        XCTAssertTrue(app.buttons["Save"].exists)
        XCTAssertTrue(app.textFields["What are you planning?"].exists)
        XCTAssertTrue(app.staticTexts["This week"].exists)

        attachCurrentScreen(named: "Mac add plan modal")

        app.buttons["Cancel"].tap()
        let tasksSection = app.descendants(matching: .any)["mac-sidebar-weekOfUsTasks"]
        XCTAssertTrue(tasksSection.waitForExistence(timeout: 5))
        tasksSection.tap()
        app.buttons["New Item"].tap()

        XCTAssertTrue(app.staticTexts["Add task"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["What needs doing?"].exists)
        XCTAssertTrue(app.staticTexts["This week"].exists)
    }

    func testMacPlannerShellNavigationAndUnsavedEditProtection() throws {
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["COMMON_WEEK_DEMO"] = "1"
        app.launch()

        XCTAssertTrue(app.buttons["Previous Week"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["Today"].exists)
        XCTAssertTrue(app.buttons["Next Week"].exists)
        XCTAssertTrue(app.buttons["Refresh"].exists)
        XCTAssertTrue(app.buttons["New Item"].exists)

        let tasksSection = app.descendants(matching: .any)["mac-sidebar-weekOfUsTasks"]
        XCTAssertTrue(tasksSection.waitForExistence(timeout: 15))
        tasksSection.tap()

        let task = app.descendants(matching: .any)["mac-planning-item-weekly-task-1"]
        XCTAssertTrue(task.waitForExistence(timeout: 5))
        task.tap()

        let editor = app.textFields["What needs doing?"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" updated")

        app.descendants(matching: .any)["mac-sidebar-events"].tap()
        XCTAssertTrue(app.staticTexts["Discard unsaved changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep Editing"].tap()
        XCTAssertTrue(editor.exists)

        app.descendants(matching: .any)["mac-sidebar-events"].tap()
        app.buttons["Discard Changes"].tap()
        XCTAssertTrue(app.navigationBars["Events"].waitForExistence(timeout: 5))

        app.typeKey("f", modifierFlags: .command)
        XCTAssertTrue(app.staticTexts["Search"].waitForExistence(timeout: 5))
    }
    #endif

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

    private func attachCurrentScreen(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
