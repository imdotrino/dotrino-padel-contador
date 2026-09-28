package com.dotrino.padel

import kotlinx.serialization.Serializable

// El marcador de un partido: puntos, juegos, sets, tie-break y saque. Es el mismo modelo que
// `src/scoreboard.js` de la PWA (que va delante, CONVENCIONES §16.1); aquí solo la lógica, sin
// pantalla, para poder probarla en la JVM.

enum class Scoring { advantage, star, golden }

@Serializable
data class Config(val scoring: Scoring = Scoring.golden, val sets: Int = 3) {
    init { require(sets in SETS) { "sets must be 1, 3 or 5: $sets" } }
    companion object { val SETS = listOf(1, 3, 5) }
}

// p = puntos del juego actual (0..40 / ventaja, o nº en tie-break), g = juegos del set actual,
// s = sets ganados.
@Serializable
data class SideScore(val p: Int = 0, val g: Int = 0, val s: Int = 0)

@Serializable
data class SetScore(val left: Int, val right: Int)

enum class Side { left, right;
    val other get() = if (this == left) right else left
}

@Serializable
data class Snapshot(
    val left: SideScore = SideScore(),
    val right: SideScore = SideScore(),
    val server: Side = Side.left,
    val gameNum: Int = 0, // juegos jugados en el partido (rota el orden de saque P1/P2)
    val tiebreak: Boolean = false,
    val setsHistory: List<SetScore> = emptyList(), // sets cerrados (juegos)
) {
    operator fun get(side: Side) = if (side == Side.left) left else right
    fun with(side: Side, v: SideScore) = if (side == Side.left) copy(left = v) else copy(right = v)
}

/** Lo que se ve en el panel de puntos: el texto y si es una ventaja. */
data class PointText(val text: String, val ad: Boolean)

/**
 * El partido en curso, con su pila de deshacer. Inmutable por dentro: cada jugada deja una
 * instantánea nueva y guarda la anterior.
 */
