package com.dotrino.padel.tournament

import com.dotrino.padel.t
import com.dotrino.padel.tn
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.max

/**
 * Lo que hacen las pestañas del torneo, sin pantalla: el puerto de `src/tournament/view.js`
 * (que va delante, CONVENCIONES §16.1) sin el DOM. Las pantallas pintan lo que hay aquí y
 * llaman a estas funciones; `changed` les dice que repinten.
 */
class TournamentController(
    val repo: TournamentRepo,
    private val ui: Ui,
) {
    /** Lo que el controlador le pide a la pantalla. */
    interface Ui {
        fun changed()
        fun ask(title: String, text: String, ok: String, danger: Boolean = false, onYes: () -> Unit)
        fun toast(message: String, error: Boolean = false)
        fun goTab(tab: String)
    }

    /** El formulario de reglas. `source`: "set" (un set del usuario), "own" (las reglas propias
     *  del torneo, su set ya no existe) o "builtin" («Default», no se edita). */
    data class RuleForm(val source: String, val baseId: String?, val baseName: String, var name: String, val settings: Settings)

    var draft: Tournament? = null
        private set
    var openRule: String? = null
    var ruleForm: RuleForm? = null
        private set
    var historyPeriod = "today"
    private var probe: Tournament? = null

    fun current(): Tournament? = draft ?: repo.active()

    /** Abrir o cerrar una regla para editarla; una a la vez. */
    fun toggleRule(key: String) {
        openRule = if (openRule == key) null else key
        ui.changed()
    }

    /** El torneo contra el que se miden las reglas (canchas que caben, duración). Sin torneo,
     *  uno vacío con «Default»: las reglas se editan igual y guardarlas no toca ningún torneo. */
    fun rulesTour(): Tournament = current() ?: probe ?: run {
        val base = Engine.builtinRulesets()[0]
        Engine.createTournament(settings = base.settings, rulesetId = base.id).also { probe = it }
    }

    // ---------- nombres ----------

    fun playerName(tour: Tournament, pid: String) =
        tour.players.find { it.id == pid }?.name ?: throw IllegalStateException("unknown player $pid")

    fun sideName(tour: Tournament, ids: List<String>) = ids.joinToString(" / ") { playerName(tour, it) }

    fun unitName(tour: Tournament, id: String): String {
        if (!Engine.isFixed(tour)) return playerName(tour, id)
        val team = tour.teams.find { it.id == id } ?: throw IllegalStateException("unknown team $id")
        return sideName(tour, team.players)
    }

    fun formatDate(ts: Long): String = SimpleDateFormat("dd/MM", Locale.getDefault()).format(Date(ts))

    // ---------- resúmenes de reglas ----------

    fun scoringSummary(s: Settings) = Engine.SCORE_KINDS.filter { s.scoring[it].on }
        .joinToString(" · ") { t("pointsPer_$it", "n" to s.scoring[it].points) }

    fun matchEndSummary(s: Settings) = when (s.matchEnd) {
        "time" -> t("matchEndSummaryTime", "n" to s.matchMinutes)
        "games" -> if (s.gamesPerMatch > 0) tn("matchEndSummaryGames", s.gamesPerMatch) else t("matchEndSummaryFree")
        else -> throw IllegalStateException("unknown match end: ${s.matchEnd}")
    }

    private fun probeOf(tour: Tournament, s: Settings) = tour.copy(settings = s)

    /** Más canchas de las que llenan los jugadores: la regla va en rojo y se dice. "" si no. */
    fun courtsOver(tour: Tournament, s: Settings): String {
        if (s.courtsMode == "auto") return ""
        val p = probeOf(tour, s)
        val max = Engine.maxCourts(p)
        if (max < 1 || s.courts <= max) return ""
        return tn(if (Engine.isFixed(p)) "courtsOverTeams" else "courtsOverPlayers", max, "units" to Engine.activeUnits(p).size, "n" to max)
    }

    fun courtsSummary(tour: Tournament, s: Settings): String {
        if (s.courtsMode != "auto") return tn("courtsCount", s.courts)
        val p = probeOf(tour, s)
        val max = Engine.maxCourts(p)
        val base = t(if (Engine.isFixed(p)) "courtsAutoTeams" else "courtsAutoPlayers")
        return if (max >= 1) "$base · ${tn("courtsCount", max)}" else base
    }

    fun estimateText(tour: Tournament, s: Settings): String {
        val est = Engine.estimate(probeOf(tour, s)) ?: return ""
        val base = t(if (est.exact) "estimateExact" else "estimate", "matches" to est.matches, "rounds" to est.rounds)
        return base + if (s.matchEnd == "time") " · " + t("estimateMinutes", "n" to est.rounds * s.matchMinutes) else ""
    }

    fun limitSummary(tour: Tournament, s: Settings): String {
        if (s.limitType != "everyone") return "${s.limitValue} ${tn("unit_${s.limitType}", s.limitValue)}"
        val name = t("limitEveryone_${s.partners}")
        val each = Engine.everyoneMatchesEach(probeOf(tour, s))
        return if (each == null) name else "$name · $each ${tn("unit_perPlayer", each)}"
    }

    /** Las fichas de un set: (texto, en rojo). */
    fun rulesChips(tour: Tournament, s: Settings) = listOf(
        t("partnersSummary_${s.partners}") to false,
        t("pairingSummary_${s.pairing}") to false,
        courtsSummary(tour, s) to courtsOver(tour, s).isNotEmpty(),
        limitSummary(tour, s) to false,
        scoringSummary(s) to false,
        matchEndSummary(s) to false,
    )

    // ---------- sets de reglas ----------

    /** Los de la app primero y después los del usuario, en el orden en que se crearon. */
    fun rulesets(): List<Ruleset> = Engine.builtinRulesets() + repo.rulesets.sortedBy { it.createdAt }

    private fun formFrom(set: Ruleset?, settings: Settings): RuleForm {
        val source = when { set == null -> "own"; set.builtin -> "builtin"; else -> "set" }
        val name = set?.name ?: t("rulesetOwn")
        return RuleForm(source, set?.id, name, name, settings.deepCopy())
    }

    fun formFor(tour: Tournament): RuleForm {
        ruleForm?.let { return it }
        return formFrom(rulesets().find { it.id == tour.rulesetId }, tour.settings).also { ruleForm = it }
    }

    /** ¿El formulario está sobre este set? ("" = las reglas propias del torneo.) */
    fun editing(id: String): Boolean {
        val f = formFor(rulesTour())
        return if (id.isNotEmpty()) f.baseId == id else f.source == "own"
    }

    /** Los OTROS torneos que usan el set del formulario: con alguno, solo se guarda como nuevo. */
    fun usedByOthers(f: RuleForm): Int =
        if (f.source == "set") repo.list.count { it.rulesetId == f.baseId && it !== current() } else 0

    /** Cargar un set (o las reglas propias, "") en el formulario, sin tocar el torneo. */
    fun loadForm(id: String?) {
        if (id == null) { ruleForm = null; openRule = null; return }
        val set = if (id.isNotEmpty()) rulesets().find { it.id == id } ?: throw IllegalArgumentException("unknown ruleset $id") else null
        ruleForm = formFrom(set, set?.settings ?: rulesTour().settings)
        openRule = null
    }

    private fun copyName(base: String): String {
        fun taken(n: String) = rulesets().any { it.name.equals(n, ignoreCase = true) }
        var name = t("rulesetCopyName", "name" to base)
        var n = 2
        while (taken(name)) { name = t("rulesetCopyNameN", "name" to base, "n" to n); n++ }
        return name
    }

    private fun nameProblem(name: String, exceptId: String?): String? {
        if (name.isEmpty()) return "rulesetNeedsName"
        return if (rulesets().any { it.id != exceptId && it.name.equals(name, ignoreCase = true) }) "rulesetNameTaken" else null
    }

    private fun showNameProblem(key: String) {
        openRule = "rulesetName"
        ui.changed()
        ui.toast(t(key), error = true)
    }

    /** Pone unas reglas en el torneo; si cambian el tipo de parejas con rondas, pregunta. */
    private fun useRules(tour: Tournament, settings: Settings, rulesetId: String?, then: (Boolean) -> Unit) {
        if (!Engine.canApplyRules(tour, settings)) return then(false)
        fun go() {
            Engine.applyRules(tour, settings)
            tour.rulesetId = rulesetId
            then(true)
        }
        if (settings.partners != tour.settings.partners && tour.rounds.isNotEmpty()) {
            ui.ask(t("partnersChangeTitle"), t("partnersChangeText"), t("change")) { go() }
        } else go()
    }

    /** El borrador solo re-pinta; un torneo abierto se guarda. */
    private fun commit(tour: Tournament) {
        if (tour !== draft && tour !== probe) repo.save(tour)
        ui.changed()
    }

    /** Elegir un set para el torneo: sus reglas se copian a él. */
    fun selectRuleset(id: String) {
        val tour = current() ?: return
        val set = if (id.isNotEmpty()) rulesets().find { it.id == id } ?: throw IllegalArgumentException("unknown ruleset $id") else null
        if (set != null && set.id != tour.rulesetId) useRules(tour, set.settings, set.id) { commit(tour) } else commit(tour)
    }

    /** Guardar como set nuevo, y elegirlo para el torneo abierto si se puede. */
    fun saveRuleset(done: () -> Unit) {
        val f = ruleForm ?: return
        val tour = current()
        val typed = f.name.trim()
        val name = if (typed == f.baseName) copyName(f.baseName) else typed
        nameProblem(name, null)?.let { return showNameProblem(it) }
        val set = Ruleset(UUID.randomUUID().toString(), name, System.currentTimeMillis(), f.settings.deepCopy())
        repo.saveRuleset(set) { e ->
            if (e != null) return@saveRuleset ui.toast(t("saveFailed", "reason" to (e.message ?: e.toString())), error = true)
            ruleForm = formFrom(set, set.settings)
            openRule = null
            done()
            if (tour == null) {
                ui.changed()
                return@saveRuleset ui.toast(t("rulesetSavedOnly", "name" to name))
            }
            useRules(tour, set.settings, set.id) { chosen ->
                commit(tour)
                ui.toast(t(if (chosen) "rulesetSavedChosen" else "rulesetSaved", "name" to name))
            }
        }
    }

    /** Guardar los cambios en las reglas de las que partió el formulario. */
    fun updateRuleset(done: () -> Unit) {
        val f = ruleForm ?: return
        val tour = current()
        check(f.source != "builtin") { "the built-in rules cannot be changed" }
        check(usedByOthers(f) == 0) { "ruleset ${f.baseId} is used by other tournaments" }
        if (f.source == "own") {
            val t0 = tour ?: return
            if (!Engine.canApplyRules(t0, f.settings)) return ui.toast(t("rulesetBlocked"), error = true)
            return useRules(t0, f.settings, t0.rulesetId) { ok ->
                if (!ok) return@useRules
                openRule = null
                done()
                commit(t0)
                ui.toast(t("rulesetOwnUpdated"))
            }
        }
        val set = repo.rulesets.find { it.id == f.baseId } ?: throw IllegalStateException("unknown ruleset ${f.baseId}")
        val name = f.name.trim()
        nameProblem(name, set.id)?.let { return showNameProblem(it) }
        val next = set.copy(name = name, settings = f.settings.deepCopy())
        val inUse = tour?.rulesetId == set.id
        if (inUse && !Engine.canApplyRules(tour!!, next.settings)) return ui.toast(t("rulesetBlocked"), error = true)
        repo.saveRuleset(next) { e ->
            if (e != null) return@saveRuleset ui.toast(t("saveFailed", "reason" to (e.message ?: e.toString())), error = true)
            fun finish() {
                openRule = null
                done()
                if (tour != null) commit(tour) else ui.changed()
                ui.toast(t("rulesetUpdated", "name" to name))
            }
            if (inUse) useRules(tour!!, next.settings, next.id) { finish() } else finish()
        }
    }

    fun deleteRuleset(id: String) {
        val set = repo.rulesets.find { it.id == id } ?: throw IllegalArgumentException("unknown ruleset $id")
        ui.ask(t("rulesetDeleteTitle"), t("rulesetDeleteText", "name" to set.name), t("delete"), danger = true) {
            repo.removeRuleset(id) { e ->
                if (e != null) return@removeRuleset ui.toast(t("saveFailed", "reason" to (e.message ?: e.toString())), error = true)
                if (ruleForm?.baseId == id) ruleForm = null
                ui.changed()
            }
        }
    }

    // Las opciones de las reglas editan el FORMULARIO, nunca el torneo.
    fun setRule(name: String, value: String) {
        val s = formFor(rulesTour()).settings
        when (name) {
            "partners" -> s.partners = value
            "pairing" -> s.pairing = value
            "courtsMode" -> s.courtsMode = value
            "limitType" -> s.limitType = value
            "matchEnd" -> s.matchEnd = value
            else -> throw IllegalArgumentException("unknown rule $name")
        }
        ui.changed()
    }

    fun step(name: String, delta: Int) {
        val s = formFor(rulesTour()).settings
        fun clamp(v: Int, r: IntRange) = v.coerceIn(r)
        when (name) {
            "courts" -> s.courts = clamp(s.courts + delta, RANGES.getValue(name))
            "limitValue" -> s.limitValue = clamp(s.limitValue + delta, RANGES.getValue(name))
            "gamesPerMatch" -> s.gamesPerMatch = clamp(s.gamesPerMatch + delta, RANGES.getValue(name))
            "matchMinutes" -> s.matchMinutes = clamp(s.matchMinutes + delta, RANGES.getValue(name))
            else -> {
                check(name.startsWith("points-")) { "unknown step $name" }
                val k = s.scoring[name.removePrefix("points-")]
                k.points = clamp(k.points + delta, RANGES.getValue("points"))
            }
        }
        ui.changed()
    }

    fun toggleScoring(kind: String) {
        val s = formFor(rulesTour()).settings
        Engine.toggleScoring(s, kind, !s.scoring[kind].on)
        ui.changed()
    }

    // ---------- torneo ----------

    fun startDraft() {
        val base = Engine.builtinRulesets()[0]
        draft = Engine.createTournament(t("defaultTournamentName", "date" to formatDate(System.currentTimeMillis())), base.settings, base.id)
        openRule = null
        ruleForm = null
        ui.goTab("setup")
        ui.changed()
    }

    fun cancelDraft() { draft = null; ui.changed() }

    fun startTournament() {
        val tour = draft ?: return
        val r = Engine.generateRound(tour) ?: throw IllegalStateException("cannot start the tournament: ${Engine.nextRoundBlocker(tour)}")
        tour.rounds.add(r)
        draft = null
        repo.save(tour)
        repo.setActive(tour.id)
        ui.goTab("matches")
        ui.changed()
    }

    fun deleteTournament(tour: Tournament) {
        ui.ask(t("deleteTournamentTitle"), t("deleteTournamentText", "name" to tour.name), t("delete"), danger = true) {
            repo.remove(tour.id)
            ui.changed()
        }
    }

    fun open(id: String) {
        draft = null
        openRule = null
        ruleForm = null
        repo.setActive(id)
        ui.changed()
    }

    fun rename(name: String) {
        val tour = current() ?: return
        tour.name = name
        if (tour !== draft) repo.save(tour)
    }

    fun renamePlayer(pid: String, name: String) {
        val tour = current() ?: return
        if (name.isBlank()) return // vacío mientras se reescribe: se queda el nombre anterior
        tour.players.find { it.id == pid }?.name = name.trim()
        if (tour !== draft) repo.save(tour)
    }

    fun addPlayer(name: String) { val tour = current() ?: return; Engine.addPlayer(tour, name); commit(tour) }
    fun addTeam(a: String, b: String) { val tour = current() ?: return; Engine.addTeam(tour, a, b); commit(tour) }
    fun removePlayer(id: String) { val tour = current() ?: return; Engine.removePlayer(tour, id); commit(tour) }
    fun removeTeam(id: String) { val tour = current() ?: return; Engine.removeTeam(tour, id); commit(tour) }
    fun restore(id: String) { val tour = current() ?: return; Engine.restoreUnit(tour, id); commit(tour) }

    fun history(): List<Tournament> {
        val since = Engine.periodStart(historyPeriod) ?: Long.MIN_VALUE
        return repo.list.filter { it.createdAt >= since }.sortedByDescending { it.createdAt }
    }

    // ---------- partidos ----------

    private val correctionNoted = HashSet<String>()

    /** Un resultado escrito; true si corrige una ronda con otras detrás (se avisa una vez). */
    fun setScore(tour: Tournament, matchId: String, kind: String, a: Int?, b: Int?) {
        if (kind == "sets") Engine.setSets(tour, matchId, a, b) else Engine.setScore(tour, matchId, a, b)
        repo.save(tour)
        val index = tour.rounds.indexOfFirst { r -> r.matches.any { it.id == matchId } }
        if (index < tour.rounds.size - 1 && correctionNoted.add(tour.id)) ui.toast(t("correctionNote"))
    }

    fun nextRound(tour: Tournament) {
        val r = Engine.generateRound(tour) ?: throw IllegalStateException("no round to generate: ${Engine.nextRoundBlocker(tour)}")
        tour.rounds.add(r)
        commit(tour)
    }

    fun redo(tour: Tournament) { Engine.redoLastRound(tour); commit(tour) }
    fun drop(tour: Tournament) { Engine.removeLastRound(tour); commit(tour) }

    fun clock(tour: Tournament, roundId: String, action: String) {
        val now = System.currentTimeMillis()
        when (action) {
            "start" -> Engine.startClock(tour, roundId, now)
            "pause" -> Engine.pauseClock(tour, roundId, now)
            "resume" -> Engine.resumeClock(tour, roundId, now)
            "reset" -> {
                if (Engine.clockOf(tour, Engine.findRound(tour, roundId), now).state == "running") {
                    return ui.ask(t("clockResetTitle"), t("clockResetText"), t("clockResetOk"), danger = true) {
                        Engine.resetClock(tour, roundId); commit(tour)
                    }
                }
                Engine.resetClock(tour, roundId)
            }
            else -> throw IllegalArgumentException("unknown clock action $action")
        }
        commit(tour)
    }

    /** Guardar el resultado de un partido jugado en el marcador. false si ya no existe. */
    fun saveLinkedResult(tournamentId: String, matchId: String, games: Pair<Int, Int>, sets: Pair<Int, Int>?): Boolean {
        if (repo.status != "ready") { ui.toast(t("storeNotReady"), error = true); return false }
        val tour = repo.list.find { it.id == tournamentId }
        if (tour == null || Engine.findMatch(tour, matchId) == null) { ui.toast(t("linkedGone"), error = true); return false }
        Engine.setScore(tour, matchId, games.first, games.second)
        if (sets != null) Engine.setSets(tour, matchId, sets.first, sets.second)
        repo.save(tour)
        return true
    }

    /** El cronómetro del partido que está en el marcador, o null. */
    fun clockForLink(tournamentId: String, roundId: String, now: Long): ClockState? {
        if (repo.status != "ready") return null
        val tour = repo.list.find { it.id == tournamentId } ?: return null
        val round = tour.rounds.find { it.id == roundId } ?: return null
        return Engine.clockOf(tour, round, now)
    }

    companion object {
        val RANGES = mapOf("courts" to 1..20, "limitValue" to 1..99, "gamesPerMatch" to 0..20, "matchMinutes" to 5..120, "points" to 1..10)
        fun remaining(ms: Long) = Engine.formatClock(max(0, ms))
    }
}
