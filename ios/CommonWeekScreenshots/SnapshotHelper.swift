import Foundation
import UIKit
import XCTest

@MainActor
func setupSnapshot(_ app: XCUIApplication) {
    app.launchArguments += ["-FASTLANE_SNAPSHOT", "YES", "-ui_testing"]
}

@MainActor
func snapshot(_ name: String, timeWaitingForIdle timeout: TimeInterval = 1) {
    if timeout > 0 {
        RunLoop.current.run(until: Date().addingTimeInterval(timeout))
    }

    guard let hostHome = ProcessInfo.processInfo.environment["SIMULATOR_HOST_HOME"] else {
        XCTFail("SIMULATOR_HOST_HOME is unavailable")
        return
    }
    let directory = URL(fileURLWithPath: hostHome)
        .appendingPathComponent("Library/Caches/tools.fastlane/screenshots", isDirectory: true)
    do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let device = (ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] ?? "iPhone")
            .replacingOccurrences(of: #"Clone [0-9]+ of "#, with: "", options: .regularExpression)
        let file = directory.appendingPathComponent("\(device)-\(name).png")
        try XCUIScreen.main.screenshot().image.pngData()?.write(to: file, options: .atomic)
    } catch {
        XCTFail("Unable to save screenshot: \(error)")
    }
}
