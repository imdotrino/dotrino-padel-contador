package com.dotrino.padel.tournament

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * La lógica del torneo: el puerto de `src/tournament/engine.js` de la PWA, que va delante
 * (CONVENCIONES §16.1). Con la misma semilla arma EXACTAMENTE las mismas rondas: lo comprueban
 * los casos de oro que genera `test/vectors/gen.mjs` desde el JS (EngineVectorsTest). Por eso
 * se respeta el orden de todo lo que el azar recorre (listas, conjuntos que conservan el orden
 * de inserción, ordenaciones estables): cambiarlo cambia las rondas.
 *
 * Los comentarios de cada regla están en el JS; aquí solo lo que es propio del puerto.
 */
object Engine {
    const val MIN_PLAYERS = 4
    const val MIN_TEAMS = 3
    private val PARTNERS = listOf("rotating", "fixed")
    private val PAIRINGS = listOf("random", "ranked")
    private val LIMITS = listOf("perPlayer", "rounds", "matches", "everyone")
    private val MATCH_ENDS = listOf("time", "games")
    private val COURTS_MODES = listOf("auto", "fixed")
    val SCORE_KINDS = listOf("games", "sets", "match")
    val HISTORY_PERIODS = listOf("all", "month", "week", "today")
    private const val MINUTE = 60000L
    private const val PARTNER_WEIGHT = 100
    private const val RESTARTS = 24
    private const val PLAN_BUDGET = 60000
    private const val PLAN_EXTRA_ROUNDS = 2

    /** De dónde salen los ids. Las pruebas lo cambian por un contador. */
    var newId: () -> String = { UUID.randomUUID().toString() }

    /** El azar de la app; las pruebas pasan uno con semilla. */
    val random: () -> Double = { Math.random() }

    fun defaultSettings() = Settings()

    fun builtinRulesets() = listOf(Ruleset(id = "builtin-default", name = "Default", settings = defaultSettings(), builtin = true))

    private fun key(x: String, y: String) = if (x < y) "$x|$y" else "$y|$x"
    private fun MutableMap<String, Int>.bump(k: String) { this[k] = (this[k] ?: 0) + 1 }
    private fun Map<String, Int>.count(k: String) = this[k] ?: 0

    fun checkSettings(s: Settings) {
        require(s.partners in PARTNERS) { "unknown partners mode: ${s.partners}" }
        require(s.pairing in PAIRINGS) { "unknown pairing mode: ${s.pairing}" }
        require(s.limitType in LIMITS) { "unknown limit type: ${s.limitType}" }
        require(s.courtsMode in COURTS_MODES) { "unknown courts mode: ${s.courtsMode}" }
        require(s.courts >= 1) { "invalid courts: ${s.courts}" }
        require(s.limitValue >= 1) { "invalid limit: ${s.limitValue}" }
        for (k in SCORE_KINDS) require(s.scoring[k].points >= 1) { "invalid scoring.$k: ${s.scoring[k]}" }
        require(SCORE_KINDS.any { s.scoring[it].on }) { "scoring needs at least one kind turned on" }
        require(s.matchEnd in MATCH_ENDS) { "unknown match end: ${s.matchEnd}" }
        require(s.matchMinutes >= 1) { "invalid match minutes: ${s.matchMinutes}" }
        require(s.gamesPerMatch >= 0) { "invalid games per match: ${s.gamesPerMatch}" }
        val conflicts = settingsConflicts(s)
        require(conflicts.isEmpty()) { "conflicting rules: ${conflicts.joinToString(", ")}" }
    }

    fun settingsConflicts(s: Settings) =
        if (s.pairing == "ranked" && s.limitType == "everyone") listOf("pairing", "limit") else emptyList()

