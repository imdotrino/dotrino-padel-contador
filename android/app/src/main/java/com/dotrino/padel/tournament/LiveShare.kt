package com.dotrino.padel.tournament

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.dotrino.sdk.BroadcastHost
import com.dotrino.sdk.PhoneIdentity
import com.dotrino.sdk.Profile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

/**
 * VER EL TORNEO EN VIVO desde el teléfono: el puerto de `src/tournament/live.js`. Quien organiza
 * emite el torneo con la emisión de lobby (`BroadcastHost` de dotrino-native), firmado por SU
 * perfil —el de la app de identidad, el mismo que en la web— y sellado a cada uno de los que
 * miran. Quien mira abre el enlace en el navegador (la PWA).
 *
 * La clave y el secreto se guardan en el torneo (`tour.share`): el enlace sigue sirviendo
 * aunque la app se cierre y se vuelva a abrir.
 */
class LiveShare(context: Context, private val onChange: () -> Unit, private val onError: (String) -> Unit) {
    companion object {
        const val URL = "wss://proxy.dotrino.com"
        const val GAME_ID = "padel"
        const val WATCH_BASE = "https://padel.dotrino.com/"
        private const val PUBLISH_DELAY = 800L
    }

    private val identity = PhoneIdentity(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    private val json = Json { encodeDefaults = true; explicitNulls = true }
    private val hosts = HashMap<String, BroadcastHost>() // tournament.id → emisión
    private val timers = HashMap<String, Runnable>()

    fun isSharing(tour: Tournament?) = tour?.share != null
    fun viewersOf(tour: Tournament) = hosts[tour.id]?.viewers ?: 0

    /** Lo que ven los demás: el torneo tal cual, sin la clave del enlace. */
    private fun snapshot(tour: Tournament): JsonObject = JsonObject(json.encodeToJsonElement(tour).jsonObject - "share")

    /** Por qué no se pudo, en palabras de la app (el código decide, no la frase). */
    fun reasonOf(e: Throwable): String = when ((e as? Profile.ProfileError)?.code) {
        "no-identity-app" -> "no-identity-app"
        "no-profile", "no-profile-keys" -> com.dotrino.padel.t("liveNeedsProfile")
        "needs-vault-signer" -> com.dotrino.padel.t("liveNeedsSigner")
        else -> com.dotrino.padel.t("liveFailed", "reason" to (e.message ?: e.toString()))
    }

    private suspend fun hostFor(tour: Tournament): BroadcastHost {
        hosts[tour.id]?.let { return it }
        val profile = identity.profile()
        val ref = tour.share?.let { BroadcastHost.Ref(it.key, it.secret) }
        val host = BroadcastHost(URL, GAME_ID, profile, PhoneIdentity.transportKey(), ref)
        host.onViewers = { main.post(onChange) }
        host.onStatus = { main.post(onChange) }
        host.onWarn = { what, e -> android.util.Log.w("padel", "live: $what failed", e) }
        host.start()
        hosts[tour.id] = host
        return host
    }

    /**
     * Empieza a compartir, o retoma lo que ya se compartía (el mismo enlace). Si el torneo no
     * tenía enlace, deja la clave en `tour.share`: quien llama lo guarda. `done(link)` o el error.
     */
    fun share(tour: Tournament, done: (Result<String>) -> Unit) {
        val snap = snapshot(tour)
        scope.launch {
            val r = runCatching {
                val host = hostFor(tour)
                host.publish(snap)
                host.linkRef to host.link(WATCH_BASE)
            }
            withContext(Dispatchers.Main) {
                r.onSuccess { (ref, link) ->
                    if (tour.share == null) tour.share = ShareRef(ref.key, ref.secret)
                    onChange()
                    done(Result.success(link))
                }.onFailure {
                    android.util.Log.e("padel", "could not share the tournament", it)
                    done(Result.failure(it))
                }
            }
        }
    }

    /** Tras abrir la app: si el torneo abierto se compartía, se vuelve a emitir con el mismo enlace. */
    fun resume(tour: Tournament?) {
        if (tour?.share == null || hosts.containsKey(tour.id)) return
        share(tour) { r -> r.onFailure { onError(reasonOf(it)) } }
    }

    /** Un cambio del torneo: si se comparte, sale en un momento (se agrupan los seguidos). */
    fun publishSoon(tour: Tournament) {
        val host = hosts[tour.id] ?: return
        timers[tour.id]?.let { main.removeCallbacks(it) }
        val r = Runnable {
            val snap = snapshot(tour)
            scope.launch { runCatching { host.publish(snap) }.onFailure { e -> main.post { onError(reasonOf(e)) } } }
        }
        timers[tour.id] = r
        main.postDelayed(r, PUBLISH_DELAY)
    }

    /** Dejar de compartir: el enlace deja de servir; quien miraba se queda con lo último. */
    fun stop(tour: Tournament) {
        val host = hosts.remove(tour.id)
        tour.share = null
        timers.remove(tour.id)?.let { main.removeCallbacks(it) }
        if (host != null) scope.launch { host.close() }
        onChange()
    }

    fun close() {
        for (h in hosts.values) scope.launch { h.close() }
        hosts.clear()
        identity.close()
    }
}
