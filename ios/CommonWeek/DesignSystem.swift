import SwiftUI

enum CWTheme {
    static let brand = Color(red: 0.09, green: 0.42, blue: 0.33)
    static let brandStrong = Color(red: 0.05, green: 0.32, blue: 0.25)
    static let accent = adaptive(
        light: UIColor(red: 0.09, green: 0.42, blue: 0.33, alpha: 1),
        dark: UIColor(red: 0.38, green: 0.83, blue: 0.69, alpha: 1)
    )
    static let accentStrong = adaptive(
        light: UIColor(red: 0.05, green: 0.32, blue: 0.25, alpha: 1),
        dark: UIColor(red: 0.56, green: 0.90, blue: 0.78, alpha: 1)
    )
    static let mint = adaptive(
        light: UIColor(red: 0.89, green: 0.95, blue: 0.92, alpha: 1),
        dark: UIColor(red: 0.08, green: 0.18, blue: 0.15, alpha: 1)
    )
    static let cream = adaptive(
        light: UIColor(red: 0.98, green: 0.97, blue: 0.93, alpha: 1),
        dark: UIColor(red: 0.17, green: 0.15, blue: 0.12, alpha: 1)
    )
    static let ink = Color(uiColor: .label)
    static let secondaryInk = Color(uiColor: .secondaryLabel)
    static let rule = Color(uiColor: .separator)

    static func display(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}

struct AppBackground: View {
    var body: some View {
        ZStack {
            Color(.systemGroupedBackground)
            LinearGradient(
                colors: [CWTheme.mint.opacity(0.75), Color(.systemGroupedBackground), CWTheme.cream.opacity(0.75)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
    }
}

struct BrandMark: View {
    var compact = false

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: compact ? 8 : 11, style: .continuous)
                    .fill(LinearGradient(colors: [CWTheme.brand, CWTheme.brandStrong], startPoint: .topLeading, endPoint: .bottomTrailing))
                HStack(alignment: .bottom, spacing: 3) {
                    Capsule().frame(width: 3, height: 8)
                    Capsule().frame(width: 3, height: 15)
                    Capsule().frame(width: 3, height: 11)
                }
                .foregroundStyle(.white)
            }
            .frame(width: compact ? 30 : 42, height: compact ? 30 : 42)
            .shadow(color: CWTheme.accent.opacity(0.22), radius: 8, y: 4)

            Text("Common Week")
                .font(.system(size: compact ? 16 : 20, weight: .bold, design: .rounded))
                .tracking(-0.4)
        }
        .foregroundStyle(CWTheme.ink)
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(1.7)
            .foregroundStyle(CWTheme.accent)
    }
}

struct CardSurface<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(CWTheme.rule.opacity(0.9), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.055), radius: 15, y: 8)
    }
}

extension Color {
    init(hex: String) {
        let value = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(
            red: Double((value >> 16) & 0xff) / 255,
            green: Double((value >> 8) & 0xff) / 255,
            blue: Double(value & 0xff) / 255
        )
    }
}
