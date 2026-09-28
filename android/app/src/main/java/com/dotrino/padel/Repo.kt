package com.dotrino.padel

import android.content.Context
import com.dotrino.sdk.DotrinoStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

/**
 * Dónde vive cada cosa, igual que en la PWA (CONVENCIONES §4):
 *  - el partido en curso y las opciones del marcador son progreso volátil del aparato →
 *    preferencias de la app (lo que en la web es localStorage);
 *  - los resultados son del usuario → el almacén (`DotrinoStore`), hilo `padel.results`, el
 *    mismo documento que guarda la PWA.
 */
class Repo(context: Context) {
    private val prefs = context.getSharedPreferences("padel", Context.MODE_PRIVATE)
    private val store = DotrinoStore(context, "padel")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    companion object {
        const val RESULTS = "padel.results"
        private const val LIVE = "live"
        private const val CONFIG = "config"
    }

    // Un valor corrupto de las preferencias se descarta y se dice en el log: es progreso
    // volátil, y quedarse sin abrir la app por él sería peor. Lo del almacén, en cambio, lanza.
    private inline fun <reified T> read(key: String): T? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            json.decodeFromString<T>(raw)
        } catch (e: Exception) {
            android.util.Log.e("padel", "discarding corrupt $key", e)
            prefs.edit().remove(key).apply()
            null
        }
    }

    fun loadMatch(): Match = read<Match>(LIVE) ?: Match()
    fun saveMatch(m: Match) = prefs.edit().putString(LIVE, json.encodeToString(Match.serializer(), m)).apply()

    fun loadConfig(): Config = read<Config>(CONFIG) ?: Config()
    fun saveConfig(c: Config) = prefs.edit().putString(CONFIG, json.encodeToString(Config.serializer(), c)).apply()

    fun results(): List<Result> = store.listThread(RESULTS).map { e ->
        val doc = e["doc"] ?: throw IllegalStateException("entry ${e["id"]} in $RESULTS has no document")
        json.decodeFromJsonElement<Result>(doc)
    }

    fun saveResult(r: Result) = store.appendMessage(RESULTS, JsonObject(mapOf(
        "id" to JsonPrimitive(r.id),
        "ts" to JsonPrimitive(System.currentTimeMillis()),
        "doc" to json.encodeToJsonElement(r).jsonObject,
    )))

    fun deleteResult(id: String) = store.removeMessage(RESULTS, id)
}