    /** Desde cuándo cuenta un periodo de «Mis torneos», en la hora local. null = desde siempre. */
    fun periodStart(period: String, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): Long? {
        if (period == "all") return null
        val day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val start = when (period) {
            "today" -> day
            "week" -> day.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            "month" -> day.withDayOfMonth(1)
            else -> throw IllegalArgumentException("unknown period: $period")
        }
        return start.atStartOfDay(zone).toInstant().toEpochMilli()
    }

    // ---------- construcción ----------

    fun createTournament(name: String = "", settings: Settings = defaultSettings(), rulesetId: String? = null, now: Long = System.currentTimeMillis()) =
        Tournament(newId(), name, now, now, rulesetId, settings.deepCopy(), mutableListOf(), mutableListOf(), mutableListOf())

    fun addPlayer(t: Tournament, name: String): Player {
        val p = Player(newId(), name, true)
        t.players.add(p)
        return p
    }

    fun addTeam(t: Tournament, nameA: String, nameB: String): Team {
        val a = addPlayer(t, nameA)
        val b = addPlayer(t, nameB)
        val team = Team(newId(), listOf(a.id, b.id), true)
        t.teams.add(team)
        return team
    }

    // ---------- consultas ----------

    fun isFixed(t: Tournament) = t.settings.partners == "fixed"
    private fun slotsPerMatch(t: Tournament) = if (isFixed(t)) 2 else 4
    fun minUnits(t: Tournament) = if (isFixed(t)) MIN_TEAMS else MIN_PLAYERS

    fun activeUnits(t: Tournament): List<String> =
        if (isFixed(t)) t.teams.filter { it.active }.map { it.id } else t.players.filter { it.active }.map { it.id }

    fun maxCourts(t: Tournament) = activeUnits(t).size / slotsPerMatch(t)
    private fun courtsFor(t: Tournament) = if (t.settings.courtsMode == "auto") maxCourts(t) else min(t.settings.courts, maxCourts(t))
    fun courtsInUse(t: Tournament) = max(1, courtsFor(t))

    fun hasScore(m: TMatch) = m.score?.a != null && m.score?.b != null
    fun hasSets(m: TMatch) = m.sets?.a != null && m.sets?.b != null

    /** "a", "b", "draw", o null sin resultado de juegos. */
    fun outcome(m: TMatch): String? {
        if (!hasScore(m)) return null
        val sets = m.sets
        val (x, y) = if (hasSets(m) && sets!!.a != sets.b) sets.a!! to sets.b!! else m.score!!.a!! to m.score!!.b!!
        return if (x == y) "draw" else if (x > y) "a" else "b"
    }

    fun hasResults(t: Tournament) = t.rounds.any { r -> r.matches.any { hasScore(it) } }
    fun countMatches(t: Tournament) = t.rounds.sumOf { it.matches.size }
    fun findMatch(t: Tournament, matchId: String): TMatch? = t.rounds.firstNotNullOfOrNull { r -> r.matches.find { it.id == matchId } }
    private fun playerScheduled(t: Tournament, pid: String) = t.rounds.any { r -> r.matches.any { pid in it.a || pid in it.b } }
    private fun teamScheduled(t: Tournament, tid: String) = t.rounds.any { r -> r.matches.any { it.teams?.contains(tid) == true } }

    private fun unitSides(m: TMatch, fixed: Boolean): Pair<List<String>, List<String>> {
        if (!fixed) return m.a to m.b
        val teams = m.teams ?: throw IllegalStateException("match ${m.id} has no teams but the tournament uses fixed pairs")
        return listOf(teams[0]) to listOf(teams[1])
    }

    private class History {
        val appearances = HashMap<String, Int>()
        val rests = HashMap<String, Int>()
        val lastPlayed = HashMap<String, Int>()
        val partners = HashMap<String, Int>()
        val opponents = HashMap<String, Int>()
    }

