package com.dotrino.padel.tournament

import android.app.Activity
import android.graphics.Typeface
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.dotrino.padel.R
import com.dotrino.padel.button
import com.dotrino.padel.col
import com.dotrino.padel.label
import com.dotrino.padel.px
import com.dotrino.padel.rounded
import com.dotrino.padel.segmented
import com.dotrino.padel.t
import com.dotrino.padel.tn

// Las pestañas del torneo (Torneo, Reglas, Tabla y Partidos), el puerto de las páginas de
// src/tournament/view.js. Cada función pinta su pestaña ENTERA en `into`: la pantalla la
// vuelve a llamar cuando algo cambia (TournamentController.Ui.changed).

private fun Activity.heading(text: String) = label(text, 22f, col(R.color.padel_text), bold = true).apply { setPadding(0, 0, 0, px(4)) }

private fun Activity.notice(text: String, error: Boolean = false, action: Pair<String, () -> Unit>? = null) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(px(14), px(12), px(14), px(12))
    background = rounded(col(R.color.padel_surface), px(12), px(1), if (error) 0xFFF87171.toInt() else col(R.color.padel_border))
    addView(label(text, 15f, col(R.color.padel_text)))
    action?.let { (label, run) ->
        addView(button(label) { run() }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(10) })
    }
}

private fun LinearLayout.gap(dp: Int) = addView(View(context), LinearLayout.LayoutParams(1, context.px(dp)))

/** Mientras el almacén no está listo, las páginas del torneo solo dicen eso. true = se pintó el aviso. */
private fun Activity.storeGate(c: TournamentController, into: LinearLayout): Boolean {
    val repo = c.repo
    if (repo.status == "ready") return false
    into.addView(
        if (repo.status == "error") notice(t("storeFailed", "reason" to (repo.error?.message ?: "")), error = true, action = t("retry") to { repo.load { (this as Host).rerender() }; (this as Host).rerender() })
        else notice(t("storeLoading"))
    )
    return true
}

private fun Activity.emptyState(c: TournamentController, into: LinearLayout) {
    into.addView(label(t("noTournament"), 16f, col(R.color.padel_muted)).apply { setPadding(0, px(24), 0, px(12)); gravity = Gravity.CENTER })
    into.addView(button(t("newTournament"), filled = true) { c.startDraft() }.apply { tag = "new-tournament" })
}

private fun Activity.input(value: String, hint: String, max: Int, testId: String, onChange: (String) -> Unit) = EditText(this).apply {
    setText(value)
    this.hint = hint
    setTextColor(col(R.color.padel_text))
    setHintTextColor(col(R.color.padel_muted))
    background = rounded(col(R.color.padel_bg), px(10), px(1), col(R.color.padel_border))
    setPadding(px(12), px(10), px(12), px(10))
    filters = arrayOf(InputFilter.LengthFilter(max))
    isSingleLine = true
    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
    tag = testId
    addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
        override fun onTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
        override fun afterTextChanged(e: Editable?) { onChange(e.toString()) }
    })
}

private fun Activity.iconButton(text: String, desc: String, testId: String, run: () -> Unit) = TextView(this).apply {
    this.text = text
    gravity = Gravity.CENTER
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    setTextColor(col(R.color.padel_muted))
    background = rounded(col(R.color.padel_surface), px(10), px(1), col(R.color.padel_border))
    contentDescription = desc
    tag = testId
    setOnClickListener { run() }
}

// ---------- Torneo ----------

fun Activity.setupTab(c: TournamentController, into: LinearLayout) {
    if (storeGate(c, into)) return
    history(c, into)
    val tour = c.current() ?: return emptyState(c, into)
    val isDraft = tour === c.draft
    into.addView(heading(t(if (isDraft) "newTournamentH" else "tournamentH")))
    into.addView(rule(c, "name", tour.name) {
        input(tour.name, t("name"), 40, "tournament-name") { c.rename(it) }.apply { post { requestFocus() } }
    })
    roster(c, tour, into)
    into.gap(16)
    rulesChoice(c, tour, into)
    val blocker = Engine.nextRoundBlocker(tour)
    into.gap(12)
    into.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        if (isDraft) {
            addView(button(t("start"), filled = true) { c.startTournament() }.apply {
                isEnabled = blocker == null; alpha = if (blocker == null) 1f else 0.45f; tag = "start-tournament"
            })
            addView(button(t("cancel")) { c.cancelDraft() }.apply { tag = "cancel-draft" },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(8) })
        } else {
            addView(button(t("newTournament")) { c.startDraft() }.apply { tag = "new-tournament" })
            addView(button(t("deleteTournament"), danger = true) { c.deleteTournament(tour) }.apply { tag = "delete-tournament" },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(8) })
        }
    })
    if (isDraft && blocker == "players") into.addView(hint(t(if (Engine.isFixed(tour)) "needTeams" else "needPlayers", "n" to Engine.minUnits(tour))))
}

