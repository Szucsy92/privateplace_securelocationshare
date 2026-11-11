import SwiftUI

/// Minden harmónika/fülváltás/ablak ugyanazzal az ütemmel mozog (240 ms), mint a webes useSmoothHeight.
let animMs = 0.24
let harmonika = Animation.easeInOut(duration: animMs)

/// Dinamikusan illeszkedő harmónika: a fejléc koppintásra a tartalom a saját magasságához igazodva nyílik/záródik, az ablak vele együtt nő/zsugorodik.
struct Accordion<Leading: View, Content: View>: View {
    var title: String
    var subtitle: String? = nil
    var open: Bool
    var onToggle: () -> Void
    @ViewBuilder var leading: () -> Leading
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            Button { withAnimation(harmonika) { onToggle() } } label: {
                HStack(spacing: 10) {
                    leading()
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.subheadline.weight(.semibold)).foregroundColor(.white)
                        if let s = subtitle { Text(s).font(.caption2).foregroundColor(.muted).lineLimit(1) }
                    }
                    Spacer()
                    Image(systemName: "chevron.down").font(.footnote).foregroundColor(.muted).rotationEffect(.degrees(open ? 180 : 0))
                }.padding(.horizontal, 12).padding(.vertical, 10).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 8) { content() }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.bottom, 12)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }.glass(20).clipped()
    }
}
extension Accordion where Leading == EmptyView {
    init(title: String, subtitle: String? = nil, open: Bool, onToggle: @escaping () -> Void, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, open: open, onToggle: onToggle, leading: { EmptyView() }, content: content)
    }
}

private struct HeightKey: PreferenceKey { static var defaultValue: CGFloat = 0; static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() } }

/// Ablak (lap) keret: a lap magassága a tartalomhoz igazodik, és a méretváltozást (harmónika, fülváltás) lágyan követi.
struct SheetScaffold<Content: View>: View {
    var title: String? = nil
    @ViewBuilder var content: () -> Content
    @State private var h: CGFloat = 300
    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let t = title { Text(t).font(.title3.bold()).foregroundColor(.white).frame(maxWidth: .infinity, alignment: .leading) }
                content()
            }
            .padding(16).padding(.top, 6)
            .background(GeometryReader { Color.clear.preference(key: HeightKey.self, value: $0.size.height) })
        }
        .onPreferenceChange(HeightKey.self) { v in withAnimation(harmonika) { h = v } }
        .presentationDetents([.height(min(max(h, 180), UIScreen.main.bounds.height * 0.92))])
        .presentationDragIndicator(.visible)
        .background(Color(hex: "#0F1A2E").ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

/// Fülváltás: az új fül tartalma átúszik, a magasság lágyan igazodik.
struct TabContent<Tab: Hashable, Content: View>: View {
    var tab: Tab
    @ViewBuilder var content: (Tab) -> Content
    var body: some View {
        content(tab).id(tab).transition(.opacity).animation(harmonika, value: tab)
    }
}

/// Kompakt profilsor: kis kerek kép (kamera-jelvénnyel) + egysoros név; a mentés ikon csak módosításkor jelenik meg.
struct ProfileRow<Trailing: View>: View {
    @Binding var name: String
    var avatar: String?
    var onAvatar: (String) -> Void
    var color = SELF_COLOR
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(spacing: 10) {
            AvatarPicker(onPick: onAvatar) {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(name: name.isEmpty ? "?" : name, color: color, avatar: avatar, size: 40)
                    Image(systemName: "camera.fill").font(.system(size: 7)).foregroundColor(.white).padding(4).background(Color.mint, in: Circle())
                }
            }
            TextField("A neved", text: $name).foregroundColor(.white).padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color.white.opacity(0.08), in: Capsule()).onChange(of: name) { v in if v.count > 40 { name = String(v.prefix(40)) } }
            trailing()
        }
    }
}
extension ProfileRow where Trailing == EmptyView {
    init(name: Binding<String>, avatar: String?, onAvatar: @escaping (String) -> Void, color: String = SELF_COLOR) {
        self.init(name: name, avatar: avatar, onAvatar: onAvatar, color: color, trailing: { EmptyView() })
    }
}

struct PillField: View {
    var hint: String
    @Binding var text: String
    var body: some View {
        TextField(hint, text: $text).foregroundColor(.white).padding(.horizontal, 14).padding(.vertical, 10).background(Color.white.opacity(0.08), in: Capsule())
    }
}