    private fun history(t: Tournament): History {
        val fixed = isFixed(t)
        val h = History()
        t.rounds.forEachIndexed { ri, r ->
            for (u in r.rest) h.rests.bump(u)
            for (m in r.matches) {
                val (sa, sb) = unitSides(m, fixed)
                for (u in sa + sb) {
                    h.appearances.bump(u)
                    h.lastPlayed[u] = ri
                }
                h.partners.bump(key(m.a[0], m.a[1]))
                h.partners.bump(key(m.b[0], m.b[1]))
                for (x in sa) for (y in sb) h.opponents.bump(key(x, y))
            }
        }
        return h
    }

    private fun limitReached(t: Tournament, h: History = history(t)): Boolean {
        val s = t.settings
        return when (s.limitType) {
            "rounds" -> t.rounds.size >= s.limitValue
            "matches" -> countMatches(t) >= s.limitValue
            "perPlayer" -> {
                val units = activeUnits(t)
                units.isNotEmpty() && units.all { h.appearances.count(it) >= s.limitValue }
            }
            "everyone" -> pendingPairs(t, h).isEmpty()
            else -> throw IllegalStateException("unknown limit type: ${s.limitType}")
        }
    }

    private fun pendingPairs(t: Tournament, h: History): List<Pair<String, String>> {
        val units = activeUnits(t)
        val met = if (isFixed(t)) h.opponents else h.partners
        val out = mutableListOf<Pair<String, String>>()
        for (i in units.indices) for (j in i + 1 until units.size) {
            if (met.count(key(units[i], units[j])) == 0) out.add(units[i] to units[j])
        }
        return out
    }

    fun everyoneMatchesEach(t: Tournament): Int? = activeUnits(t).size.let { if (it >= 2) it - 1 else null }

    /** "players", "finished" o null si se puede armar otra ronda. */
    fun nextRoundBlocker(t: Tournament): String? = when {
        activeUnits(t).size < minUnits(t) -> "players"
        limitReached(t) -> "finished"
        else -> null
    }

    fun status(t: Tournament): Status {
        val scheduled = countMatches(t)
        val scored = t.rounds.sumOf { r -> r.matches.count { hasScore(it) } }
        val reached = limitReached(t)
        return Status(scheduled, scored, reached, reached && scheduled > 0 && scored == scheduled)
    }

    fun estimate(t: Tournament): Estimate? {
        val units = activeUnits(t)
        val slots = slotsPerMatch(t)
        val courts = courtsFor(t)
        if (courts < 1) return null
        val s = t.settings
        val done = countMatches(t)
        val doneRounds = t.rounds.size
        if (s.limitType == "rounds") {
            val left = max(0, s.limitValue - doneRounds)
            return Estimate(done + left * courts, doneRounds + left, true)
        }
        val left = when (s.limitType) {
            "matches" -> max(0, s.limitValue - done)
            "everyone" -> ceil(pendingPairs(t, history(t)).size.toDouble() / (if (isFixed(t)) 1 else 2)).toInt()
            else -> {
                val h = history(t)
                val deficit = units.sumOf { max(0, s.limitValue - h.appearances.count(it)) }
                ceil(deficit.toDouble() / slots).toInt()
            }
        }
        return Estimate(done + left, doneRounds + ceil(left.toDouble() / courts).toInt(), s.limitType == "matches")
    }

    // ---------- clasificación ----------