private fun Activity.history(c: TournamentController, into: LinearLayout) {
    if (c.repo.list.isEmpty()) return
    into.addView(LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(sectionLabel(t("myTournaments")), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    })
    into.addView(segmented(Engine.HISTORY_PERIODS.map { it to t("period_$it") }, c.historyPeriod) {
        c.historyPeriod = it
        (this as Host).rerender()
    }.apply { tag = "history-period"; setPadding(0, px(8), 0, px(8)) })
    val list = c.history()
    if (list.isEmpty()) into.addView(hint(t("periodEmpty")).apply { tag = "history-empty" })
    for (tour in list) {
        val st = Engine.status(tour)
        val size = if (Engine.isFixed(tour)) t("teamsCount", "n" to tour.teams.count { it.active }) else t("playersCount", "n" to tour.players.count { it.active })
        val phase = if (st.finished) t("stateFinished") else if (tour.rounds.isNotEmpty()) t("stateRound", "n" to tour.rounds.size) else t("stateNotStarted")
        val current = tour.id == c.repo.activeId
        into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(4), 0, px(4))
            addView(LinearLayout(this@history).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(px(12), px(10), px(12), px(10))
                background = rounded(col(R.color.padel_surface), px(12), px(1), if (current) col(R.color.padel_accent) else col(R.color.padel_border))
                addView(label(tour.name, 15f, col(R.color.padel_text), bold = true))
                addView(label("${c.formatDate(tour.createdAt)} · $size · $phase", 12f, col(R.color.padel_muted)))
                tag = "open-tournament"
                setOnClickListener { c.open(tour.id) }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton("✕", t("deleteTournament"), "delete-other") { c.deleteTournament(tour) },
                LinearLayout.LayoutParams(px(44), px(44)).apply { marginStart = px(6) })
        })
    }
    into.gap(20)
}

private fun Activity.roster(c: TournamentController, tour: Tournament, into: LinearLayout) {
    val fixed = Engine.isFixed(tour)
    into.gap(12)
    into.addView(sectionLabel(if (fixed) t("teams", "n" to tour.teams.count { it.active }) else t("players", "n" to tour.players.count { it.active })))
    fun unitButton(active: Boolean, remove: () -> Unit, restore: () -> Unit): View =
        if (active) iconButton("✕", t("remove"), "remove") { remove() }
        else LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(label(t("retired"), 12f, col(R.color.padel_muted)).apply { setPadding(px(6), 0, px(6), 0) })
            addView(button(t("restore")) { restore() }.apply { tag = "restore" })
        }
    fun nameInput(pid: String) = input(c.playerName(tour, pid), t("playerPlaceholder"), 24, "rename-$pid") { c.renamePlayer(pid, it) }
    if (fixed) {
        for (team in tour.teams) into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(4), 0, px(4))
            alpha = if (team.active) 1f else 0.6f
            addView(nameInput(team.players[0]), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(label("/", 16f, col(R.color.padel_muted)).apply { setPadding(px(6), 0, px(6), 0) })
            addView(nameInput(team.players[1]), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(unitButton(team.active, { c.removeTeam(team.id) }, { c.restore(team.id) }), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(44)).apply { marginStart = px(6) })
        })
        var a = ""
        var b = ""
        into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(4), 0, px(4))
            val ia = input("", t("playerPlaceholder"), 24, "add-team-a") { a = it }
            val ib = input("", t("playerPlaceholder"), 24, "add-team-b") { b = it }
            fun add() {
                if (a.isBlank()) return run { ia.requestFocus() }
                if (b.isBlank()) return run { ib.requestFocus() }
                c.addTeam(a.trim(), b.trim())
            }
            ib.imeOptions = EditorInfo.IME_ACTION_DONE
            ib.setOnEditorActionListener { _, _, _ -> add(); true }
            addView(ia, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(label("/", 16f, col(R.color.padel_muted)).apply { setPadding(px(6), 0, px(6), 0) })
            addView(ib, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(button(t("add")) { add() }.apply { tag = "add-team" }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
        })
    } else {
        for (p in tour.players) into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(4), 0, px(4))
            alpha = if (p.active) 1f else 0.6f
            addView(nameInput(p.id), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(unitButton(p.active, { c.removePlayer(p.id) }, { c.restore(p.id) }), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(44)).apply { marginStart = px(6) })
        })
        var name = ""
        into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(4), 0, px(4))
            val input = input("", t("playerPlaceholder"), 24, "add-player") { name = it }
            fun add() {
                if (name.isBlank()) return run { input.requestFocus() }
                c.addPlayer(name.trim())
                // Tras repintar, el foco vuelve al campo de añadir: se meten varios seguidos.
                post { rootView.findViewWithTag<EditText>("add-player")?.requestFocus() }
            }
            input.imeOptions = EditorInfo.IME_ACTION_NEXT
            input.setOnEditorActionListener { _, _, _ -> add(); true }
            addView(input, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(button(t("add")) { add() }.apply { tag = "add-player-btn" }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
        })
    }
}