@Serializable
data class Match(
    val now: Snapshot = Snapshot(),
    val undo: List<Snapshot> = emptyList(),
    val names: Names = Names(),
    /** Un partido del torneo (`state.link` de la PWA); null = partido suelto. */
    val link: Link? = null,
) {
    @Serializable
    data class Names(val left: String = "", val right: String = "")

    /**
     * El partido del torneo que se juega en el marcador. `target`: a cuántos juegos (0 = sin
     * límite); `timed`: por tiempo (el cronómetro de su ronda); `sets`: si el torneo cuenta sets.
     */
    @Serializable
    data class Link(
        val tournamentId: String,
        val tournamentName: String,
        val matchId: String,
        val roundId: String,
        val round: Int,
        val court: Int,
        val timed: Boolean,
        val target: Int,
        val sets: Boolean,
        val left: String,
        val right: String,
    )

    /** Juegos de un lado en todo el partido: los de los sets cerrados más los del set en curso. */
    fun totalGames(side: Side) = now.setsHistory.sumOf { if (side == Side.left) it.left else it.right } + now[side].g

    private fun push(next: Snapshot) = copy(now = next, undo = undo + now)

    /** Los juegos se acumulan sin cerrar sets a 1 set («cuenta sin fin»), o en un partido del
     *  torneo que no cuenta sets. Si el torneo puntúa por sets, su partido cierra sets de verdad. */
    private fun endless(c: Config) = if (link != null) !link.sets else c.sets == 1

    // Puntos de diferencia para cerrar el juego según el modo:
    //  · golden    → 1: en 40-40 el siguiente punto define.
    //  · advantage → 2: hay que ganar por dos (la igualdad se repite sin fin).
    //  · star      → 2, pero a la 3.ª igualdad (ambos en 5 = se gastaron las dos ventajas)
    //                pasa a punto de oro = 1.
    private fun diffNeeded(c: Config, a: Int, b: Int) = when {
        c.scoring == Scoring.golden -> 1
        c.scoring == Scoring.star && minOf(a, b) >= 5 -> 1
        else -> 2
    }

    /** ¿El marcador a-b ya cierra el juego (o el tie-break) a favor del primero? */
    private fun closes(c: Config, s: Snapshot, a: Int, b: Int) =
        if (s.tiebreak) a >= 7 && a - b >= 2 else a >= 4 && a - b >= diffNeeded(c, a, b)

    fun winPoint(c: Config, side: Side): Match {
        var s = now.with(side, now[side].copy(p = now[side].p + 1))
        val a = s[side].p
        val b = s[side.other].p
        if (s.tiebreak) {
            // El saque pasa tras el 1.er punto y luego cada 2 puntos.
            if ((s.left.p + s.right.p) % 2 == 1) s = s.copy(server = s.server.other)
            if (closes(c, s, a, b)) s = closeSet(s, side, viaTie = true)
        } else if (closes(c, s, a, b)) {
            s = winGame(c, s, side)
        }
        return push(s)
    }

    private fun winGame(c: Config, s0: Snapshot, side: Side): Snapshot {
        var s = s0.with(side, s0[side].copy(g = s0[side].g + 1))
        s = s.copy(left = s.left.copy(p = 0), right = s.right.copy(p = 0), gameNum = s.gameNum + 1, server = s.server.other)
        if (endless(c)) return s
        val g = s[side].g
        val o = s[side.other].g
        return when {
            g >= 6 && g - o >= 2 -> closeSet(s, side, viaTie = false)
            s.left.g == 6 && s.right.g == 6 -> s.copy(tiebreak = true)
            else -> s
        }
    }

    private fun closeSet(s0: Snapshot, side: Side, viaTie: Boolean): Snapshot {
        var s = s0
        if (viaTie) s = s.with(side, s[side].copy(g = 7)).with(side.other, s[side.other].copy(g = 6))
        val history = s.setsHistory + SetScore(s.left.g, s.right.g)
        s = s.with(side, s[side].copy(s = s[side].s + 1))
        return s.copy(
            left = s.left.copy(g = 0, p = 0),
            right = s.right.copy(g = 0, p = 0),
            tiebreak = false,
            setsHistory = history,
        )
    }

    enum class Kind { s, g }

    /** Ajuste manual de sets/juegos (+/−) para corregir el marcador. null si no aplica. */
    fun adjust(c: Config, side: Side, kind: Kind, delta: Int): Match? {
        val cur = now[side]
        val next = (if (kind == Kind.s) cur.s else cur.g) + delta
        if (next < 0) return null
        var s = now.with(side, if (kind == Kind.s) cur.copy(s = next) else cur.copy(g = next))
        if (kind == Kind.g) s = s.copy(tiebreak = !endless(c) && s.left.g == 6 && s.right.g == 6)
        return push(s)
    }

    // Ajuste fino del punto (+/−): corrige el juego en curso sin deshacer jugadas. Nunca
    // cierra el juego ni el set —para eso está tocar el panel—, así que se rechaza el ajuste
    // que dejaría un juego ya ganado (y así el marcador sigue en 0/15/30/40/AD).
    fun canAdjustPoint(c: Config, side: Side, delta: Int): Boolean {
        val a = now[side].p + delta
        val b = now[side.other].p
        return a >= 0 && !closes(c, now, a, b) && !closes(c, now, b, a)
    }

    fun adjustPoint(c: Config, side: Side, delta: Int): Match? {
        if (!canAdjustPoint(c, side, delta)) return null
        return push(now.with(side, now[side].copy(p = now[side].p + delta)))
    }

    fun point(side: Side): PointText {
        val a = now[side].p
        val b = now[side.other].p
        if (now.tiebreak) return PointText(a.toString(), false)
        if (a >= 3 && b >= 3) {
            if (a == b) return PointText("40", false)
            return if (a > b) PointText("AD", true) else PointText("40", false)
        }
        return PointText(listOf("0", "15", "30", "40")[a], false)
    }

    /** Lado de la cancha desde el que se saca: alterna en cada punto. */
    val courtSide get() = if ((now.left.p + now.right.p) % 2 == 0) CourtSide.R else CourtSide.L

    /** Quién de la pareja saca: rota P1, P1, P2, P2… por juego. */
    val player get() = if ((now.gameNum / 2) % 2 == 0) "P1" else "P2"

    fun undo(): Match? = undo.lastOrNull()?.let { copy(now = it, undo = undo.dropLast(1)) }

    fun switchServer() = push(now.copy(server = now.server.other))

    /** Al cambiar los sets del partido: sin fin no hay tie-break; al volver, un 6-6 sí lo es. */
    fun reconfigured(c: Config) = copy(now = now.copy(tiebreak = !endless(c) && now.left.g == 6 && now.right.g == 6))

    /** ¿Mostrar la fila de sets? Sin sets que cerrar no dice nada, salvo que quede uno ganado. */
    fun showSets(c: Config) = !endless(c) || now.left.s > 0 || now.right.s > 0

    val hasProgress get() = now.left.s > 0 || now.right.s > 0 || now.left.g > 0 || now.right.g > 0 ||
        now.left.p > 0 || now.right.p > 0 || now.setsHistory.isNotEmpty()

    /** Los sets jugados, con el set en curso si ya empezó. */
    fun currentSets(): List<SetScore> {
        val s = now
        val started = s.left.g > 0 || s.right.g > 0 || s.left.p > 0 || s.right.p > 0
        return if (started) s.setsHistory + SetScore(s.left.g, s.right.g) else s.setsHistory
    }

    /** Partido nuevo con los mismos nombres (y el mismo partido del torneo, si lo hay). */
    fun reset() = Match(names = names, link = link)
}

enum class CourtSide { R, L }

/** Un resultado guardado: el mismo documento que guarda la PWA en `padel.results`. */
@Serializable
data class Result(
    val id: String,
    val date: Long,
    val left: String,
    val right: String,
    val sets: List<SetScore>,
    val setsLeft: Int,
    val setsRight: Int,
) {
    companion object {
        fun of(id: String, date: Long, left: String, right: String, sets: List<SetScore>) = Result(
            id, date, left, right, sets,
            setsLeft = sets.count { it.left > it.right },
            setsRight = sets.count { it.right > it.left },
        )
    }
}
