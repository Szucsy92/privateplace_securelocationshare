import SwiftUI

enum HintPlace { case share, transport, address, marker, rail, ask }
struct Hint { var place: HintPlace; var text: String }

/// Kompakt, egymondatos súgóbuborékok (a régi, hosszabb szövegek rövidítve).
let HINTS: [Hint] = [
    Hint(place: .share, text: "Egy koppintás: megosztás be/ki. Leállítva kíméli az akkut."),
    Hint(place: .transport, text: "Közlekedési mód: magától vált, rábökve te is választhatsz."),
    Hint(place: .address, text: "Cím: csak a megnyitott jelölő helye megy a címkeresőhöz. A Beállításokban kapcsolható."),
    Hint(place: .marker, text: "Koppints egy jelölőre: akku, cím, mióta áll."),
    Hint(place: .rail, text: "Koppints egy személyre a követéshez. Ha nem oszt meg, innen kérheted."),
    Hint(place: .ask, text: "Megosztáskérésnél felül üzenet jön – a „Megosztás” gombbal azonnal bekapcsolod."),
]

struct HintBubble: View {
    var step: Int
    var onNext: () -> Void
    var onSkip: () -> Void
    var body: some View {
        if step < HINTS.count {
            let h = HINTS[step]
            let (align, pad): (Alignment, EdgeInsets) = {
                switch h.place {
                case .share, .ask: return (.topLeading, EdgeInsets(top: 74, leading: 12, bottom: 0, trailing: 0))
                case .transport: return (.bottomLeading, EdgeInsets(top: 0, leading: 12, bottom: 150, trailing: 0))
                case .address: return (.bottom, EdgeInsets(top: 0, leading: 0, bottom: 132, trailing: 0))
                case .marker: return (.center, EdgeInsets())
                case .rail: return (.bottomLeading, EdgeInsets(top: 0, leading: 12, bottom: 96, trailing: 0))
                }
            }()
            VStack(alignment: .leading, spacing: 6) {
                Text(h.text).font(.system(size: 12)).foregroundColor(.white).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Kihagyás") { withAnimation(harmonika) { onSkip() } }.font(.system(size: 11)).foregroundColor(.muted)
                    Spacer()
                    Button(step + 1 < HINTS.count ? "Tovább \(step + 1)/\(HINTS.count)" : "Értem") { withAnimation(harmonika) { onNext() } }.font(.system(size: 12)).foregroundColor(.mint)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: 250).glass(16).id(step).transition(.opacity)
            .padding(pad).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: align)
            .animation(harmonika, value: step)
        }
    }
}