/** Elegir las reglas del torneo (una sola), con el ✎ de cada set para editarlo en el modal. */
private fun Activity.rulesChoice(c: TournamentController, tour: Tournament, into: LinearLayout) {
    into.addView(sectionLabel(t("rulesH")).apply { tag = "rules-choice" })
    val sets = c.rulesets()
    val own = if (sets.none { it.id == tour.rulesetId }) listOf(Ruleset("", t("rulesetOwn"), 0, tour.settings)) else emptyList()
    for (set in own + sets) {
        val selected = set.id == (tour.rulesetId?.takeIf { id -> sets.any { it.id == id } } ?: "")
        val blocked = !selected && !Engine.canApplyRules(tour, set.settings)
        into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, px(8), 0, 0)
            addView(rulesetCard(c, tour, set, selected, blocked, "ruleset") { c.selectRuleset(set.id) },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton("✎", t("rulesetEditAria", "name" to set.name), "edit-ruleset") { (this@rulesChoice as Host).openRules(set.id) },
                LinearLayout.LayoutParams(px(44), px(44)).apply { marginStart = px(6) })
        })
    }
    val est = c.estimateText(tour, tour.settings)
    if (est.isNotEmpty()) into.addView(hint(est).apply { tag = "estimate" })
    val over = c.courtsOver(tour, tour.settings)
    if (over.isNotEmpty()) into.addView(hint(over, warn = true).apply { tag = "courts-warning" })
}

/** Lo que las pestañas le piden a la actividad que las contiene. */
interface Host {
    fun openRules(rulesetId: String?)
    fun playMatch(tour: Tournament, match: TMatch)
    fun linkedMatchId(): String?
    fun goTab(tab: String)
    fun rerender()
}

// ---------- Reglas ----------

fun Activity.rulesTab(c: TournamentController, into: LinearLayout, formHere: Boolean) {
    if (storeGate(c, into)) return
    val tour = c.rulesTour()
    into.addView(heading(t("rulesH")))
    val sets = c.rulesets()
    val withOwn = if (c.current() != null && sets.none { it.id == tour.rulesetId }) listOf(Ruleset("", t("rulesetOwn"), 0, tour.settings)) + sets else sets
    for (set in withOwn) {
        val on = c.editing(set.id)
        into.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, px(8), 0, 0)
            addView(rulesetCard(c, tour, set, on, false, "rules-item") { c.loadForm(set.id); (this as Host).rerender() },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton("✕", t("rulesetDelete", "name" to set.name), "delete-ruleset") { c.deleteRuleset(set.id) }.apply {
                val can = !set.builtin && set.id.isNotEmpty()
                isEnabled = can; alpha = if (can) 1f else 0.4f
            }, LinearLayout.LayoutParams(px(44), px(44)).apply { marginStart = px(6) })
        })
    }
    // Con el modal abierto el formulario está solo en el modal: nunca dos copias a la vez.
    if (formHere) {
        into.gap(16)
        into.addView(rulesForm(c) {})
    }
}

