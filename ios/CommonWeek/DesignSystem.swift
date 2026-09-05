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
    var iconSize: CGFloat? = nil
    var titleSize: CGFloat = 20

    private var resolvedIconSize: CGFloat {
        iconSize ?? (compact ? 30 : 42)
    }

    var body: some View {
        HStack(spacing: 10) {
            BrandGlyph(compact: compact)
                .frame(width: resolvedIconSize, height: resolvedIconSize)

            if !compact {
                Text("Week of Us")
                    .font(.system(size: titleSize, weight: .bold, design: .rounded))
                    .tracking(-0.4)
            }
        }
        .foregroundStyle(CWTheme.ink)
    }
}

private struct BrandGlyph: View {
    let compact: Bool

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let rowHeight = side * (compact ? 0.20 : 1 / 6)
            let spacing = side * (compact ? 0.10 : 1 / 12)
            let inset = side * (compact ? 0.10 : 1 / 6)

            VStack(spacing: spacing) {
                slider(dotColor: Color(red: 0.89, green: 0.67, blue: 0.25), position: 0.22, rowHeight: rowHeight)
                slider(dotColor: Color(red: 0.63, green: 0.72, blue: 0.67), position: 0.68, rowHeight: rowHeight)
                slider(dotColor: Color(red: 0.80, green: 0.47, blue: 0.40), position: 0.42, rowHeight: rowHeight)
            }
            .padding(inset)
            .frame(width: side, height: side)
            .background {
                if !compact {
                    RoundedRectangle(cornerRadius: side * 0.26, style: .continuous)
                        .fill(Color(red: 0.09, green: 0.16, blue: 0.14))
                        .shadow(
                            color: CWTheme.accent.opacity(0.22),
                            radius: side * 0.19,
                            y: side * 0.10
                        )
                }
            }
        }
    }

    private func slider(dotColor: Color, position: CGFloat, rowHeight: CGFloat) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(compact ? CWTheme.accentStrong.opacity(0.52) : CWTheme.cream)
                    .frame(height: rowHeight * 0.36)
                Circle()
                    .fill(dotColor)
                    .frame(width: rowHeight, height: rowHeight)
                    .offset(x: max(0, (proxy.size.width - rowHeight) * position))
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: rowHeight)
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

#if targetEnvironment(macCatalyst)
struct MacModalLayout<Content: View>: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let cancelTitle: String
    let primaryTitle: String
    let primaryDisabled: Bool
    let cancel: () -> Void
    let primaryAction: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            MacModalHeading(
                eyebrow: eyebrow,
                title: title,
                subtitle: subtitle,
                systemImage: systemImage,
                tint: tint
            )

            Divider()

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            MacModalActions(
                cancelTitle: cancelTitle,
                primaryTitle: primaryTitle,
                primaryDisabled: primaryDisabled,
                showsCancel: true,
                cancel: cancel,
                primaryAction: primaryAction
            )
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct MacModalHeading: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 42, height: 42)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(eyebrow.uppercased())
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .tracking(1.45)
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(CWTheme.ink)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 20)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.vertical, 20)
        .background(Color(uiColor: .systemGroupedBackground))
    }
}

private struct MacModalActions: View {
    let cancelTitle: String
    let primaryTitle: String
    let primaryDisabled: Bool
    let showsCancel: Bool
    let cancel: () -> Void
    let primaryAction: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if showsCancel {
                Button(cancelTitle, action: cancel)
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.cancelAction)
            }
            Spacer()
            Button(primaryTitle, action: primaryAction)
                .buttonStyle(.borderedProminent)
                .disabled(primaryDisabled)
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(.regularMaterial)
    }
}

private struct MacModalChromeModifier: ViewModifier {
    let eyebrow: String
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    let cancelTitle: String
    let primaryTitle: String
    let primaryDisabled: Bool
    let showsCancel: Bool
    let cancel: () -> Void
    let primaryAction: () -> Void

    func body(content: Content) -> some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    MacModalHeading(
                        eyebrow: eyebrow,
                        title: title,
                        subtitle: subtitle,
                        systemImage: systemImage,
                        tint: tint
                    )
                    Divider()
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    Divider()
                    MacModalActions(
                        cancelTitle: cancelTitle,
                        primaryTitle: primaryTitle,
                        primaryDisabled: primaryDisabled,
                        showsCancel: showsCancel,
                        cancel: cancel,
                        primaryAction: primaryAction
                    )
                }
            }
            .background(Color(uiColor: .systemGroupedBackground))
    }
}

extension View {
    func macModalFormStyle() -> some View {
        formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
    }

    func macModalChrome(
        eyebrow: String,
        title: String,
        subtitle: String,
        systemImage: String,
        tint: Color = CWTheme.accentStrong,
        cancelTitle: String = "Cancel",
        primaryTitle: String,
        primaryDisabled: Bool = false,
        showsCancel: Bool = true,
        cancel: @escaping () -> Void,
        primaryAction: @escaping () -> Void
    ) -> some View {
        modifier(MacModalChromeModifier(
            eyebrow: eyebrow,
            title: title,
            subtitle: subtitle,
            systemImage: systemImage,
            tint: tint,
            cancelTitle: cancelTitle,
            primaryTitle: primaryTitle,
            primaryDisabled: primaryDisabled,
            showsCancel: showsCancel,
            cancel: cancel,
            primaryAction: primaryAction
        ))
    }
}
#endif

extension View {
    @ViewBuilder
    func cwModalFormStyle() -> some View {
        #if targetEnvironment(macCatalyst)
        macModalFormStyle()
        #else
        self
        #endif
    }

    @ViewBuilder
    func cwModalChrome(
        eyebrow: String,
        title: String,
        subtitle: String,
        systemImage: String,
        tint: Color = CWTheme.accentStrong,
        cancelTitle: String = "Cancel",
        primaryTitle: String,
        primaryDisabled: Bool = false,
        showsCancel: Bool = true,
        cancel: @escaping () -> Void,
        primaryAction: @escaping () -> Void
    ) -> some View {
        #if targetEnvironment(macCatalyst)
        macModalChrome(
            eyebrow: eyebrow,
            title: title,
            subtitle: subtitle,
            systemImage: systemImage,
            tint: tint,
            cancelTitle: cancelTitle,
            primaryTitle: primaryTitle,
            primaryDisabled: primaryDisabled,
            showsCancel: showsCancel,
            cancel: cancel,
            primaryAction: primaryAction
        )
        #else
        self
        #endif
    }

    @ViewBuilder
    func cwModalNavigationTitle(_ title: String) -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    func cwModalNavigationActions(
        cancelTitle: String? = "Cancel",
        primaryTitle: String,
        primaryDisabled: Bool = false,
        cancel: @escaping () -> Void,
        primaryAction: @escaping () -> Void
    ) -> some View {
        #if targetEnvironment(macCatalyst)
        self
        #else
        toolbar {
            if let cancelTitle {
                ToolbarItem(placement: .cancellationAction) {
                    Button(cancelTitle, action: cancel)
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(primaryTitle, action: primaryAction)
                    .disabled(primaryDisabled)
            }
        }
        #endif
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
