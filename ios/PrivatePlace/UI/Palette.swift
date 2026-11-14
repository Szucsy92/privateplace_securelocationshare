import SwiftUI

/// A webes "Signal" design rendszer színei (styles.css, oklch → sRGB átszámítva).
struct Palette {
    var background: Color
    var foreground: Color
    var surface: Color
    var surfaceStrong: Color
    var card: Color
    var primary: Color
    var primaryForeground: Color
    var secondary: Color
    var muted: Color
    var mutedForeground: Color
    var accent: Color
    var destructive: Color
    var border: Color
    var input: Color
    var ring: Color
    var live: Color
    var warn: Color
    var dialogBackdrop: Color
    var glassBg: Color
    var glassStrong: Color
    var glassInset: Color
    var glassEdge: Color
    var glow: Color
    var tint: Color
    var shade: Color
    var fieldBg: Color
    var mapFallback: Color
    var veilColor: Color
    var signal: Color
    var dark: Bool
}

extension Color {
    init(argb: UInt32) { self.init(.sRGB, red: Double((argb >> 16) & 255) / 255, green: Double((argb >> 8) & 255) / 255, blue: Double(argb & 255) / 255, opacity: Double((argb >> 24) & 255) / 255) }
}

let darkPalette = Palette(
    background: Color(argb: 0xFF09111E),
    foreground: Color(argb: 0xFFEEF2F7),
    surface: Color(argb: 0xFF141E2C),
    surfaceStrong: Color(argb: 0xFF1C2838),
    card: Color(argb: 0xFF121C2B),
    primary: Color(argb: 0xFF14B8A6),
    primaryForeground: Color(argb: 0xFF001718),
    secondary: Color(argb: 0xFF1E293A),
    muted: Color(argb: 0xFF1B2433),
    mutedForeground: Color(argb: 0xFF9CA6B1),
    accent: Color(argb: 0xFFF2B036),
    destructive: Color(argb: 0xFFFB7185),
    border: Color(argb: 0xFF293342),
    input: Color(argb: 0xFF242E3D),
    ring: Color(argb: 0xFF00E9A5),
    live: Color(argb: 0xFF14B8A6),
    warn: Color(argb: 0xFFFBBF24),
    dialogBackdrop: Color(argb: 0x80000205),
    glassBg: Color(argb: 0xB8283241),
    glassStrong: Color(argb: 0xEB182331),
    glassInset: Color(argb: 0x0BFFFFFF),
    glassEdge: Color(argb: 0x1AFFFFFF),
    glow: Color(argb: 0x8000E9A5),
    tint: Color(argb: 0xFFFFFFFF),
    shade: Color(argb: 0xFF000001),
    fieldBg: Color(argb: 0x7303060D),
    mapFallback: Color(argb: 0xFF050911),
    veilColor: Color(argb: 0xFF050911),
    signal: Color(argb: 0xFF00E9A5),
    dark: true
)

let lightPalette = Palette(
    background: Color(argb: 0xFFD6CEC1),
    foreground: Color(argb: 0xFF16202E),
    surface: Color(argb: 0xFFE2DBCF),
    surfaceStrong: Color(argb: 0xFFD9D0C1),
    card: Color(argb: 0xFFE5DFD3),
    primary: Color(argb: 0xFF0D8F84),
    primaryForeground: Color(argb: 0xFFF5FCFA),
    secondary: Color(argb: 0xFFCCC3B5),
    muted: Color(argb: 0xFFCEC6B9),
    mutedForeground: Color(argb: 0xFF434E5E),
    accent: Color(argb: 0xFFDE9C31),
    destructive: Color(argb: 0xFFD63D5C),
    border: Color(argb: 0xFFB5AD9F),
    input: Color(argb: 0xFFBCB3A5),
    ring: Color(argb: 0xFF00978A),
    live: Color(argb: 0xFF0D8F84),
    warn: Color(argb: 0xFFC98206),
    dialogBackdrop: Color(argb: 0x613D3022),
    glassBg: Color(argb: 0xCCDFD8CC),
    glassStrong: Color(argb: 0xF5E7E0D6),
    glassInset: Color(argb: 0x0D362C1C),
    glassEdge: Color(argb: 0x33433929),
    glow: Color(argb: 0x6100978A),
    tint: Color(argb: 0xFF322618),
    shade: Color(argb: 0xFF503F2B),
    fieldBg: Color(argb: 0xA6F2EEE6),
    mapFallback: Color(argb: 0xFFE4DCCB),
    veilColor: Color(argb: 0xFFCBC3B6),
    signal: Color(argb: 0xFF00978A),
    dark: false
)