// ---------- Tabla ----------

fun Activity.tableTab(c: TournamentController, into: LinearLayout) {
    if (storeGate(c, into)) return
    val tour = c.repo.active() ?: return emptyState(c, into)
    val rows = Engine.standings(tour)
    val finished = Engine.status(tour).finished
    val sets = tour.settings.scoring.sets.on
    into.addView(heading(tour.name))
    into.addView(label("${t("scoring")}: ${c.scoringSummary(tour.settings)}", 13f, col(R.color.padel_muted)).apply { tag = "scoring-summary"; setPadding(0, 0, 0, px(12)) })
    val cols = listOfNotNull("#" to "#", (if (Engine.isFixed(tour)) t("colTeam") else t("colPlayer")) to "", t("colPlayed") to t("colPlayedTitle"),
        t("colWon") to t("colWonTitle"), if (sets) t("colSetDiff") to t("colSetDiffTitle") else null, t("colDiff") to t("colDiffTitle"), t("colPoints") to t("colPointsTitle"))
    fun cell(text: String, name: Boolean = false, bold: Boolean = false, color: Int = col(R.color.padel_text)) =
        label(text, 14f, color, bold).apply {
            gravity = if (name) Gravity.START else Gravity.CENTER
            setPadding(px(6), px(8), px(6), px(8))
        }
    fun rowOf(views: List<TextView>, bg: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(bg)
        views.forEachIndexed { i, v -> addView(v, LinearLayout.LayoutParams(if (i == 1) 0 else px(if (i == 0) 36 else 44), ViewGroup.LayoutParams.WRAP_CONTENT, if (i == 1) 1f else 0f)) }
    }
    val signed = { n: Int -> if (n > 0) "+$n" else if (n < 0) "−${-n}" else "0" }
    into.addView(rowOf(cols.mapIndexed { i, (l, title) -> cell(l, name = i == 1, bold = true, color = col(R.color.padel_muted)).apply { contentDescription = title } }, col(R.color.padel_surface)).apply { tag = "standings" })
    rows.forEachIndexed { i, r ->
        val rank = if (finished && i < 3) listOf("🥇", "🥈", "🥉")[i] else "${i + 1}"
        val name = c.unitName(tour, r.id) + if (r.active) "" else " (${t("retired")})"
        val cells = mutableListOf(cell(rank), cell(name, name = true), cell("${r.played}"), cell("${r.won}"))
        if (sets) cells.add(cell(signed(r.setsFor - r.setsAgainst)))
        cells.add(cell(signed(r.gamesFor - r.gamesAgainst)))
        cells.add(cell("${r.points}", bold = true, color = col(R.color.padel_accent)))
        into.addView(rowOf(cells, if (i % 2 == 0) col(R.color.padel_bg) else col(R.color.padel_surface)).apply { alpha = if (r.active) 1f else 0.6f; tag = "unit-${r.id}" })
    }
}

// ---------- Partidos ----------

/** Referencias para actualizar sin repintar (escribir un resultado no debe mover el foco). */
class MatchesRefs {
    var progress: TextView? = null
    var next: LinearLayout? = null
    val clocks = mutableMapOf<String, Pair<TextView, String>>() // round.id → (tiempo, estado pintado)
}

fun Activity.matchesTab(c: TournamentController, into: LinearLayout, refs: MatchesRefs) {
    refs.clocks.clear()
    if (storeGate(c, into)) return
    val tour = c.repo.active() ?: return emptyState(c, into)
    into.addView(heading(tour.name))
    refs.progress = label("", 13f, col(R.color.padel_muted)).apply { tag = "progress" }
    into.addView(refs.progress)
    paintProgress(tour, refs)
    tour.rounds.forEachIndexed { i, r -> into.addView(round(c, tour, r, i, refs)) }
    refs.next = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, px(16), 0, px(24)) }
    into.addView(refs.next)
    paintNext(c, tour, refs)
}

