package com.dotrino.padel.tournament

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Los casos de oro de `test/vectors/engine.json`, sacados del motor de la PWA: cada caso se
 * repite aquí con el mismo azar (mulberry32 con la misma semilla) y los mismos ids, y después de
 * cada operación el torneo y todo lo que la pantalla lee de él tiene que ser IDÉNTICO.
 */
class EngineVectorsTest {
    private val json = Json { encodeDefaults = true; explicitNulls = true }

    /** mulberry32, bit a bit como `seeded` de gen.mjs. */
    private fun seeded(seed: Long): () -> Double {
        var a = seed.toInt()
        return {
            a += 0x6d2b79f5
            var x = a
            x = (x xor (x ushr 15)) * (x or 1)
            x = x xor (x + (x xor (x ushr 7)) * (x or 61))
            (x xor (x ushr 14)).toLong().and(0xffffffffL).toDouble() / 4294967296.0
        }
    }

    private fun scorer(kind: String, i: Int): Pair<Int, Int> = when (kind) {
        "fixed" -> 6 to 3
        "cycle" -> 6 to (i * 5) % 7
        "draws" -> if (i % 3 == 0) 4 to 4 else 6 to i % 5
        else -> throw IllegalArgumentException(kind)
    }

    private fun scoreRound(t: Tournament, r: Round, kind: String, withSets: Boolean) {
        r.matches.forEachIndexed { i, m ->
            val (a, b) = scorer(kind, i + t.rounds.size * 3)
            Engine.setScore(t, m.id, a, b)
            if (withSets) Engine.setSets(t, m.id, if (a > b) 2 else if (a < b) 0 else 1, if (a > b) 0 else if (a < b) 2 else 1)
        }
    }

    private fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content
    private fun JsonObject.int(k: String) = this[k]!!.jsonPrimitive.int
    private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.boolean ?: false

    private fun apply(t: Tournament, rng: () -> Double, o: JsonObject) {
        when (o.str("op")) {
            "generate" -> Engine.generateRound(t, rng)?.let { t.rounds.add(it) }
            "scoreLast" -> scoreRound(t, t.rounds.last(), o.str("scorer"), o.bool("sets"))
            "playAll" -> {
                for (guard in 0 until 60) {
                    val r = Engine.generateRound(t, rng) ?: return
                    t.rounds.add(r)
                    scoreRound(t, r, o.str("scorer"), o.bool("sets"))
                }
                throw IllegalStateException("tournament never ended")
            }
            "addPlayer" -> Engine.addPlayer(t, o.str("name"))
            "addTeam" -> Engine.addTeam(t, o.str("a"), o.str("b"))
            "removePlayer" -> Engine.removePlayer(t, t.players[o.int("index")].id)
            "removeTeam" -> Engine.removeTeam(t, t.teams[o.int("index")].id)
            "restore" -> Engine.restoreUnit(t, if (o.bool("team")) t.teams[o.int("index")].id else t.players[o.int("index")].id)
            "redo" -> Engine.redoLastRound(t, rng)
            "dropLast" -> Engine.removeLastRound(t)
            "applyRules" -> Engine.applyRules(t, settingsOf(o["settings"]!!.jsonObject), rng)
            "toggleScoring" -> Engine.toggleScoring(t.settings, o.str("kind"), o.bool("on"))
            "startClock" -> Engine.startClock(t, t.rounds[o.int("round")].id, o["now"]!!.jsonPrimitive.long)
            "pauseClock" -> Engine.pauseClock(t, t.rounds[o.int("round")].id, o["now"]!!.jsonPrimitive.long)
            "resumeClock" -> Engine.resumeClock(t, t.rounds[o.int("round")].id, o["now"]!!.jsonPrimitive.long)
            "resetClock" -> Engine.resetClock(t, t.rounds[o.int("round")].id)
            else -> throw IllegalArgumentException("unknown op ${o.str("op")}")
        }
    }

    /** Los ajustes de un caso: los de fábrica con lo que el caso cambia encima (como en gen.mjs). */
    private fun settingsOf(partial: JsonObject): Settings {
        val base = json.encodeToJsonElement(Engine.defaultSettings()).jsonObject
        return json.decodeFromJsonElement(JsonObject(base + partial))
    }

    /** El torneo tal cual lo guarda la PWA: sin la clave de compartir (la PWA no la pone). */
    private fun tournamentJson(t: Tournament): JsonElement = JsonObject(json.encodeToJsonElement(t).jsonObject - "share")

    private fun observe(t: Tournament, o: JsonObject): JsonObject {
        val out = mutableMapOf(
            "status" to json.encodeToJsonElement(Engine.status(t)),
            "estimate" to (Engine.estimate(t)?.let { json.encodeToJsonElement(it) } ?: JsonNull),
            "blocker" to (Engine.nextRoundBlocker(t)?.let { JsonPrimitive(it) } ?: JsonNull),
            "everyoneMatchesEach" to (Engine.everyoneMatchesEach(t)?.let { JsonPrimitive(it) } ?: JsonNull),
            "maxCourts" to JsonPrimitive(Engine.maxCourts(t)),
            "canRedo" to JsonPrimitive(Engine.canRedoLastRound(t)),
            "standings" to json.encodeToJsonElement(Engine.standings(t)),
            "tournament" to tournamentJson(t),
        )
        o["clockAt"]?.let { at ->
            out["clock"] = JsonArray(t.rounds.map { json.encodeToJsonElement(Engine.clockOf(t, it, at.jsonPrimitive.long)) })
        }
        return JsonObject(out)
    }

    @Test fun matchesThePwaEngine() {
        val text = javaClass.classLoader!!.getResource("engine.json")!!.readText()
        val cases = Json.parseToJsonElement(text).jsonObject["cases"]!!.jsonArray
        assert(cases.size >= 20) { "too few cases: ${cases.size}" }
        for (c in cases.map { it.jsonObject }) {
            val name = c.str("name")
            var next = 0
            Engine.newId = { "id${++next}" }
            val init = c["initial"]!!.jsonObject
            val t = Engine.createTournament(init.str("name"), json.decodeFromJsonElement(init["settings"]!!), null, init["createdAt"]!!.jsonPrimitive.long)
            for (p in init["players"]!!.jsonArray) {
                if (init["teams"]!!.jsonArray.isEmpty()) Engine.addPlayer(t, p.jsonObject.str("name"))
            }
            // Las parejas se crean como en gen.mjs: dos jugadores y la pareja, en ese orden.
            val players = init["players"]!!.jsonArray.map { it.jsonObject }
            for (team in init["teams"]!!.jsonArray) {
                val (a, b) = team.jsonObject["players"]!!.jsonArray.map { id -> players.first { it.str("id") == id.jsonPrimitive.content }.str("name") }
                Engine.addTeam(t, a, b)
            }
            assertEquals("$name: initial", init, tournamentJson(t))
            val rng = seeded(c["seed"]!!.jsonPrimitive.long)
            val ops = c["ops"]!!.jsonArray
            val steps = c["steps"]!!.jsonArray
            ops.forEachIndexed { i, op ->
                apply(t, rng, op.jsonObject)
                val want = steps[i].jsonObject
                val got = observe(t, op.jsonObject)
                for (k in want.keys) assertEquals("$name: step $i (${op.jsonObject.str("op")}) $k", want[k], got[k])
            }
        }
        Engine.newId = { java.util.UUID.randomUUID().toString() }
    }

    @Test fun formatClockRoundsUp() {
        assertEquals("12:00", Engine.formatClock(720000))
        assertEquals("0:01", Engine.formatClock(1))
        assertEquals("0:00", Engine.formatClock(0))
    }
}