    fun standings(t: Tournament): List<Standing> {
        checkSettings(t.settings)
        val fixed = isFixed(t)
        val rows = LinkedHashMap<String, Standing>()
        if (fixed) for (u in t.teams) rows[u.id] = Standing(u.id, u.active) else for (u in t.players) rows[u.id] = Standing(u.id, u.active)
        fun tally(side: List<String>, result: String, games: Pair<Int, Int>, sets: Pair<Int, Int>) {
            for (u in side) {
                val row = rows[u] ?: throw IllegalStateException("match references unknown unit $u")
                row.played++
                row.gamesFor += games.first
                row.gamesAgainst += games.second
                row.setsFor += sets.first
                row.setsAgainst += sets.second
                when (result) { "won" -> row.won++; "lost" -> row.lost++; else -> row.drawn++ }
            }
        }
        for (r in t.rounds) for (m in r.matches) {
            if (!hasScore(m)) continue
            val (sa, sb) = unitSides(m, fixed)
            val o = outcome(m)
            val sets = if (hasSets(m)) m.sets!!.a!! to m.sets!!.b!! else 0 to 0
            val score = m.score!!.a!! to m.score!!.b!!
            tally(sa, if (o == "a") "won" else if (o == "b") "lost" else "drawn", score, sets)
            tally(sb, if (o == "b") "won" else if (o == "a") "lost" else "drawn", score.second to score.first, sets.second to sets.first)
        }
        val sc = t.settings.scoring
        for (row in rows.values) {
            row.points = (if (sc.games.on) row.gamesFor * sc.games.points else 0) +
                (if (sc.sets.on) row.setsFor * sc.sets.points else 0) +
                (if (sc.match.on) row.won * sc.match.points else 0)
        }
        fun setDiff(x: Standing) = x.setsFor - x.setsAgainst
        fun gameDiff(x: Standing) = x.gamesFor - x.gamesAgainst
        // sortedWith es estable, como Array.prototype.sort.
        return rows.values.sortedWith { x, y ->
            (y.points - x.points).takeIf { it != 0 } ?: (y.won - x.won).takeIf { it != 0 }
                ?: (setDiff(y) - setDiff(x)).takeIf { it != 0 } ?: (gameDiff(y) - gameDiff(x)).takeIf { it != 0 }
                ?: (y.gamesFor - x.gamesFor)
        }
    }

    // ---------- generación de rondas ----------

    private fun <T> shuffle(items: List<T>, rng: () -> Double): MutableList<T> {
        val a = items.toMutableList()
        for (i in a.size - 1 downTo 1) {
            val j = floor(rng() * (i + 1)).toInt()
            val x = a[i]; a[i] = a[j]; a[j] = x
        }
        return a
    }

    private fun <T> MutableList<T>.swap(i: Int, j: Int) { val x = this[i]; this[i] = this[j]; this[j] = x }

    private fun rotatingCost(arr: List<String>, h: History): Int {
        var c = 0
        var i = 0
        while (i < arr.size) {
            val (p0, p1, p2, p3) = arr.subList(i, i + 4)
            val pa = h.partners.count(key(p0, p1))
            val pb = h.partners.count(key(p2, p3))
            c += PARTNER_WEIGHT * (pa * pa + pb * pb)
            for ((x, y) in listOf(p0 to p2, p0 to p3, p1 to p2, p1 to p3)) {
                val o = h.opponents.count(key(x, y))
                c += o * o
            }
            i += 4
        }
        return c
    }

    private fun teamCost(arr: List<String>, h: History): Int {
        var c = 0
        var i = 0
        while (i < arr.size) {
            val o = h.opponents.count(key(arr[i], arr[i + 1]))
            c += o * o
            i += 2
        }
        return c
    }

    private fun <T> bestArrangement(items: List<T>, cost: (List<T>) -> Int, rng: () -> Double): List<T> {
        var best: List<T>? = null
        var bestCost = Int.MAX_VALUE
        var r = 0
        while (r < RESTARTS && bestCost > 0) {
            val arr = shuffle(items, rng)
            var c = cost(arr)
            var improved = true
            while (improved && c > 0) {
                improved = false
                for (i in arr.indices) for (j in i + 1 until arr.size) {
                    arr.swap(i, j)
                    val nc = cost(arr)
                    if (nc < c) { c = nc; improved = true } else arr.swap(i, j)
                }
            }
            if (c < bestCost) { best = arr.toList(); bestCost = c }
            r++
        }
        return best!!
    }

