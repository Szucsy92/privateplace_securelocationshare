package hu.privateplace.app.p2p

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A tartalom URL-biztos base64 (nincs "/"), így a Nostr-esemény azonosítója minden JSON-szerializálóval azonos. A szobakulcs (token) egyben a jelzések titkosító jelszava; a relék csak titkosított tartalmat és egy témahasht látnak. */
class RoomCrypto(token: String) {
    val topic: String = Schnorr.sha256("privateplace/v1/topic/$token".toByteArray()).joinToString("") { "%02x".format(it) }
    private val key = SecretKeySpec(Schnorr.sha256("privateplace/v1/key/$token".toByteArray()), "AES")
    private val rnd = SecureRandom()

    fun encrypt(plain: String): String {
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(iv + c.doFinal(plain.toByteArray(Charsets.UTF_8)))
    }
    fun decrypt(b64: String): String? = runCatching {
        val raw = Base64.getUrlDecoder().decode(b64)
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        String(c.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
    }.getOrNull()
}
