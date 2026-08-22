import AuthenticationServices
import Security
import SwiftUI
import UIKit

enum AuthStoreError: LocalizedError {
    case cancelled
    case invalidCallback
    case wrongGoogleAccount
    case unavailable

    var errorDescription: String? {
        switch self {
        case .cancelled: "Google authorization was cancelled."
        case .invalidCallback: "Google authorization could not be completed."
        case .wrongGoogleAccount: "Choose the same Google account that is signed in to Week of Us."
        case .unavailable: "Google authorization could not be opened."
        }
    }
}

@MainActor
final class AuthStore: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    enum State: Equatable {
        case restoring
        case signedOut
        case signingIn
        case signedIn(SessionIdentity)
    }

    @Published private(set) var state: State = .restoring
    @Published var errorMessage: String?
    private let api: APIClient
    private var authenticationSession: ASWebAuthenticationSession?

    init(api: APIClient = .shared) {
        self.api = api
        super.init()
        if ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] == "1" {
            state = .signedIn(PreviewData.user)
        }
        NotificationCenter.default.addObserver(forName: APIClient.authorizationExpired, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.state = .signedOut }
        }
    }

    func restore() async {
        guard ProcessInfo.processInfo.environment["COMMON_WEEK_DEMO"] != "1" else { return }
        guard api.token != nil else { state = .signedOut; return }
        do { state = .signedIn(try await api.restoreSession()) }
        catch { api.token = nil; state = .signedOut }
    }

    func signIn() {
        guard case .signedOut = state else { return }
        state = .signingIn
        errorMessage = nil
        let clientState = Self.secureState()
        var components = URLComponents(url: api.baseURL.appending(path: "/auth/google"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "client_state", value: clientState),
        ]
        let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "commonweek") { [weak self] callback, error in
            Task { @MainActor in
                guard let self else { return }
                self.authenticationSession = nil
                if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                    self.state = .signedOut
                    return
                }
                guard let callback,
                      let callbackComponents = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                      callbackComponents.queryItems?.first(where: { $0.name == "state" })?.value == clientState,
                      let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value else {
                    self.state = .signedOut
                    self.errorMessage = callback.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "error" })?.value }
                        ?? "Google sign-in could not be completed."
                    return
                }
                do {
                    let session = try await self.api.exchange(code: code, state: clientState)
                    self.api.token = session.token
                    self.state = .signedIn(try await self.api.restoreSession())
                } catch {
                    self.api.token = nil
                    self.state = .signedOut
                    self.errorMessage = error.localizedDescription
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        if !session.start() {
            state = .signedOut
            errorMessage = "Google sign-in could not be opened."
        }
    }

    func signOut() async {
        await api.signOut()
        state = .signedOut
    }

    func connectGoogleCalendar(writeAccess: Bool) async throws {
        guard case .signedIn(let currentIdentity) = state else { throw AuthStoreError.unavailable }
        let previousToken = api.token
        let authorization = try await beginGoogleAuthorization(calendarWrite: writeAccess)
        let nativeSession = try await api.exchange(code: authorization.code, state: authorization.state)
        api.token = nativeSession.token
        do {
            let refreshedIdentity = try await api.restoreSession()
            guard refreshedIdentity.userId == currentIdentity.userId else {
                await api.signOut()
                api.token = previousToken
                throw AuthStoreError.wrongGoogleAccount
            }
            state = .signedIn(refreshedIdentity)
        } catch {
            api.token = previousToken
            throw error
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
        if let keyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return keyWindow
        }
        guard let scene = scenes.first else {
            preconditionFailure("Google sign-in requires an active window scene.")
        }
        return ASPresentationAnchor(windowScene: scene)
    }

    private static func secureState() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private func beginGoogleAuthorization(calendarWrite: Bool) async throws -> (code: String, state: String) {
        let clientState = Self.secureState()
        var components = URLComponents(url: api.baseURL.appending(path: "/auth/google"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "client_state", value: clientState),
        ]
        if calendarWrite { components.queryItems?.append(URLQueryItem(name: "calendar_write", value: "1")) }

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "commonweek") { [weak self] callback, error in
                Task { @MainActor in
                    self?.authenticationSession = nil
                    if let authError = error as? ASWebAuthenticationSessionError, authError.code == .canceledLogin {
                        continuation.resume(throwing: AuthStoreError.cancelled)
                        return
                    }
                    guard let callback,
                          let callbackComponents = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                          callbackComponents.queryItems?.first(where: { $0.name == "state" })?.value == clientState,
                          let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value else {
                        continuation.resume(throwing: AuthStoreError.invalidCallback)
                        return
                    }
                    continuation.resume(returning: (code, clientState))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            authenticationSession = session
            guard session.start() else {
                authenticationSession = nil
                continuation.resume(throwing: AuthStoreError.unavailable)
                return
            }
        }
    }
}
