import SwiftUI

@main
struct PrivatePlaceApp: App {
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group { if app.profile == nil { OnboardingView() } else { MapScreen() } }
                .environmentObject(app).preferredColorScheme(.dark)
                .onOpenURL { app.handleURL($0) }                     // meghívó: privateplace://…#szoba=… vagy univerzális link
                .onChange(of: phase) { p in
                    app.engine.setVisible(p == .active)               // előtér: 1 mp; háttér: energiatakarékos
                    if p == .active { app.peers.wake() }
                }
        }
    }
}

struct OnboardingView: View {
    @EnvironmentObject var app: AppModel
    @State private var name = "", avatar: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Spacer()
            Text("Üdv a Private Place-ben").font(.title2.bold()).foregroundColor(.white)
            Text("Nincs fiók, nincs szerver. A neved és a képed csak a szobatársaidhoz jut el.").font(.footnote).foregroundColor(.muted)
            ProfileRow(name: $name, avatar: avatar, onAvatar: { avatar = $0 })
            Button("Tovább") { app.saveProfile(LocalProfile(name: name.trimmingCharacters(in: .whitespaces), avatar: avatar)) }
                .buttonStyle(.borderedProminent).frame(maxWidth: .infinity).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            Spacer()
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.navy)
    }
}