    private fun byStanding(t: Tournament, ids: List<String>): MutableList<String> {
        val rank = HashMap<String, Int>()
        standings(t).forEachIndexed { i, row -> rank[row.id] = i }
        return ids.sortedWith { x, y -> rank.getValue(x) - rank.getValue(y) }.toMutableList()
    }

    private fun rankedPlayers(t: Tournament, playing: List<String>, h: History): List<String> {
        val order = byStanding(t, playing)
        val out = mutableListOf<String>()
        var i = 0
        while (i < order.size) {
            val (p1, p2, p3, p4) = order.subList(i, i + 4)
            val options = listOf(listOf(p1, p4, p2, p3), listOf(p1, p3, p2, p4), listOf(p1, p2, p3, p4))
            var best = options[0]
            var bestCost = Int.MAX_VALUE
            for (o in options) {
                val c = h.partners.count(key(o[0], o[1])) + h.partners.count(key(o[2], o[3]))
                if (c < bestCost) { best = o; bestCost = c }
            }
            out.addAll(best)
            i += 4
        }
        return out
    }

    private fun rankedTeams(t: Tournament, playing: List<String>, h: History): List<String> {
        val order = byStanding(t, playing)
        var i = 0
        while (i + 3 < order.size) {
            if (h.opponents.count(key(order[i], order[i + 1])) > h.opponents.count(key(order[i], order[i + 2]))) order.swap(i + 1, i + 2)
            i += 2
        }
        return order
    }

    private data class Group(val a: List<String>, val b: List<String>, val teams: List<String>?)

    private fun team(t: Tournament, id: String) = t.teams.find { it.id == id } ?: throw IllegalStateException("unknown team $id")

    fun generateRound(t: Tournament, rng: () -> Double = random): Round? {
        checkSettings(t.settings)
        if (nextRoundBlocker(t) != null) return null
        val h = history(t)
        if (t.settings.limitType == "everyone") return everyoneRound(t, h, rng)
        val units = activeUnits(t)
        val slots = slotsPerMatch(t)
        val courts = courtsInUse(t)
        val s = t.settings
        var size = courts
        if (s.limitType == "matches") size = min(courts, s.limitValue - countMatches(t))
        if (s.limitType == "perPlayer") {
            val short = units.count { h.appearances.count(it) < s.limitValue }
            size = min(courts, ceil(short.toDouble() / slots).toInt())
        }
        val order = shuffle(units, rng)
        order.sortWith { x, y ->
            (h.appearances.count(x) - h.appearances.count(y)).takeIf { it != 0 }
                ?: (h.rests.count(y) - h.rests.count(x)).takeIf { it != 0 }
                ?: ((h.lastPlayed[x] ?: -1) - (h.lastPlayed[y] ?: -1))
        }
        val playing = order.subList(0, size * slots).toList()
        val rest = order.subList(size * slots, order.size).toList()
        val ranked = s.pairing == "ranked" && hasResults(t)
        val groups = mutableListOf<Group>()
        if (isFixed(t)) {
            val arr = if (ranked) rankedTeams(t, playing, h) else bestArrangement(playing, { teamCost(it, h) }, rng)
            var i = 0
            while (i < arr.size) {
                groups.add(Group(team(t, arr[i]).players.toList(), team(t, arr[i + 1]).players.toList(), listOf(arr[i], arr[i + 1])))
                i += 2
            }
        } else {
            val arr = if (ranked) rankedPlayers(t, playing, h) else bestArrangement(playing, { rotatingCost(it, h) }, rng)
            var i = 0
            while (i < arr.size) {
                groups.add(Group(listOf(arr[i], arr[i + 1]), listOf(arr[i + 2], arr[i + 3]), null))
                i += 4
            }
        }
        return makeRound(groups, rest)
    }

    private fun makeRound(groups: List<Group>, rest: List<String>): Round {
        val id = newId()
        val matches = groups.mapIndexed { i, g -> TMatch(newId(), i + 1, g.a, g.b, g.teams, null, null) }
        return Round(id, matches, rest, null)
    }

