import Foundation
import CryptoKit

/// Aláírt tulajdonosi műveletek: ECDSA P-256 + SHA-256; ownerKey = nyers 65 bájtos pont (base64url), aláírás = P1363 (r‖s).
/// CryptoKit `rawRepresentation` pont ezt a formátumot használja, ezért nincs DER-konverzió.
struct RoomAuthority { var ownerKey: String; var ownerPrivateKey: String? }

func b64url(_ d: Data) -> String { d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func unb64url(_ s: String) -> Data? {
    var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while t.count % 4 != 0 { t += "=" }
    return Data(base64Encoded: t)
}

func payloadBytes(kind: String, token: String, target: String?, at: Int64, nonce: String) -> Data {
    let t = target == nil ? "null" : "\"\(target!)\""
    return Data("[\"\(kind)\",\"\(token)\",\(t),\(at),\"\(nonce)\"]".utf8)
}
func createRoomAuthority() -> RoomAuthority {
    let k = P256.Signing.PrivateKey()
    return RoomAuthority(ownerKey: b64url(k.publicKey.x963Representation), ownerPrivateKey: b64url(k.rawRepresentation))
}
func signRoomControl(token: String, auth: RoomAuthority, kind: String, target: String?) -> RoomControl? {
    guard let p = auth.ownerPrivateKey, let raw = unb64url(p), let key = try? P256.Signing.PrivateKey(rawRepresentation: raw) else { return nil }
    let at = nowMs(), nonce = UUID().uuidString
    guard let sig = try? key.signature(for: payloadBytes(kind: kind, token: token, target: target, at: at, nonce: nonce)) else { return nil }
    return RoomControl(kind: kind, token: token, target: target, at: at, nonce: nonce, signature: b64url(sig.rawRepresentation))
}
func verifyRoomControl(_ c: RoomControl, ownerKey: String) -> Bool {
    guard let pt = unb64url(ownerKey), pt.count == 65, let sigRaw = unb64url(c.signature),
          let pub = try? P256.Signing.PublicKey(x963Representation: pt), let sig = try? P256.Signing.ECDSASignature(rawRepresentation: sigRaw) else { return false }
    return pub.isValidSignature(sig, for: payloadBytes(kind: c.kind, token: c.token, target: c.target, at: c.at, nonce: c.nonce))
}
