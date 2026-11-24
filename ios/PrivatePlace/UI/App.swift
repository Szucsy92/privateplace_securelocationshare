import SwiftUI

@main
struct PrivatePlaceApp: App {
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            AppRoot().environmentObject(app).preferredColorScheme(app.prefs.mapTheme == "dark" ? .dark : .light)
                .onOpenURL { app.handleURL($0) }                       // meghívó: privateplace://…#szoba=… vagy univerzális link
                .onChange(of: phase) { p in
                    app.engine.setVisible(p == .active)                 // előtér: 1 mp; háttér: energiatakarékos
                    if p == .active { app.peers.wake() }
                }
        }
    }
}