private fun paintProgress(tour: Tournament, refs: MatchesRefs) {
    val st = Engine.status(tour)
    val est = Engine.estimate(tour)
    val total = maxOf(est?.matches ?: 0, st.scheduled)
    val approx = est != null && !est.exact && !st.reached
    refs.progress?.text = t(if (approx) "progressApprox" else "progress", "scored" to st.scored, "total" to total)
}

private fun Activity.paintNext(c: TournamentController, tour: Tournament, refs: MatchesRefs) {
    val box = refs.next ?: return
    box.removeAllViews()
    val blocker = Engine.nextRoundBlocker(tour)
    val next = button(t("nextRound", "n" to tour.rounds.size + 1), filled = true) { c.nextRound(tour) }.apply {
        isEnabled = blocker == null; alpha = if (blocker == null) 1f else 0.45f; tag = "next-round"
    }
    if (blocker == "finished" && Engine.status(tour).finished) {
        box.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(14), px(12), px(14), px(12))
            background = rounded(0x33FDE047, px(12), px(1), col(R.color.padel_win))
            tag = "finished"
            addView(label("🏆 ${t("finished")}", 16f, col(R.color.padel_text), bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(button(t("seeTable")) { (this@paintNext as Host).goTab("table") })
        })
        box.gap(10)
    }
    box.addView(next, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    if (blocker == "players") {
        box.gap(10)
        box.addView(notice(t(if (Engine.isFixed(tour)) "needTeams" else "needPlayers", "n" to Engine.minUnits(tour)), action = t("goSetup") to { (this as Host).goTab("setup") }))
    }
    val last = tour.rounds.lastOrNull()
    if (blocker == null && tour.settings.pairing == "ranked" && last != null && !last.matches.all { Engine.hasScore(it) }) {
        box.addView(hint(t("rankedPending", "n" to tour.rounds.size)))
    }
}

private fun Activity.round(c: TournamentController, tour: Tournament, r: Round, i: Int, refs: MatchesRefs): View {
    val last = i == tour.rounds.size - 1
    return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, px(18), 0, 0)
        tag = "round"
        addView(LinearLayout(this@round).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(label(t("round", "n" to i + 1), 18f, col(R.color.padel_text), bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (last) {
                val can = Engine.canRedoLastRound(tour)
                // Solo la última se rehace o se quita, y solo sin resultados: si no, deshabilitados.
                addView(button(t("redo")) { c.redo(tour) }.apply { isEnabled = can; alpha = if (can) 1f else 0.4f; tag = "redo-round"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f) })
                addView(button(t("dropRound")) { c.drop(tour) }.apply { isEnabled = can; alpha = if (can) 1f else 0.4f; tag = "drop-round"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f) },
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
            }
        })
        if (last && (tour.settings.matchEnd == "time" || r.clock != null)) addView(clock(c, tour, r, refs))
        for (m in r.matches) addView(match(c, tour, r, m, refs))
        if (r.rest.isNotEmpty()) addView(hint(t("resting", "names" to r.rest.joinToString(", ") { c.unitName(tour, it) })))
    }
}

