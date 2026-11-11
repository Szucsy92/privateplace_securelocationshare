package hu.privateplace.app.domain

import java.math.BigInteger
import java.security.*
import java.security.interfaces.ECPublicKey
import java.security.spec.*
import java.util.Base64
import java.util.UUID

/**
 * Aláírt tulajdonosi műveletek (szoba törlése, tag eltávolítása): ECDSA P-256 + SHA-256.
 * Vezetéken: ownerKey = nyers 65 bájtos pont (base64url, 87 jel), aláírás = P1363 (r‖s, 64 bájt).
 * Az aláírt tartalom pontosan: ["kind","TOKEN",target|null,at,"nonce"].
 */
data class RoomAuthority(val ownerKey: String, val ownerPrivateKey: String?)

private fun b64(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
private fun unb64(s: String) = Base64.getUrlDecoder().decode(s)

private val curveParams: ECParameterSpec by lazy {
    val kpg = KeyPairGenerator.getInstance("EC"); kpg.initialize(ECGenParameterSpec("secp256r1"))
    (kpg.generateKeyPair().public as ECPublicKey).params
}

private fun pad32(b: BigInteger): ByteArray {
    val raw = b.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
    require(raw.size <= 32); return ByteArray(32 - raw.size) + raw
}

fun payloadBytes(kind: String, token: String, target: String?, at: Long, nonce: String): ByteArray {
    val t = if (target == null) "null" else "\"$target\""
    return "[\"$kind\",\"$token\",$t,$at,\"$nonce\"]".toByteArray(Charsets.UTF_8)
}

fun createRoomAuthority(): RoomAuthority {
    val kpg = KeyPairGenerator.getInstance("EC"); kpg.initialize(ECGenParameterSpec("secp256r1"))
    val pair = kpg.generateKeyPair()
    val w = (pair.public as ECPublicKey).w
    val raw = byteArrayOf(0x04) + pad32(w.affineX) + pad32(w.affineY)
    return RoomAuthority(b64(raw), b64(pair.private.encoded))
}

fun derToP1363(der: ByteArray): ByteArray {
    var i = 2
    if (der[1].toInt() and 0x80 != 0) i = 2 + (der[1].toInt() and 0x7f)
    require(der[i] == 0x02.toByte()); val rl = der[i + 1].toInt() and 0xff
    val r = der.copyOfRange(i + 2, i + 2 + rl); i += 2 + rl
    require(der[i] == 0x02.toByte()); val sl = der[i + 1].toInt() and 0xff
    val s = der.copyOfRange(i + 2, i + 2 + sl)
    fun fix(b: ByteArray): ByteArray { val t = b.dropWhile { it == 0.toByte() }.toByteArray(); require(t.size <= 32); return ByteArray(32 - t.size) + t }
    return fix(r) + fix(s)
}

fun p1363ToDer(sig: ByteArray): ByteArray {
    require(sig.size == 64)
    fun enc(b: ByteArray): ByteArray {
        var t = b.dropWhile { it == 0.toByte() }.toByteArray()
        if (t.isEmpty()) t = byteArrayOf(0)
        if (t[0] < 0) t = byteArrayOf(0) + t
        return byteArrayOf(0x02, t.size.toByte()) + t
    }
    val r = enc(sig.copyOfRange(0, 32)); val s = enc(sig.copyOfRange(32, 64))
    return byteArrayOf(0x30, (r.size + s.size).toByte()) + r + s
}

fun signRoomControl(token: String, auth: RoomAuthority, kind: String, target: String?): RoomControl {
    val priv = auth.ownerPrivateKey ?: error("Owner only")
    val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(unb64(priv)))
    val at = System.currentTimeMillis(); val nonce = UUID.randomUUID().toString()
    val sig = Signature.getInstance("SHA256withECDSA").run { initSign(key); update(payloadBytes(kind, token, target, at, nonce)); sign() }
    return RoomControl(kind, token, target, at, nonce, b64(derToP1363(sig)))
}

fun verifyRoomControl(c: RoomControl, ownerKey: String): Boolean = runCatching {
    val pt = unb64(ownerKey)
    require(pt.size == 65 && pt[0] == 0x04.toByte())
    val point = ECPoint(BigInteger(1, pt.copyOfRange(1, 33)), BigInteger(1, pt.copyOfRange(33, 65)))
    val pub = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, curveParams))
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(pub); update(payloadBytes(c.kind, c.token, c.target, c.at, c.nonce)); verify(p1363ToDer(unb64(c.signature)))
    }
}.getOrDefault(false)
