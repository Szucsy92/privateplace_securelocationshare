import SwiftUI
import UIKit
import CoreText

// ───────── Téma ─────────
private struct PalKey: EnvironmentKey { static let defaultValue = darkPalette }
extension EnvironmentValues { var pal: Palette { get { self[PalKey.self] } set { self[PalKey.self] = newValue } } }

let animMs = 0.24     // minden harmónika/ablak/fül ugyanazzal az ütemmel mozog (a webes useSmoothHeight: 240 ms)
let harmonika = Animation.easeInOut(duration: animMs)

extension Color {
    init(hex: String) {
        var h = hex; if h.hasPrefix("#") { h.removeFirst() }
        var v: UInt64 = 0; Scanner(string: h).scanHexInt64(&v)
        self.init(.sRGB, red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255, opacity: 1)
    }
    func mix(_ other: Color, _ t: Double) -> Color {
        let a = UIColor(self), b = UIColor(other)
        var (r1, g1, b1, a1) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0)), (r2, g2, b2, a2) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1); b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return Color(.sRGB, red: Double(r1 + (r2 - r1) * t), green: Double(g1 + (g2 - g1) * t), blue: Double(b1 + (b2 - b1) * t), opacity: Double(a1 + (a2 - a1) * t))
    }
}

// ───────── Betűk: DM Sans (törzs), Space Grotesk (cím) – a CI tölti le; hiányuk esetén rendszerbetű ─────────
private func variableFont(_ names: [String], size: CGFloat, weight: CGFloat, fallback: UIFont.Weight) -> UIFont {
    for n in names { if let base = UIFont(name: n, size: size) {
        let axis = 0x77676874   // 'wght'
        let desc = base.fontDescriptor.addingAttributes([UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [axis: weight]])
        return UIFont(descriptor: desc, size: size) } }
    return UIFont.systemFont(ofSize: size, weight: fallback)
}
func appFont(_ size: CGFloat, _ weight: Int = 400, display: Bool = false) -> Font {
    let fb: UIFont.Weight = weight >= 700 ? .bold : weight >= 600 ? .semibold : weight >= 500 ? .medium : .regular
    let f = display ? variableFont(["SpaceGrotesk-Regular", "Space Grotesk", "SpaceGrotesk-Light"], size: size, weight: CGFloat(weight), fallback: fb)
                    : variableFont(["DMSans-Regular", "DM Sans", "DMSans-9ptRegular", "DMSans-Light"], size: size, weight: CGFloat(weight), fallback: fb)
    return Font(f as CTFont)
}

struct Txt: View {
    @Environment(\.pal) private var pal
    var text: String; var size: CGFloat = 14; var weight: Int = 400; var color: Color? = nil; var display = false
    var lines: Int? = nil; var align: TextAlignment = .leading; var lineHeight: CGFloat? = nil; var tracking: CGFloat = 0; var underline = false
    init(_ t: String, size: CGFloat = 14, weight: Int = 400, color: Color? = nil, display: Bool = false, lines: Int? = nil, align: TextAlignment = .leading, lineHeight: CGFloat? = nil, tracking: CGFloat = 0, underline: Bool = false) {
        text = t; self.size = size; self.weight = weight; self.color = color; self.display = display; self.lines = lines; self.align = align; self.lineHeight = lineHeight; self.tracking = tracking; self.underline = underline
    }
    var body: some View {
        Text(text).font(appFont(size, weight, display: display)).foregroundColor(color ?? pal.foreground).tracking(tracking).underline(underline)
            .lineLimit(lines).multilineTextAlignment(align).lineSpacing(max(0, (lineHeight ?? size * 1.43) - size * 1.2)).fixedSize(horizontal: false, vertical: true)
    }
}

/// Lucide ikon (a CI generálja az eredeti lucide-react készletből).
struct LIcon: View {
    @Environment(\.pal) private var pal
    var name: String; var size: CGFloat = 16; var tint: Color? = nil
    init(_ n: String, size: CGFloat = 16, tint: Color? = nil) { name = n; self.size = size; self.tint = tint }
    var body: some View { Image("lucide-\(name)").renderingMode(.template).resizable().scaledToFit().frame(width: size, height: size).foregroundColor(tint ?? pal.foreground) }
}

// ───────── Üveg-felületek ─────────
let Radius: CGFloat = 14.4, Radius2xl: CGFloat = 22.4

