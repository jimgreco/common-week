import XCTest
import QuickLook
import Combine
@testable import CommonWeek

@MainActor
final class AttachmentPreviewTests: XCTestCase {
    func testTaskAndNoteFilesKeepTheirNamesAndBytesForPreviewAndAppHandoff() async throws {
        let planner = PreviewData.planner(weekStart: "2026-09-14")
        for type in ["task", "note"] {
            let resource = ["itemId": WorkspaceValue.string("attachment-test-\(type)-\(UUID().uuidString)")]
            let id = UUID().uuidString
            let bytes = Data("Bring towels and sunscreen.".utf8)
            try await WorkspaceAccess.mutate([
                "action": .string("add"), "resource": .object(resource), "id": .string(id),
                "kind": .string("file"), "text": .string("Family packing list.txt"), "fileData": .string(bytes.base64EncodedString()),
            ], planner: planner, userId: "demo-jim")
            let payload = try await WorkspaceAccess.load(planner: planner, resource: resource.mapValues { $0.stringValue! })
            let entry = try XCTUnwrap(payload.entries.first)
            let files = ItemFilePresentation()
            let opened = expectation(description: "Attachment is ready for the editor to present")
            let observation = files.$document.compactMap { $0 }.first().sink { _ in opened.fulfill() }
            files.open(entry, planner: planner)
            await fulfillment(of: [opened], timeout: 5)
            let url = try XCTUnwrap(files.document?.url)
            defer { observation.cancel(); files.clearPreview() }
            XCTAssertNil(files.openingFile)
            XCTAssertNil(files.error)
            XCTAssertEqual(url.lastPathComponent, "Family packing list.txt")
            XCTAssertEqual(try Data(contentsOf: url), bytes)
            XCTAssertTrue(AttachmentPreviewController.canPreview(url))
            let controller = AttachmentPreviewController(url: url, onClose: {})
            controller.loadViewIfNeeded()
            XCTAssertTrue(controller.children.first is QLPreviewController)
            XCTAssertEqual(controller.toolbarItems?.first?.title, "Open in…")
            XCTAssertEqual(controller.toolbarItems?.last?.title, "Share")
            XCTAssertEqual((controller.previewController(QLPreviewController(), previewItemAt: 0) as? NSURL), url as NSURL)
            files.document = nil
            files.clearPreview()
            XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
            try await WorkspaceAccess.mutate(["action": .string("remove"), "resource": .object(resource), "id": .string(id)], planner: planner, userId: "demo-jim")
        }
    }

    func testUnknownFileStillOffersOpenInAndShare() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("Family.custom-attachment-format")
        try Data([0, 1, 2, 3]).write(to: url)
        let controller = AttachmentPreviewController(url: url, onClose: {})
        controller.loadViewIfNeeded()
        // Catalyst can offer a generic Quick Look preview even for unknown formats.
        XCTAssertTrue(controller.contentUnavailableConfiguration != nil || controller.children.first is QLPreviewController)
        XCTAssertEqual(controller.toolbarItems?.compactMap(\.title), ["Open in…", "Share"])
    }
}