    // ---------- todos contra todos / con todos ----------

    private fun planFirstRound(units: List<String>, pending: List<Pair<String, String>>, cap: Int, rng: () -> Double): List<Pair<String, String>> {
        // LinkedHashSet: conserva el orden de inserción, como el Set de JS (y quitar y volver a
        // poner un elemento lo manda al final, igual que allí).
        val adj = LinkedHashMap<String, LinkedHashSet<String>>()
        for (u in units) adj[u] = LinkedHashSet()
        for ((x, y) in pending) { adj.getValue(x).add(y); adj.getValue(y).add(x) }
        fun degree(u: String) = adj.getValue(u).size
        var edgesLeft = pending.size
        var budget = PLAN_BUDGET

        fun fill(rounds: Int, used: MutableSet<String>, chosen: MutableList<Pair<String, String>>): List<Pair<String, String>>? {
            if (--budget < 0) return null
            fun free(u: String) = u !in used
            if (units.any { free(it) && degree(it) > rounds }) return null
            val mustPlay = units.filter { free(it) && degree(it) == rounds }
            val open = units.filter { u -> free(u) && adj.getValue(u).any { free(it) } }
            if (chosen.size == cap || open.isEmpty()) {
                if (mustPlay.isNotEmpty()) return null
                if (edgesLeft == 0) return chosen.toList()
                if (rounds == 1 || edgesLeft > (rounds - 1) * cap) return null
                return if (fill(rounds - 1, HashSet(), mutableListOf()) != null) chosen.toList() else null
            }
            val v = shuffle(if (mustPlay.isNotEmpty()) mustPlay else open, rng).reduce { a, b -> if (degree(b) > degree(a)) b else a }
            val partners = shuffle(adj.getValue(v).filter { free(it) }, rng)
            partners.sortWith { a, b -> degree(b) - degree(a) }
            for (w in partners) {
                adj.getValue(v).remove(w); adj.getValue(w).remove(v); edgesLeft--
                used.add(v); used.add(w); chosen.add(v to w)
                val res = fill(rounds, used, chosen)
                chosen.removeAt(chosen.size - 1); used.remove(v); used.remove(w)
                adj.getValue(v).add(w); adj.getValue(w).add(v); edgesLeft++
                if (res != null) return res
                if (budget < 0) return null
            }
            if (degree(v) == rounds) return null
            used.add(v)
            val res = fill(rounds, used, chosen)
            used.remove(v)
            return res
        }

        val lower = max(ceil(pending.size.toDouble() / cap).toInt(), units.maxOfOrNull { degree(it) } ?: Int.MIN_VALUE)
        var rounds = lower
        while (rounds <= lower + PLAN_EXTRA_ROUNDS && budget > 0) {
            val first = fill(rounds, HashSet(), mutableListOf())
            if (first != null) return first
            rounds++
        }
        return greedyPairs(units, adj, cap, rng)
    }

    private fun greedyPairs(units: List<String>, adj: Map<String, Set<String>>, cap: Int, rng: () -> Double): List<Pair<String, String>> {
        val used = HashSet<String>()
        val out = mutableListOf<Pair<String, String>>()
        fun degree(u: String) = adj.getValue(u).size
        fun most(list: List<String>) = list.reduce { a, b -> if (degree(b) > degree(a)) b else a }
        while (out.size < cap) {
            val open = shuffle(units.filter { u -> u !in used && adj.getValue(u).any { it !in used } }, rng)
            if (open.isEmpty()) break
            val v = most(open)
            val w = most(shuffle(adj.getValue(v).filter { it !in used }, rng))
            used.add(v); used.add(w); out.add(v to w)
        }
        return out
    }