struct Glass: ViewModifier {
    @Environment(\.pal) private var pal
    var radius: CGFloat; var strong = false; var circle = false
    func body(content: Content) -> some View {
        let shape = AnyShape(circle ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: radius)))
        content.background(shape.fill(.ultraThinMaterial)).background(shape.fill(strong ? pal.glassStrong : pal.glassBg))
            .clipShape(shape).overlay(shape.stroke(pal.glassEdge, lineWidth: 1)).shadow(color: pal.shade.opacity(0.45), radius: 14, x: 0, y: 8)
    }
}
extension View {
    func glass(_ r: CGFloat = 20, strong: Bool = false) -> some View { modifier(Glass(radius: r, strong: strong)) }
    func glassCapsule() -> some View { modifier(Glass(radius: 0, circle: true)) }
    func glassInset(_ r: CGFloat = Radius2xl) -> some View { modifier(GlassInset(radius: r)) }
    func indicator(_ on: Bool) -> some View { modifier(Indicator(on: on)) }
}
struct GlassInset: ViewModifier {
    @Environment(\.pal) private var pal; var radius: CGFloat
    func body(content: Content) -> some View {
        content.background(pal.glassInset, in: RoundedRectangle(cornerRadius: radius)).overlay(RoundedRectangle(cornerRadius: radius).stroke(pal.tint.opacity(0.07), lineWidth: 1))
    }
}
struct Indicator: ViewModifier {
    @Environment(\.pal) private var pal; var on: Bool
    func body(content: Content) -> some View {
        content.background(on ? pal.signal.opacity(0.16) : .clear, in: Circle()).overlay(Circle().stroke(on ? pal.signal.opacity(0.55) : .clear, lineWidth: 1))
            .shadow(color: on ? pal.signal.opacity(0.5) : .clear, radius: 8).opacity(on ? 1 : 0.72).animation(harmonika, value: on)
    }
}

struct StatusDot: View {
    @Environment(\.pal) private var pal
    var state: String
    @State private var k: CGFloat = 0
    var body: some View {
        let c = state == "on" ? pal.live : state == "wait" ? pal.warn : state == "warn" ? pal.destructive : pal.mutedForeground.opacity(0.6)
        ZStack {
            if ["on", "wait", "warn"].contains(state) { Circle().fill(c).opacity(0.7 * (1 - Double(k))).scaleEffect(1 + 1.2 * k) }
            Circle().fill(c)
        }.frame(width: 8, height: 8).padding(.horizontal, 2)
        .onAppear { withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { k = 1 } }
    }
}

// ───────── Gombok (shadcn) ─────────
enum Variant { case primary, outline, ghost, destructive }

struct PPButton<Label: View>: View {
    @Environment(\.pal) private var pal
    var variant: Variant = .primary; var small = false; var height: CGFloat? = nil; var enabled = true
    var action: () -> Void
    @ViewBuilder var label: (Color) -> Label
    var body: some View {
        let fg: Color = variant == .primary ? pal.primaryForeground : variant == .destructive ? Color(hex: "#FCFCFE") : pal.foreground
        let bg: Color = variant == .primary ? pal.primary : variant == .destructive ? pal.destructive : variant == .outline ? pal.tint.opacity(0.05) : .clear
        Button(action: action) {
            HStack(spacing: 0) { label(fg) }.padding(.horizontal, small ? 12 : 16).frame(minHeight: height ?? (small ? 32 : 36)).frame(maxWidth: .infinity)
        }.buttonStyle(PressStyle()).background(bg, in: Capsule())
            .overlay(Capsule().stroke(variant == .outline ? pal.tint.opacity(0.12) : .clear, lineWidth: 1)).opacity(enabled ? 1 : 0.5).disabled(!enabled)
    }
}
struct PressStyle: ButtonStyle { func makeBody(configuration: Configuration) -> some View { configuration.label.opacity(configuration.isPressed ? 0.85 : 1) } }

struct BtnText: View { var text: String; var color: Color; var small = false
    var body: some View { Txt(text, size: small ? 12 : 14, weight: 500, color: color, lines: 1) } }

struct TextBtn: View {
    var text: String; var variant: Variant = .primary; var small = false; var icon: String? = nil; var enabled = true; var fill = true; var action: () -> Void
    var body: some View {
        PPButton(variant: variant, small: small, enabled: enabled, action: action) { c in
            if let i = icon { LIcon(i, size: small ? 14 : 16, tint: c); Spacer().frame(width: 6) }
            BtnText(text: text, color: c, small: small)
        }.fixedSize(horizontal: !fill, vertical: false)
    }
}

struct IconBtn: View {
    var icon: String; var label: String; var size: CGFloat = 36; var iconSize: CGFloat = 16; var tint: Color? = nil; var action: () -> Void
    var body: some View { Button(action: action) { LIcon(icon, size: iconSize, tint: tint).frame(width: size, height: size).contentShape(Circle()) }.accessibilityLabel(label) }
}

