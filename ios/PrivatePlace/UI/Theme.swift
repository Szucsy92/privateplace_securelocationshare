import SwiftUI
import UIKit
import PhotosUI

extension Color {
    init(hex: String) {
        var h = hex; if h.hasPrefix("#") { h.removeFirst() }
        var v: UInt64 = 0; Scanner(string: h).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
    static let navy = Color(hex: "#0B1425"), mint = Color(hex: "#14B8A6"), muted = Color(hex: "#94A3B8")
}

/// Matt üveg: iOS-en valódi háttérelmosás (Material).
struct Glass: ViewModifier {
    var radius: CGFloat = 24
    func body(content: Content) -> some View {
        content.background(.ultraThinMaterial.opacity(0.9), in: RoundedRectangle(cornerRadius: radius))
            .background(Color(hex: "#111B30").opacity(0.55), in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(Color.white.opacity(0.13), lineWidth: 1))
    }
}
extension View { func glass(_ r: CGFloat = 24) -> some View { modifier(Glass(radius: r)) } }

func decodeDataURL(_ url: String?) -> UIImage? {
    guard let u = url, let r = u.range(of: "base64,"), let d = Data(base64Encoded: String(u[r.upperBound...])) else { return nil }
    return UIImage(data: d)
}
/// Kép → 128×128 középre vágott JPEG data URL (≤ 80 000 jel).
func avatarDataURL(from data: Data) -> String? {
    guard let img = UIImage(data: data) else { return nil }
    let side = min(img.size.width, img.size.height)
    let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
    let out = UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128), format: fmt).image { _ in
        img.draw(in: CGRect(x: -(img.size.width - side) / 2 * 128 / side, y: -(img.size.height - side) / 2 * 128 / side, width: img.size.width * 128 / side, height: img.size.height * 128 / side))
    }
    guard let jpg = out.jpegData(compressionQuality: 0.82) else { return nil }
    let s = "data:image/jpeg;base64," + jpg.base64EncodedString()
    return s.count <= 80_000 ? s : nil
}

struct AvatarView: View {
    var name: String, color: String, avatar: String?, size: CGFloat = 40
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: color))
            if let img = decodeDataURL(avatar) { Image(uiImage: img).resizable().scaledToFill().clipShape(Circle()) }
            else { Text(String(name.prefix(1)).uppercased()).font(.system(size: size / 2.3, weight: .bold)).foregroundColor(.navy) }
        }.frame(width: size, height: size).overlay(Circle().stroke(Color.white.opacity(0.8), lineWidth: 2))
    }
}

struct AvatarPicker<Label: View>: View {
    var onPick: (String) -> Void
    @ViewBuilder var label: () -> Label
    @State private var item: PhotosPickerItem?
    var body: some View {
        PhotosPicker(selection: $item, matching: .images) { label() }
            .onChange(of: item) { it in Task { if let d = try? await it?.loadTransferable(type: Data.self), let s = avatarDataURL(from: d) { onPick(s) } } }
    }
}
