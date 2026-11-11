import Foundation

let ROOM_ALPHABET = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
let ROOM_TOKEN_LENGTH = 20
let ROOM_COLORS = ["mint", "violet", "rose", "amber", "sky"]
let DEFAULT_ROOM_COLOR = "mint"
func isRoomColor(_ v: String?) -> Bool { v != nil && ROOM_COLORS.contains(v!) }

/// ownerPrivateKey: a Keychainben él (a Store tölti be); a JSON-ba nem kerül.
struct SavedRoom: Equatable {
    var token: String, name: String, owner: Bool, createdAt: Int64
    var color = DEFAULT_ROOM_COLOR
    var ownerKey: String? = nil
    var ownerPrivateKey: String? = nil
}
struct Invitation { var token: String; var name: String?; var color: String? = nil; var ownerKey: String? = nil }

func isOwnerKey(_ s: String?) -> Bool {
    guard let s = s, s.count == 87 else { return false }
    return s.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
}
func generateRoomToken() -> String {
    var b = [UInt8](repeating: 0, count: ROOM_TOKEN_LENGTH)
    _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
    return String(b.map { ROOM_ALPHABET[Int($0) % ROOM_ALPHABET.count] })
}
func roomQrValue(_ token: String, _ ownerKey: String?) -> String { isOwnerKey(ownerKey) ? "\(token).\(ownerKey!)" : token }
func formatRoomToken(_ t: String) -> String {
    stride(from: 0, to: t.count, by: 5).map { i in String(t.dropFirst(i).prefix(5)) }.joined(separator: "-")
}
func roomShareCode(_ token: String, _ ownerKey: String?) -> String { isOwnerKey(ownerKey) ? "\(formatRoomToken(token)).\(ownerKey!)" : formatRoomToken(token) }

private func normalizeToken(_ raw: String) -> String? {
    let c = String(raw.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
    return c.count == ROOM_TOKEN_LENGTH && c.allSatisfy({ ROOM_ALPHABET.contains($0) }) ? c : nil
}
private func parseQuery(_ q: String) -> [String: String] {
    var out: [String: String] = [:]
    for part in q.split(separator: "&") {
        let kv = part.split(separator: "=", maxSplits: 1)
        guard kv.count == 2 else { continue }
        func dec(_ s: Substring) -> String { s.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? String(s) }
        out[dec(kv[0])] = dec(kv[1])
    }
    return out
}
func parseRoomInput(_ input: String) -> Invitation? {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    if let h = text.firstIndex(of: "#") {
        let p = parseQuery(String(text[text.index(after: h)...]))
        if let raw = p["szoba"], !raw.isEmpty {
            guard let token = normalizeToken(raw) else { return nil }
            let name = p["nev"].flatMap { $0.isEmpty ? nil : String($0.prefix(40)) }
            return Invitation(token: token, name: name, color: isRoomColor(p["szin"]) ? p["szin"] : nil, ownerKey: isOwnerKey(p["gazda"]) ? p["gazda"] : nil)
        }
    }
    if let dot = text.lastIndex(of: "."), dot != text.startIndex {
        let key = String(text[text.index(after: dot)...]).trimmingCharacters(in: .whitespaces)
        if let token = normalizeToken(String(text[..<dot])), isOwnerKey(key) { return Invitation(token: token, name: nil, color: nil, ownerKey: key) }
        return nil
    }
    return normalizeToken(text).map { Invitation(token: $0, name: nil) }
}
func buildRoomLink(base: String, token: String, name: String?, color: String?, ownerKey: String?) -> String {
    func e(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }
    var parts = ["szoba=\(e(token))"]
    if let n = name, !n.isEmpty { parts.append("nev=\(e(n))") }
    if isRoomColor(color) { parts.append("szin=\(e(color!))") }
    if isOwnerKey(ownerKey) { parts.append("gazda=\(e(ownerKey!))") }
    return base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/#" + parts.joined(separator: "&")
}