// ───────── Beviteli elemek ─────────
struct PillInput: View {
    @Environment(\.pal) private var pal
    var placeholder: String; @Binding var text: String; var max = 80; var height: CGFloat = 44
    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundColor(pal.mutedForeground)).font(appFont(16)).foregroundColor(pal.foreground).tint(pal.primary)
            .padding(.horizontal, 16).frame(height: height).background(pal.fieldBg, in: Capsule()).overlay(Capsule().stroke(pal.tint.opacity(0.12), lineWidth: 1))
            .onChange(of: text) { v in if v.count > max { text = String(v.prefix(max)) } }
    }
}
struct CheckRow: View {
    @Environment(\.pal) private var pal
    var label: String; var checked: Bool; var size: CGFloat = 14; var weight: Int = 400; var onChange: (Bool) -> Void
    var body: some View {
        Button { onChange(!checked) } label: {
            HStack(spacing: 12) {
                ZStack { RoundedRectangle(cornerRadius: 4).fill(checked ? pal.primary : .clear); RoundedRectangle(cornerRadius: 4).stroke(pal.primary, lineWidth: 1)
                    if checked { LIcon("check", size: 12, tint: pal.primaryForeground) } }.frame(width: 16, height: 16)
                Txt(label, size: size, weight: weight)
                Spacer(minLength: 0)
            }.contentShape(Rectangle())
        }.buttonStyle(.plain)
    }
}

// ───────── Rugalmas görgetés (puha szélekkel) ─────────
private struct HKey: PreferenceKey { static var defaultValue: CGFloat = 0; static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() } }
struct ElasticScroll<Content: View>: View {
    var maxHeight: CGFloat; @ViewBuilder var content: () -> Content
    @State private var h: CGFloat = 40
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) { content() }.background(GeometryReader { Color.clear.preference(key: HKey.self, value: $0.size.height) })
        }.frame(height: min(h, maxHeight)).onPreferenceChange(HKey.self) { v in withAnimation(harmonika) { h = v } }
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 12 / max(1, min(h, maxHeight))), .init(color: .black, location: 1 - 12 / max(1, min(h, maxHeight))), .init(color: .clear, location: 1)], startPoint: .top, endPoint: .bottom))
    }
}

// ───────── Ablak: matt üveg, középen, a tartalom magasságához lágyan igazodik ─────────
struct GlassDialog<Content: View>: View {
    @Environment(\.pal) private var pal
    var dismissable = true; var maxWidth: CGFloat = 390; var onDismiss: () -> Void
    @ViewBuilder var content: () -> Content
    var body: some View {
        ZStack {
            pal.dialogBackdrop.ignoresSafeArea().onTapGesture { if dismissable { onDismiss() } }
            ZStack(alignment: .topTrailing) {
                VStack(spacing: 0) { content() }.frame(maxWidth: .infinity).background(pal.glassStrong, in: RoundedRectangle(cornerRadius: 28))
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28)).overlay(RoundedRectangle(cornerRadius: 28).stroke(pal.glassEdge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                if dismissable { Button(action: onDismiss) { LIcon("x", size: 16, tint: pal.foreground.opacity(0.7)).frame(width: 28, height: 28) }.padding(14) }
            }.padding(.horizontal, 12).frame(maxWidth: maxWidth + 24)
        }.transition(.opacity.combined(with: .scale(scale: 0.95)))
    }
}

struct PanelHeader: View {
    @Environment(\.pal) private var pal
    var title: String; var description: String? = nil; var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 2 : 6) {
            Txt(title, size: compact ? 16 : 18, weight: 700, display: true, lineHeight: compact ? 24 : 20)
            if let d = description { Txt(d, size: compact ? 12 : 14, color: pal.mutedForeground) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(EdgeInsets(top: compact ? 16 : 20, leading: compact ? 16 : 20, bottom: compact ? 8 : 16, trailing: 48))
    }
}
struct MutedText: ViewModifier { @Environment(\.pal) private var pal; func body(content: Content) -> some View { content.foregroundColor(pal.mutedForeground) } }

struct BackHeader: View {
    var title: String; var onBack: () -> Void
    var body: some View {
        HStack(spacing: 4) { IconBtn(icon: "chevron-left", label: "Vissza", size: 32, iconSize: 20, action: onBack); Txt(title, size: 16, weight: 700, display: true, lines: 1); Spacer(minLength: 0) }
            .padding(EdgeInsets(top: 12, leading: 12, bottom: 8, trailing: 48))
    }
}

/// A harmónika: gördülő szakasz (grid-rows 0fr → 1fr, 240 ms).
struct Expansion<Content: View>: View {
    var open: Bool; @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(spacing: 0) { if open { content().transition(.opacity.combined(with: .move(edge: .top))) } }.clipped().animation(harmonika, value: open)
    }
}
struct DividerLine: View { @Environment(\.pal) private var pal; var body: some View { Rectangle().fill(pal.border).frame(height: 1) } }