    private fun opponentCost(arr: List<List<String>>, h: History): Int {
        var c = 0
        var i = 0
        while (i < arr.size) {
            for (x in arr[i]) for (y in arr[i + 1]) {
                val o = h.opponents.count(key(x, y))
                c += o * o
            }
            i += 2
        }
        return c
    }

    private fun everyoneRound(t: Tournament, h: History, rng: () -> Double): Round {
        val units = activeUnits(t)
        val fixed = isFixed(t)
        val courts = courtsInUse(t)
        val pairs = planFirstRound(units, pendingPairs(t, h), if (fixed) courts else courts * 2, rng)
        val groups: List<Group>
        if (fixed) {
            groups = pairs.map { (x, y) -> Group(team(t, x).players.toList(), team(t, y).players.toList(), listOf(x, y)) }
        } else {
            val teams = pairs.map { listOf(it.first, it.second) }.toMutableList()
            if (teams.size % 2 == 1) {
                val used = teams.flatten().toSet()
                val free = shuffle(units.filter { it !in used }, rng)
                free.sortWith { x, y -> h.appearances.count(x) - h.appearances.count(y) }
                if (free.size < 2) throw IllegalStateException("no players left to complete the last match")
                val f1 = free[0]
                val f2 = free.drop(1).reduce { a, b -> if (h.partners.count(key(f1, b)) < h.partners.count(key(f1, a))) b else a }
                teams.add(listOf(f1, f2))
            }
            val arr = bestArrangement(teams, { opponentCost(it, h) }, rng)
            val g = mutableListOf<Group>()
            var i = 0
            while (i < arr.size) { g.add(Group(arr[i], arr[i + 1], null)); i += 2 }
            groups = g
        }
        val playing = groups.flatMap { if (fixed) it.teams!! else it.a + it.b }.toSet()
        return makeRound(shuffle(groups, rng), units.filter { it !in playing })
    }

    // ---------- ediciones ----------

    fun setScore(t: Tournament, matchId: String, a: Int?, b: Int?) {
        val m = findMatch(t, matchId) ?: throw IllegalArgumentException("unknown match $matchId")
        m.score = if (a == null && b == null) null else Score(a, b)
    }

    fun setSets(t: Tournament, matchId: String, a: Int?, b: Int?) {
        val m = findMatch(t, matchId) ?: throw IllegalArgumentException("unknown match $matchId")
        m.sets = if (a == null && b == null) null else Score(a, b)
    }

    fun toggleScoring(s: Settings, kind: String, on: Boolean) {
        require(kind in SCORE_KINDS) { "unknown scoring kind: $kind" }
        check(on || !SCORE_KINDS.all { it == kind || !s.scoring[it].on }) { "at least one scoring kind must stay on" }
        s.scoring[kind].on = on
    }

    private fun lastRoundScored(t: Tournament) = t.rounds.isNotEmpty() && t.rounds.last().matches.any { it.score != null || it.sets != null }
    fun canRedoLastRound(t: Tournament) = t.rounds.isNotEmpty() && !lastRoundScored(t)

    fun redoLastRound(t: Tournament, rng: () -> Double = random): Round? {
        check(canRedoLastRound(t)) { "the last round already has results" }
        t.rounds.removeAt(t.rounds.size - 1)
        val r = generateRound(t, rng)
        if (r != null) t.rounds.add(r)
        return r
    }

    fun removeLastRound(t: Tournament) {
        check(canRedoLastRound(t)) { "the last round already has results" }
        t.rounds.removeAt(t.rounds.size - 1)
    }

    fun setPartners(t: Tournament, mode: String, rng: () -> Double = random) {
        require(mode in PARTNERS) { "unknown partners mode: $mode" }
        check(!hasResults(t)) { "partners mode is locked once there are results" }
        t.settings.partners = mode
        if (mode == "fixed" && t.teams.none { it.active }) {
            val free = t.players.filter { it.active }
            var i = 0
            while (i + 1 < free.size) {
                t.teams.add(Team(newId(), listOf(free[i].id, free[i + 1].id), true))
                i += 2
            }
        }
        val had = t.rounds.isNotEmpty()
        t.rounds.clear()
        if (had) generateRound(t, rng)?.let { t.rounds.add(it) }
    }

