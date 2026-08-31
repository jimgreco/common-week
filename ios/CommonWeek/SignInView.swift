import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @ObservedObject var auth: AuthStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                BrandMark()
                    .padding(.bottom, 64)
                Eyebrow(text: "Your week, held together")
                    .padding(.bottom, 12)
                Text("Plan the life between the calendar events.")
                    .font(CWTheme.display(52))
                    .tracking(-2.2)
                    .foregroundStyle(CWTheme.ink)
                    .lineSpacing(-4)
                Text("See where you’ll be, what the weather looks like, what’s already scheduled, and what the two of you still need to decide.")
                    .font(.system(size: 17, weight: .regular, design: .rounded))
                    .foregroundStyle(CWTheme.secondaryInk)
                    .lineSpacing(7)
                    .padding(.top, 28)

                SignInWithAppleButton(.continue, onRequest: auth.prepareAppleRequest, onCompletion: auth.completeAppleSignIn)
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .disabled(auth.state == .signingIn)
                    .padding(.top, 36)

                Button(action: auth.signIn) {
                    HStack(spacing: 12) {
                        if auth.state == .signingIn { ProgressView().tint(.white) }
                        else {
                            Text("G").font(.system(size: 16, weight: .bold)).frame(width: 24, height: 24).background(.white, in: Circle()).foregroundStyle(.blue)
                        }
                        Text(auth.state == .signingIn ? "Opening Google…" : "Continue with Google")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .frame(height: 56)
                    .background(LinearGradient(colors: [CWTheme.brand, CWTheme.brandStrong], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: CWTheme.brand.opacity(0.25), radius: 14, y: 8)
                }
                .buttonStyle(.plain)
                .disabled(auth.state == .signingIn)
                .padding(.top, 12)

                if let error = auth.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.top, 16)
                }

                Label("Private by default · Calendar access starts read-only", systemImage: "lock.shield")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 18)

                HStack(spacing: 18) {
                    Link("Privacy", destination: URL(string: "https://weekofus.com/privacy")!)
                    Link("Terms", destination: URL(string: "https://weekofus.com/terms")!)
                    Link("Support", destination: URL(string: "https://weekofus.com/support")!)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 18)
            }
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.top, 34)
            .padding(.bottom, 40)
        }
    }
}