private fun Activity.clock(c: TournamentController, tour: Tournament, r: Round, refs: MatchesRefs): View {
    val st = Engine.clockOf(tour, r, System.currentTimeMillis())
    val time = label(clockText(st), 28f, col(R.color.padel_text), bold = true).apply { tag = "clock-time"; typeface = Typeface.MONOSPACE }
    refs.clocks[r.id] = time to st.state
    fun b(action: String, label: String, primary: Boolean = false, enabled: Boolean = true) =
        button(t(label), filled = primary) { c.clock(tour, r.id, action) }.apply { isEnabled = enabled; alpha = if (enabled) 1f else 0.4f; tag = "clock-$action" }
    val main = when (st.state) {
        "idle" -> b("start", "clockStart", primary = true)
        "running" -> b("pause", "clockPause")
        "paused" -> b("resume", "clockResume", primary = true)
        "done" -> b("start", "clockStart", primary = true, enabled = false)
        else -> throw IllegalStateException("unknown clock state: ${st.state}")
    }
    return LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(px(14), px(10), px(14), px(10))
        background = rounded(col(R.color.padel_surface), px(12), px(1), if (st.state == "running") col(R.color.padel_accent) else col(R.color.padel_border))
        tag = "round-clock"
        contentDescription = t("clockAria")
        addView(time, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(main)
        addView(b("reset", "clockReset", enabled = st.state != "idle"), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
    }
}

fun clockText(st: ClockState) = if (st.state == "done") t("clockDone") else Engine.formatClock(st.remainingMs)

private fun Activity.match(c: TournamentController, tour: Tournament, r: Round, m: TMatch, refs: MatchesRefs): View {
    val linked = (this as Host).linkedMatchId() == m.id
    val withSets = tour.settings.scoring.sets.on
    val sides = mutableMapOf<String, LinearLayout>()
    fun paintWon() {
        val w = Engine.outcome(m)
        for ((s, v) in sides) v.background = if (w == s) rounded(0x26FDE047, (8 * resources.displayMetrics.density).toInt()) else null
    }
    val inputs = mutableMapOf<String, EditText>()
    fun score(side: String, kind: String): EditText {
        val v = if (kind == "sets") m.sets else m.score
        val value = if (side == "a") v?.a else v?.b
        return EditText(this).apply {
            setText(value?.toString() ?: "")
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(2))
            gravity = Gravity.CENTER
            setTextColor(col(R.color.padel_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            background = rounded(col(R.color.padel_bg), px(8), px(1), col(R.color.padel_border))
            tag = "${if (kind == "sets") "sets" else "score"}-$side"
            contentDescription = t(if (kind == "sets") "setsOf" else "gamesOf", "name" to c.sideName(tour, if (side == "a") m.a else m.b))
            inputs["$kind-$side"] = this
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                override fun onTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                override fun afterTextChanged(e: Editable?) {
                    // Escribir un resultado NO repinta la página: se toca solo lo que cambia.
                    fun parse(x: EditText) = x.text.toString().toIntOrNull()?.coerceIn(0, 99)
                    val a = inputs["$kind-a"] ?: return
                    val b = inputs["$kind-b"] ?: return
                    c.setScore(tour, m.id, kind, parse(a), parse(b))
                    paintWon()
                    paintProgress(tour, refs)
                    paintNext(c, tour, refs)
                }
            })
        }
    }
    return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(px(12), px(10), px(12), px(10))
        background = rounded(col(R.color.padel_surface), px(12), px(1), if (linked) col(R.color.padel_accent) else col(R.color.padel_border))
        tag = "match"
        (layoutParams as? ViewGroup.MarginLayoutParams)?.topMargin = px(8)
        addView(LinearLayout(this@match).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(label(t("court", "n" to m.court), 13f, col(R.color.padel_muted), bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            if (linked) addView(label("● ${t("inScoreboard")}", 12f, col(R.color.padel_accent), bold = true).apply { setPadding(0, 0, px(8), 0) })
            addView(button(t("play")) { (this@match as Host).playMatch(tour, m) }.apply { tag = "play-match"; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f) })
        })
        if (withSets) addView(LinearLayout(this@match).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(View(this@match), LinearLayout.LayoutParams(0, 1, 1f))
            addView(label(t("setsShort"), 11f, col(R.color.padel_muted)).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(px(52), ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(label(t("gamesShort"), 11f, col(R.color.padel_muted)).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(px(52), ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
        })
        for (side in listOf("a", "b")) {
            val row = LinearLayout(this@match).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(px(6), px(4), px(6), px(4))
                addView(label(c.sideName(tour, if (side == "a") m.a else m.b), 15f, col(R.color.padel_text), bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                if (withSets) addView(score(side, "sets"), LinearLayout.LayoutParams(px(52), px(44)))
                addView(score(side, "games"), LinearLayout.LayoutParams(px(52), px(44)).apply { marginStart = px(6) })
            }
            sides[side] = row
            addView(row)
        }
        paintWon()
    }.also { v ->
        v.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(8) }
    }
}

/** El tic del cronómetro: pinta el tiempo sin repintar; si cambió el estado, false (hay que repintar). */
fun tickClocks(tour: Tournament, refs: MatchesRefs, now: Long): Boolean {
    for ((id, pair) in refs.clocks) {
        val r = tour.rounds.find { it.id == id } ?: continue
        val st = Engine.clockOf(tour, r, now)
        if (st.state != pair.second) return false
        val text = clockText(st)
        if (pair.first.text != text) pair.first.text = text
    }
    return true
}
