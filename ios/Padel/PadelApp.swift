import DotrinoNative
import DotrinoNativeUI
import SwiftUI

@main
struct PadelApp: App {
    init() {
        // Antes de tocar cualquier llave o almacén: las apps de Dotrino del teléfono comparten
        // llavero y archivos (dotrino-native/docs/DISENO.md §2.1). Sin los grupos en los
        // entitlements se para aquí con su error, en vez de seguir como otro aparato.
        do {
            try SharedStorage.share(keychainAccessGroup: "P7G853375S.com.dotrino.shared", appGroup: "group.com.dotrino")
        } catch {
            fatalError("shared storage: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup { AppView() }
    }
}

/// Los colores de la PWA (src/style.css :root); los mismos que Android (colors.xml).
enum Palette {
    static let bg = Color(hex: 0x111827)
    static let surface = Color(hex: 0x1F2937)
    static let surface2 = Color(hex: 0x273244)
    static let border = Color(hex: 0x374151)
    static let text = Color(hex: 0xF3F4F6)
    static let muted = Color(hex: 0x9CA3AF)
    static let accent = Color(hex: 0xF59E0B)
    static let onAccent = Color(hex: 0x111827)
    static let danger = Color(hex: 0xB91C1C)
    static let win = Color(hex: 0xFDE047)
    static let left = Color(hex: 0x15803D)
    static let right = Color(hex: 0x7C3AED)
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

