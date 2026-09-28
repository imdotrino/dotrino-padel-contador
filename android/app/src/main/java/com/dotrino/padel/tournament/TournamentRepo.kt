package com.dotrino.padel.tournament

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.dotrino.sdk.DotrinoStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.Executors

/**
 * Los torneos del usuario en el almacén, con los mismos hilos que la PWA (src/tournament/
 * repo.js): un documento por torneo en `padel.tournaments`, cuál está abierto en `padel.meta`
 * y los sets de reglas en `padel.rulesets`. En memoria se trabaja sobre los mismos objetos;
 * guardar agrupa los cambios seguidos (escribir un marcador dígito a dígito) en una escritura,
 * y escribe fuera del hilo de la pantalla.
 */
class TournamentRepo(context: Context) {
    companion object {
        const val THREAD = "padel.tournaments"
        const val META = "padel.meta"
        const val RULES = "padel.rulesets"
        private const val SAVE_DELAY = 400L
    }

    private val store = DotrinoStore(context, "padel")
    private val json = Json { encodeDefaults = true; explicitNulls = true; ignoreUnknownKeys = true }
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    var status = "idle" // "idle" | "loading" | "ready" | "error"
        private set
    var error: Throwable? = null
        private set
    var list = mutableListOf<Tournament>()
        private set
    var activeId: String? = null
        private set
    var rulesets = listOf<Ruleset>()
        private set

    /** Quien tenga que enterarse de un fallo al guardar (la pantalla lo enseña). */
    var onError: (Throwable) -> Unit = { throw it }

    private fun docs(thread: String) = store.listThread(thread).map { e ->
        e["doc"] ?: throw IllegalStateException("entry ${e["id"]} in $thread has no document")
    }

    private fun put(thread: String, id: String, doc: kotlinx.serialization.json.JsonElement) =
        store.appendMessage(thread, JsonObject(mapOf("id" to JsonPrimitive(id), "ts" to JsonPrimitive(System.currentTimeMillis()), "doc" to doc)))

    /** Carga todo; `done` corre en el hilo de la pantalla. */
    fun load(done: () -> Unit) {
        status = "loading"
        error = null
        io.execute {
            try {
                val tours = docs(THREAD).map { json.decodeFromJsonElement<Tournament>(it) }
                val meta = docs(META)
                val sets = docs(RULES).map { json.decodeFromJsonElement<Ruleset>(it) }
                for (s in sets) Engine.checkSettings(s.settings)
                val active = meta.lastOrNull()?.jsonObject?.get("activeId")?.jsonPrimitive?.content
                main.post {
                    list = tours.toMutableList()
                    rulesets = sets
                    activeId = active?.takeIf { id -> tours.any { it.id == id } }
                    status = "ready"
                    done()
                }
            } catch (e: Exception) {
                android.util.Log.e("padel", "could not load tournaments", e)
                main.post { status = "error"; error = e; done() }
            }
        }
    }

    fun active(): Tournament? = list.find { it.id == activeId }

    private val pending = LinkedHashMap<String, Tournament>()
    private val flushRunnable = Runnable { flush() }

    fun save(t: Tournament) {
        check(status == "ready") { "cannot save a tournament while the store is $status" }
        t.updatedAt = System.currentTimeMillis()
        if (t !in list) list.add(t)
        pending[t.id] = t
        main.removeCallbacks(flushRunnable)
        main.postDelayed(flushRunnable, SAVE_DELAY)
    }

    /** Lo que quedó sin escribir, ya (al ir la app a segundo plano). */
    fun flush() {
        main.removeCallbacks(flushRunnable)
        if (pending.isEmpty()) return
        // Se serializa AQUÍ, en el hilo de la pantalla: el objeto no cambia a medias mientras
        // se escribe.
        val batch = pending.values.map { it.id to json.encodeToJsonElement(it) }
        val tours = pending.values.toList()
        pending.clear()
        io.execute {
            for ((i, item) in batch.withIndex()) {
                try {
                    put(THREAD, item.first, item.second)
                } catch (e: Exception) {
                    android.util.Log.e("padel", "could not save tournament ${item.first}", e)
                    main.post { pending[item.first] = tours[i]; onError(e) } // se reintenta con el próximo guardado
                }
            }
        }
    }

    fun setActive(id: String?) {
        activeId = id
        io.execute {
            try {
                put(META, "meta", JsonObject(mapOf("activeId" to (id?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull))))
            } catch (e: Exception) {
                android.util.Log.e("padel", "could not save the open tournament", e)
                main.post { onError(e) }
            }
        }
    }

    fun remove(id: String) {
        pending.remove(id)
        list.removeAll { it.id == id }
        if (activeId == id) setActive(null)
        io.execute {
            try {
                store.removeMessage(THREAD, id)
            } catch (e: Exception) {
                android.util.Log.e("padel", "could not delete tournament $id", e)
                main.post { onError(e) }
            }
        }
    }

    /**
     * Guardar un set de reglas: se escribe primero y solo entonces entra en la lista, para que
     * la lista nunca enseñe algo que no quedó guardado. `done(null)` si fue bien.
     */
    fun saveRuleset(set: Ruleset, done: (Throwable?) -> Unit) {
        Engine.checkSettings(set.settings)
        io.execute {
            try {
                put(RULES, set.id, json.encodeToJsonElement(set))
                main.post { rulesets = rulesets.filter { it.id != set.id } + set; done(null) }
            } catch (e: Exception) {
                android.util.Log.e("padel", "could not save the rules", e)
                main.post { done(e) }
            }
        }
    }

    fun removeRuleset(id: String, done: (Throwable?) -> Unit) {
        io.execute {
            try {
                store.removeMessage(RULES, id)
                main.post { rulesets = rulesets.filter { it.id != id }; done(null) }
            } catch (e: Exception) {
                android.util.Log.e("padel", "could not delete the rules", e)
                main.post { done(e) }
            }
        }
    }
}
