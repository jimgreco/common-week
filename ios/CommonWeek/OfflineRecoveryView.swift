import SwiftUI
import UniformTypeIdentifiers

private struct OfflineDraftDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json, .data] }
    var bytes: Data
    init(bytes: Data) { self.bytes = bytes }
    init(configuration: ReadConfiguration) throws { bytes = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: bytes) }
}

struct OfflineRecoveryView: View {
    @StateObject var model: OfflineRecoveryModel
    @ObservedObject var auth: AuthStore
    let householdName: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var email = ""
    @State private var householdID = ""
    @State private var originalConfirmed = false
    @State private var selectedFileID: String?
    @State private var selectedMutationID: UUID?
    @State private var draftConfirmed = false
    @State private var exportDocument: OfflineDraftDocument?
    @State private var exporting = false
    @State private var confirmRecovery = false

    private var file: OfflineRecoveryFile? { model.files.first { $0.id == selectedFileID } }
    private var mutation: OfflineMutation? { file?.mutations?.first { $0.id == selectedMutationID } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Review saved offline drafts").font(.headline)
                    Text("Original files stay on this device. Nothing is sent to a household automatically. Older files did not record their household; only you can confirm where each draft belongs.")
                }
                if !model.verified { verification }
                else {
                    Section("Verified account and household") {
                        Text(model.user.email)
                        Text(householdName)
                        Text(model.identity.householdId).font(.caption).textSelection(.enabled)
                        Button("Lock review") { lock() }
                    }
                    Section("Source files") {
                        if model.files.isEmpty { Text("No saved offline files for this account on this device.") }
                        ForEach(model.files) { source in
                            Button {
                                selectedFileID = source.id; selectedMutationID = nil; draftConfirmed = false; model.resetReview()
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(source.name).font(.caption).foregroundStyle(.primary)
                                    Text(source.mutations.map { "\($0.count) saved changes" } ?? "Unreadable file · export the original bytes").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    if let file {
                        Section("Preserve a copy") {
                            Text("Export includes this whole source file and may contain drafts from more than one household. Save it only somewhere you trust. Export does not change the file or mark anything as recovered.").font(.caption)
                            Button("Export original file") {
                                Task {
                                    if let bytes = await model.export(file), model.verified {
                                        exportDocument = OfflineDraftDocument(bytes: bytes); exporting = true
                                    }
                                }
                            }.disabled(model.busy)
                            Text("SHA-256: \(file.fingerprint)").font(.caption2).textSelection(.enabled)
                        }
                        if let mutations = file.mutations {
                            Section("Choose a change") {
                                ForEach(Array(mutations.enumerated()), id: \.offset) { _, entry in
                                    Button {
                                        selectedMutationID = entry.id; draftConfirmed = false; model.resetReview()
                                    } label: {
                                        Text("\(entry.kind.rawValue) · \(entry.createdAt.formatted(date: .abbreviated, time: .shortened))")
                                    }.disabled(!model.canReview(entry) || model.busy)
                                    if !model.canReview(entry) { Text("Recorded for another account or household. Sign in to that original identity to review.").font(.caption) }
                                }
                            }
                        } else { Text("The file could not be decoded. Export preserves all bytes for manual review; it cannot be replayed.") }
                        if let mutation, model.canReview(mutation) { draftReview(mutation, file: file) }
                    }
                }
                if model.busy { ProgressView("Checking…") }
                if let message = model.message { Section { Text(message).foregroundStyle(.orange) } }
            }
            .navigationTitle("Saved offline drafts")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { lock(); dismiss() } } }
            .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .json, defaultFilename: file?.name ?? "offline-drafts.json") { _ in exportDocument = nil }
            .confirmationDialog("Recover this draft to \(householdName)?", isPresented: $confirmRecovery, titleVisibility: .visible) {
                Button("Recover this draft") {
                    if let mutation, let file { Task { await model.recover(mutation, in: file, confirmedHousehold: draftConfirmed) } }
                }
                Button("Cancel", role: .cancel) {}
            } message: { Text("This shares its text and original date with the verified household. It stays unassigned, with no reminder. The original file is kept.") }
            .onChange(of: auth.state) { _, _ in lock() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { lock() } }
            .onDisappear { lock() }
        }
    }

    private var verification: some View {
        Section("Verify the original identity") {
            Text("Signed in: \(model.user.email)\nHousehold: \(householdName)")
            Text("Household ID: \(model.identity.householdId)").font(.caption).textSelection(.enabled)
            Text("If this is not the original account and household, close this screen and switch first. If you cannot identify the original household, leave the drafts preserved.").font(.caption)
            TextField("Original account email", text: $email).textInputAutocapitalization(.never).autocorrectionDisabled()
            TextField("Original household ID", text: $householdID).textInputAutocapitalization(.never).autocorrectionDisabled()
            Toggle("I have verified the original account and household", isOn: $originalConfirmed)
            Button("Verify and review on this device") { Task { await model.verify(email: email, householdId: householdID, confirmedOriginal: originalConfirmed) } }.disabled(model.busy)
        }
    }

    @ViewBuilder private func draftReview(_ mutation: OfflineMutation, file: OfflineRecoveryFile) -> some View {
        Section("Original change") {
            if let draft = mutation.draft {
                Text(draft.text).textSelection(.enabled)
                Text("\(draft.type.rawValue.capitalized) · \(draft.planningDate ?? "Week of " + draft.weekStartDate)").font(.caption)
                if draft.remindAt != nil || draft.childId != nil || !(draft.assignedMemberIds ?? []).isEmpty {
                    Text("Original assignments and reminder remain in the export. Recovery will not apply them.").font(.caption)
                }
            }
            if let id = mutation.draft?.id ?? mutation.itemId { Text("Item: \(id)").font(.caption).textSelection(.enabled) }
            if let completed = mutation.completed { Text(completed ? "Mark completed" : "Mark incomplete") }
            if let date = mutation.startDate { Text("Location date: \(date) · \(mutation.scope ?? "unknown scope")") }
            if let id = mutation.locationId { Text("Saved location: \(id)").font(.caption) }
            if let location = mutation.location { Text("Location: \(location.name)") }
            if model.canCheckCurrent(mutation) {
                Toggle("This specific draft belongs to the verified original household", isOn: $draftConfirmed)
                    .onChange(of: draftConfirmed) { _, _ in model.resetReview() }
                Button("Check current household for conflicts") { Task { await model.review(mutation, in: file, confirmedHousehold: draftConfirmed) } }.disabled(!draftConfirmed || model.busy)
                if let result = model.result {
                    Text("An item ID match is only a conflict check. It does not prove which household a legacy draft belongs to.").font(.caption)
                    switch result.status {
                    case "ready":
                        if model.canRecover(mutation) {
                            Text("No item with the original ID exists in this household. Recovery creates the original text and date as an unassigned item. It sends no reminder or notification.")
                            Button("Recover draft…") { confirmRecovery = true }.disabled(model.busy || !draftConfirmed || model.user.role == "viewer")
                        } else {
                            Text("No current item was found. This old edit cannot be replayed safely. Export the source for manual review.")
                        }
                    case "existing":
                        Text("An item with this ID already exists. It will not be overwritten or duplicated. Compare it below and use the regular planner editor if you want to make a change.")
                        if let item = result.item {
                            Text("Current household item").font(.headline)
                            Text(item.text).textSelection(.enabled)
                            Text("Current: \(item.type) · \(item.planningDate ?? "Week of " + item.weekStartDate)\(item.isCompleted ? " · Completed" : "")").font(.caption)
                        }
                    case "recovered": Text("This draft was recovered. Its receipt prevents another copy, even if the item was later edited or deleted. The source file is still preserved.")
                    default: Text("The draft conflicts with an existing item or recovery receipt. Nothing was changed. Export it for manual review.")
                    }
                }
            } else {
                Text("This saved change cannot be safely replayed. Old edits, completion, deletion and location changes have no reliable base revision. Review or export it, then use the current planner to make an explicit change.")
            }
        }
    }

    private func lock() {
        model.cancel(); exportDocument = nil; exporting = false; confirmRecovery = false
        selectedFileID = nil; selectedMutationID = nil; draftConfirmed = false; originalConfirmed = false
        email = ""; householdID = ""
    }
}
