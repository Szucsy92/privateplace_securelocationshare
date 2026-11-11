package hu.privateplace.app.p2p

import org.bouncycastle.asn1.sec.SECNamedCurves
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom

/** BIP-340 Schnorr aláírás (secp256k1) – a Nostr-események aláírásához. */
object Schnorr {
    private val params = SECNamedCurves.getByName("secp256k1")
    private val n: BigInteger = params.n
    private val g = params.g

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    private fun tagged(tag: String, vararg parts: ByteArray): ByteArray {
        val th = sha256(tag.toByteArray(Charsets.UTF_8))
        return sha256(parts.fold(th + th) { a, b -> a + b })
    }
    private fun b32(x: BigInteger): ByteArray { val r = x.toByteArray().dropWhile { it == 0.toByte() }.toByteArray(); return ByteArray(32 - r.size) + r }

    fun newSecretKey(): ByteArray {
        val rnd = SecureRandom()
        while (true) { val b = ByteArray(32).also { rnd.nextBytes(it) }; val d = BigInteger(1, b); if (d.signum() > 0 && d < n) return b }
    }
    fun publicKey(sk: ByteArray): ByteArray = b32(g.multiply(BigInteger(1, sk)).normalize().affineXCoord.toBigInteger())

    fun sign(sk: ByteArray, msg: ByteArray, aux: ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }): ByteArray {
        val d0 = BigInteger(1, sk)
        val p = g.multiply(d0).normalize()
        val d = if (p.affineYCoord.toBigInteger().testBit(0)) n.subtract(d0) else d0
        val px = b32(p.affineXCoord.toBigInteger())
        val t = b32(d).zip(tagged("BIP0340/aux", aux)) { a, b -> (a.toInt() xor b.toInt()).toByte() }.toByteArray()
        val k0 = BigInteger(1, tagged("BIP0340/nonce", t, px, msg)).mod(n)
        val r = g.multiply(k0).normalize()
        val k = if (r.affineYCoord.toBigInteger().testBit(0)) n.subtract(k0) else k0
        val rx = b32(r.affineXCoord.toBigInteger())
        val e = BigInteger(1, tagged("BIP0340/challenge", rx, px, msg)).mod(n)
        return rx + b32(k.add(e.multiply(d)).mod(n))
    }
}
