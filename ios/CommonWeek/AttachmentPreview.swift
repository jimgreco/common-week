import SwiftUI
import QuickLook
import UIKit

struct AttachmentDocument: Identifiable {
    let url: URL
    var id: URL { url }
}

@MainActor
final class ItemFilePresentation: ObservableObject {
    @Published var document: AttachmentDocument?
    @Published var importing = false
    @Published var openingFile: String?
    @Published var error: String?
    private var localURL: URL?
    private var downloadTask: Task<Void, Never>?
    private var importCompletion: ((Result<URL, Error>) -> Void)?

    func open(_ entry: WorkspaceEntry, planner: WeeklyPlannerData) {
        guard openingFile == nil else { return }
        openingFile = entry.id
        error = nil
        downloadTask = Task {
            defer { openingFile = nil }
            do {
                let url = try await WorkspaceAccess.file(entry, planner: planner)
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
                    return
                }
                localURL = url
                document = AttachmentDocument(url: url)
            } catch {
                if !Task.isCancelled { self.error = "This file could not be opened. \(error.localizedDescription)" }
            }
        }
    }

    func beginImport(completion: @escaping (Result<URL, Error>) -> Void) {
        importCompletion = completion
        importing = true
    }

    func finishImport(_ result: Result<URL, Error>) {
        let completion = importCompletion
        importCompletion = nil
        completion?(result)
    }

    func clearPreview() {
        if let localURL { try? FileManager.default.removeItem(at: localURL.deletingLastPathComponent()) }
        localURL = nil
    }

    func cancelPendingWork() {
        downloadTask?.cancel()
        importCompletion = nil
    }
}

private struct ItemFilePresentationModifier: ViewModifier {
    @ObservedObject var files: ItemFilePresentation

    func body(content: Content) -> some View {
        content
            .sheet(item: $files.document, onDismiss: files.clearPreview) { document in
                AttachmentPreview(document: document) { files.document = nil }
            }
            .fileImporter(isPresented: $files.importing, allowedContentTypes: [.item], onCompletion: files.finishImport)
            .onDisappear { files.cancelPendingWork() }
    }
}

extension View {
    // Attach to the editor container, never its lazy Form rows or a Group of Sections.
    func itemFilePresentation(_ files: ItemFilePresentation) -> some View {
        modifier(ItemFilePresentationModifier(files: files))
    }
}

struct AttachmentPreview: UIViewControllerRepresentable {
    let document: AttachmentDocument
    let onClose: () -> Void

    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = AttachmentPreviewController(url: document.url, onClose: onClose)
        let navigation = UINavigationController(rootViewController: controller)
        navigation.setToolbarHidden(false, animated: false)
        return navigation
    }

    func updateUIViewController(_ controller: UINavigationController, context: Context) {}
}

final class AttachmentPreviewController: UIViewController, QLPreviewControllerDataSource {
    private let url: URL
    private let onClose: () -> Void
    // Retain the controller for the entire menu/app handoff.
    private let documentController: UIDocumentInteractionController

    init(url: URL, onClose: @escaping () -> Void) {
        self.url = url
        self.onClose = onClose
        documentController = UIDocumentInteractionController(url: url)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = url.lastPathComponent
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.onClose() })
        let open = UIBarButtonItem(title: "Open in…", style: .plain, target: self, action: #selector(openIn(_:)))
        open.accessibilityIdentifier = "attachment-open-in"
        let share = UIBarButtonItem(title: "Share", style: .plain, target: self, action: #selector(share(_:)))
        toolbarItems = [open, .flexibleSpace(), share]

        if Self.canPreview(url) {
            let preview = QLPreviewController()
            preview.dataSource = self
            addChild(preview)
            view.addSubview(preview.view)
            preview.view.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                preview.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                preview.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                preview.view.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                preview.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            ])
            preview.didMove(toParent: self)
        } else {
            var empty = UIContentUnavailableConfiguration.empty()
            empty.image = UIImage(systemName: "doc")
            empty.text = "Preview unavailable"
            empty.secondaryText = "Use Open in… to open this file in a compatible app, or Share to save a copy."
            contentUnavailableConfiguration = empty
        }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }

    static func canPreview(_ url: URL) -> Bool {
        #if targetEnvironment(macCatalyst)
        // Catalyst's SDK does not include the iOS Swift API-name mapping.
        QLPreviewController.canPreviewItem(url as NSURL)
        #else
        QLPreviewController.canPreview(url as NSURL)
        #endif
    }

    @objc private func openIn(_ sender: UIBarButtonItem) {
        guard !documentController.presentOpenInMenu(from: sender, animated: true) else { return }
        let alert = UIAlertController(title: "No compatible app found", message: "You can share or save a copy of this file instead.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Share", style: .default) { [weak self] _ in self?.share(sender) })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func share(_ sender: UIBarButtonItem) {
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        activity.popoverPresentationController?.barButtonItem = sender
        present(activity, animated: true)
    }
}