    fun canApplyRules(t: Tournament, s: Settings) = s.partners == t.settings.partners || !hasResults(t)

    fun applyRules(t: Tournament, settings: Settings, rng: () -> Double = random) {
        checkSettings(settings)
        check(canApplyRules(t, settings)) { "partners mode is locked once there are results" }
        val next = settings.deepCopy()
        val partners = next.partners
        next.partners = t.settings.partners
        t.settings = next
        if (partners != t.settings.partners) setPartners(t, partners, rng)
    }

    /** "retired" si ya jugó (sigue en la tabla), "deleted" si no. */
    fun removePlayer(t: Tournament, pid: String): String {
        val p = t.players.find { it.id == pid } ?: throw IllegalArgumentException("unknown player $pid")
        if (playerScheduled(t, pid)) { p.active = false; return "retired" }
        t.players = t.players.filter { it.id != pid }.toMutableList()
        t.teams = t.teams.filter { pid !in it.players }.toMutableList()
        return "deleted"
    }

    fun removeTeam(t: Tournament, tid: String): String {
        val team = t.teams.find { it.id == tid } ?: throw IllegalArgumentException("unknown team $tid")
        if (teamScheduled(t, tid)) { team.active = false; return "retired" }
        t.teams = t.teams.filter { it.id != tid }.toMutableList()
        t.players = t.players.filter { it.id !in team.players || playerScheduled(t, it.id) }.toMutableList()
        return "deleted"
    }

    fun restoreUnit(t: Tournament, id: String) {
        t.players.find { it.id == id }?.let { it.active = true; return }
        t.teams.find { it.id == id }?.let { it.active = true; return }
        throw IllegalArgumentException("unknown unit $id")
    }

    // ---------- cronómetro de la ronda ----------

    fun findRound(t: Tournament, roundId: String) = t.rounds.find { it.id == roundId } ?: throw IllegalArgumentException("unknown round $roundId")

    fun clockOf(t: Tournament, round: Round, now: Long): ClockState {
        val c = round.clock ?: return ClockState("idle", t.settings.matchMinutes * MINUTE, t.settings.matchMinutes)
        val elapsed = c.elapsedMs + (c.runningSince?.let { now - it } ?: 0)
        val remaining = max(0, c.minutes * MINUTE - elapsed)
        val state = if (remaining == 0L) "done" else if (c.runningSince == null) "paused" else "running"
        return ClockState(state, remaining, c.minutes)
    }

    fun startClock(t: Tournament, roundId: String, now: Long) {
        check(t.settings.matchEnd == "time") { "this tournament does not play on time" }
        val r = findRound(t, roundId)
        check(r.clock == null) { "the clock of round $roundId already started" }
        r.clock = Clock(t.settings.matchMinutes, now, 0)
    }

    fun pauseClock(t: Tournament, roundId: String, now: Long) {
        val r = findRound(t, roundId)
        check(clockOf(t, r, now).state == "running") { "the clock of round $roundId is not running" }
        val c = r.clock!!
        c.elapsedMs += now - c.runningSince!!
        c.runningSince = null
    }

    fun resumeClock(t: Tournament, roundId: String, now: Long) {
        val r = findRound(t, roundId)
        check(clockOf(t, r, now).state == "paused") { "the clock of round $roundId is not paused" }
        r.clock!!.runningSince = now
    }

    fun resetClock(t: Tournament, roundId: String) { findRound(t, roundId).clock = null }

    /** m:ss, redondeando hacia arriba: marca 0:00 solo cuando de verdad se acabó. */
    fun formatClock(ms: Long): String {
        val s = ceil(ms / 1000.0).toLong()
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}
