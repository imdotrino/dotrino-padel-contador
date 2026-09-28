package com.dotrino.padel

import android.app.Activity
import android.graphics.Typeface
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.dotrino.padel.tournament.ClockState
import com.dotrino.padel.tournament.Engine
import com.dotrino.padel.tournament.TMatch
import com.dotrino.padel.tournament.Tournament
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * El marcador: la portada de la app, como en la PWA (src/scoreboard.js). Tocar el panel de una
 * pareja le da el punto; los +/− corrigen sets, juegos y puntos sin deshacer jugadas. Juega un
 * partido suelto o uno del torneo (`match.link`): en el segundo, el resultado vuelve al torneo.
 */
class Scoreboard(private val a: Activity, private val repo: Repo, private val hooks: Hooks) {
    /** Lo que el marcador necesita del torneo. */
    interface Hooks {
        fun saveLinked(link: Match.Link, games: Pair<Int, Int>, sets: Pair<Int, Int>?): Boolean
        fun linkedSaved()
        fun linkedClock(link: Match.Link, now: Long): ClockState?
    }

    var match = repo.loadMatch()
        private set
    private var config = repo.loadConfig()
    private val scope = MainScope()
    private var lastClock: String? = null

    private lateinit var panels: Map<Side, Panel>
    private lateinit var court: CourtView
    private lateinit var optionsText: TextView
    private lateinit var linkedBar: View
    private lateinit var linkedLabel: TextView
    private lateinit var newButton: TextView

    fun dispose() = scope.cancel()

    // ---------- pantalla ----------

    val view: View = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        addView(optionsBar())
        addView(linkedBar())
        addView(board(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(controls())
    }.also { render() }

    /** Las opciones del partido, a la vista arriba del tablero; tocarlas las edita. */
    private fun optionsBar(): View = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        setBackgroundColor(a.col(R.color.padel_surface))
        setPadding(a.px(14), a.px(8), a.px(14), a.px(8))
        tag = "options-btn"
        contentDescription = t("optionsTitle")
        setOnClickListener { openOptions() }
        optionsText = a.label("", 13f, a.col(R.color.padel_text), bold = true).apply { isSingleLine = true; letterSpacing = 0.03f }
        addView(optionsText)
        addView(a.label("✎", 13f, a.col(R.color.padel_accent)).apply { setPadding(a.px(8), 0, 0, 0) })
    }

    private fun linkedBar(): View = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackgroundColor(a.col(R.color.padel_surface))
        setPadding(a.px(14), a.px(4), a.px(4), a.px(4))
        linkedLabel = a.label("", 13f, a.col(R.color.padel_text), bold = true).apply { isSingleLine = true; tag = "linked-label" }
        addView(linkedLabel, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(a.label("✕", 16f, a.col(R.color.padel_muted)).apply {
            setPadding(a.px(12), a.px(8), a.px(12), a.px(8))
            contentDescription = t("leaveLinked")
            tag = "leave-linked"
            setOnClickListener { leaveLinked() }
        })
        linkedBar = this
    }

    private class Panel(
        val name: EditText, val pencil: TextView, val sets: MetaRow, val games: MetaRow, val points: TextView,
        val pointMinus: TextView, val pointPlus: TextView, val serve: TextView, val tie: TextView,
    )

    private class MetaRow(val root: View, val minus: TextView, val value: TextView, val total: TextView, val plus: TextView)

    private fun board(): View {
        val row = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL }
        val built = mutableMapOf<Side, Panel>()
        for (side in Side.entries) {
            val (v, p) = panel(side)
            built[side] = p
            row.addView(v, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        }
        panels = built
        court = CourtView(a)
        return FrameLayout(a).apply {
            addView(row, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(court, FrameLayout.LayoutParams(a.px(150), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = a.px(40) })
        }
    }

    private fun circle(text: String, big: Boolean, onClick: () -> Unit) = TextView(a).apply {
        this.text = text
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 26f else 18f)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(a.col(R.color.padel_text))
        background = rounded(0x33FFFFFF, a.px(100), a.px(1), 0x55FFFFFF)
        setOnClickListener { onClick() }
    }

    private fun meta(side: Side, kind: Match.Kind, big: Boolean): MetaRow {
        val size = if (big) 44 else 36
        val minus = circle("−", false) { update(match.adjust(config, side, kind, -1)) }
        val plus = circle("+", false) { update(match.adjust(config, side, kind, +1)) }
        val value = a.label("0", if (big) 28f else 20f, a.col(R.color.padel_text), bold = true)
        val total = a.label("", 14f, 0xAAFFFFFF.toInt())
        val text = a.label((if (kind == Match.Kind.s) "sets" else "games").uppercase(), if (big) 15f else 12f, a.col(R.color.padel_text), bold = true)
        val root = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, a.px(3), 0, a.px(3))
            addView(minus, LinearLayout.LayoutParams(a.px(size), a.px(size)))
            addView(value, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = a.px(6) })
            addView(total)
            addView(text, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = a.px(4); marginEnd = a.px(6) })
            addView(plus, LinearLayout.LayoutParams(a.px(size), a.px(size)))
        }
        return MetaRow(root, minus, value, total, plus)
    }

    private fun panel(side: Side): Pair<View, Panel> {
        val name = EditText(a).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(a.col(R.color.padel_text))
            setHintTextColor(0xCCFFFFFF.toInt())
            gravity = Gravity.CENTER
            background = null
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_DONE
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            filters = arrayOf(android.text.InputFilter.LengthFilter(32))
            isFocusable = false
            tag = "name-$side"
            setOnClickListener { editName(this) }
            setOnEditorActionListener { v, action, e ->
                if (action == EditorInfo.IME_ACTION_DONE || e?.keyCode == KeyEvent.KEYCODE_ENTER) { finishName(v as EditText); true } else false
            }
            setOnFocusChangeListener { v, has -> if (!has) finishName(v as EditText) }
        }
        val pencil = a.label("✎", 16f, a.col(R.color.padel_text)).apply {
            setPadding(a.px(8), a.px(4), a.px(8), a.px(4))
            contentDescription = t("editName")
            setOnClickListener { editName(name) }
        }
        val nameRow = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(name, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(pencil)
        }
        val sets = meta(side, Match.Kind.s, big = true)
        val games = meta(side, Match.Kind.g, big = false)
        val points = a.label("0", 96f, a.col(R.color.padel_text), bold = true).apply { gravity = Gravity.CENTER; includeFontPadding = false; tag = "points-$side" }
        val pointMinus = circle("−", true) { update(match.adjustPoint(config, side, -1)) }
        val pointPlus = circle("+", true) { update(match.adjustPoint(config, side, +1)) }
        val adj = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(pointMinus, LinearLayout.LayoutParams(a.px(56), a.px(56)).apply { marginEnd = a.px(22) })
            addView(pointPlus, LinearLayout.LayoutParams(a.px(56), a.px(56)))
        }
        val serve = a.label("", 16f, a.col(R.color.padel_text), bold = true).apply { gravity = Gravity.CENTER; letterSpacing = 0.08f }
        val tie = a.label("TIE-BREAK", 13f, a.col(R.color.padel_on_accent), bold = true).apply {
            background = rounded(a.col(R.color.padel_win), a.px(6))
            setPadding(a.px(8), a.px(3), a.px(8), a.px(3))
        }
        val column = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(a.px(6), a.px(16), a.px(6), a.px(8))
            setBackgroundColor(a.col(if (side == Side.left) R.color.padel_left else R.color.padel_right))
            tag = "team-$side"
            addView(View(a), LinearLayout.LayoutParams(1, 0, 1f))
            addView(nameRow)
            addView(sets.root)
            addView(games.root)
            addView(points)
            addView(adj)
            addView(tie, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = a.px(8) })
            addView(serve, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = a.px(10) })
            addView(View(a), LinearLayout.LayoutParams(1, 0, 1.4f))
            // Tocar el panel (fuera de los botones y del nombre) es ganar el punto.
            setOnClickListener { play(side) }
        }
        return column to Panel(name, pencil, sets, games, points, pointMinus, pointPlus, serve, tie)
    }

    private fun controls(): View = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(a.col(R.color.padel_bg))
        fun ctl(text: String, accent: Boolean = false, testId: String, run: () -> Unit) = a.label(text.uppercase(), 16f,
            a.col(if (accent) R.color.padel_on_accent else R.color.padel_muted), bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(0, a.px(18), 0, a.px(18))
            if (accent) setBackgroundColor(a.col(R.color.padel_accent))
            tag = testId
            setOnClickListener { run() }
        }
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        addView(ctl(t("undo"), testId = "undo") { match.undo()?.let { update(it) } }, lp())
        addView(ctl(t("serveBtn"), accent = true, testId = "serve") { update(match.switchServer()) }, lp())
        newButton = ctl(t("newMatch"), testId = "new-match") { newMatch() }
        addView(newButton, lp())
    }

    // ---------- jugadas ----------

    private fun update(next: Match?) {
        next ?: return
        match = next
        repo.saveMatch(match)
        render()
    }

    private fun play(side: Side) {
        val before = match.now.gameNum
        update(match.winPoint(config, side))
        if (match.now.gameNum != before) checkLinkedTarget()
    }

    private fun editName(input: EditText) {
        if (match.link != null || input.isFocusable) return // del torneo: los nombres vienen de él
        input.isFocusableInTouchMode = true
        input.isFocusable = true
        input.requestFocus()
        input.selectAll()
        a.getSystemService(InputMethodManager::class.java).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun finishName(input: EditText) {
        if (!input.isFocusable) return
        input.isFocusable = false
        a.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(input.windowToken, 0)
        val names = if (input === panels.getValue(Side.left).name) match.names.copy(left = input.text.toString())
        else match.names.copy(right = input.text.toString())
        match = match.copy(names = names)
        repo.saveMatch(match)
    }

    private fun newMatch() {
        if (match.link != null) return saveLinked()
        if (!match.hasProgress) return update(match.reset())
        a.ask(t("newMatchTitle"), t("confirmNew"), t("newMatchOk")) {
            val r = Result.of(
                UUID.randomUUID().toString(), System.currentTimeMillis(),
                match.names.left.ifBlank { t("teamA") }, match.names.right.ifBlank { t("teamB") },
                match.currentSets(),
            )
            scope.launch {
                try {
                    withContext(Dispatchers.IO) { repo.saveResult(r) }
                } catch (e: Exception) {
                    // Sin guardar no se reinicia: el marcador sigue ahí para no perder el partido.
                    android.util.Log.e("padel", "could not save result", e)
                    a.toast(t("resultSaveFailed", "reason" to (e.message ?: e.toString())))
                    return@launch
                }
                update(match.reset())
            }
        }
    }

    // ---------- partido del torneo ----------

    fun linkedMatchId() = match.link?.matchId

    /** Jugar un partido del torneo en el marcador. `done(true)` si quedó en el marcador. */
    fun playLinked(tour: Tournament, m: TMatch, done: (Boolean) -> Unit) {
        if (match.link?.matchId == m.id) return done(true)
        val index = tour.rounds.indexOfFirst { r -> r.matches.any { it.id == m.id } }
        val s = tour.settings
        fun side(ids: List<String>) = ids.joinToString(" / ") { id -> tour.players.first { it.id == id }.name }
        val link = Match.Link(
            tournamentId = tour.id, tournamentName = tour.name, matchId = m.id, roundId = tour.rounds[index].id,
            round = index + 1, court = m.court, timed = s.matchEnd == "time",
            target = if (s.matchEnd == "games") s.gamesPerMatch else 0, sets = s.scoring.sets.on,
            left = side(m.a), right = side(m.b),
        )
        fun go() {
            // El estado del reloj AL ENLAZAR: si ya corría y se acaba antes del primer tic, el
            // partido igual se guarda solo.
            lastClock = if (link.timed) hooks.linkedClock(link, System.currentTimeMillis())?.state else null
            update(Match(names = Match.Names(link.left, link.right), link = link))
            done(true)
        }
        if (match.hasProgress || match.link != null) {
            a.ask(t("replaceMatchTitle"), t("replaceMatchText"), t("replace"), danger = true) { go() }
        } else go()
    }

    private fun checkLinkedTarget() {
        val l = match.link ?: return
        if (l.target > 0 && (match.totalGames(Side.left) >= l.target || match.totalGames(Side.right) >= l.target)) saveLinked()
    }

    private fun resultText(): String {
        val l = match.link!!
        val sets = if (l.sets) "  (SETS ${match.now.left.s}–${match.now.right.s})" else ""
        return "${l.left}  ${match.totalGames(Side.left)} – ${match.totalGames(Side.right)}  ${l.right}$sets"
    }

    private fun saveLinked() {
        val l = match.link ?: return
        a.ask(t("saveResultTitle"), resultText(), t("save"), cancel = t("keepPlaying")) {
            // Mientras se decidía pudo acabarse el tiempo y guardarse solo: ya no hay nada que guardar.
            if (match.link == l) commitLinked()
        }
    }

    /** Guarda en el torneo lo que marca ahora y suelta el partido. false si no se pudo. */
    private fun commitLinked(): Boolean {
        val l = match.link ?: return false
        val saved = hooks.saveLinked(l, match.totalGames(Side.left) to match.totalGames(Side.right),
            if (l.sets) match.now.left.s to match.now.right.s else null)
        if (!saved) return false
        unlink()
        hooks.linkedSaved()
        return true
    }

    private fun unlink() {
        lastClock = null
        update(Match())
    }

    private fun leaveLinked() {
        a.ask(t("leaveLinkedTitle"), t("leaveLinkedText"), t("leave"), danger = true) { unlink() }
    }

    private fun linkLabel(now: Long): String {
        val l = match.link!!
        val head = t("linkedLabel", "name" to l.tournamentName, "round" to l.round, "court" to l.court)
        if (!l.timed) return "$head · " + (if (l.target > 0) t("toGames", "n" to l.target) else t("freeGames"))
        val c = hooks.linkedClock(l, now) ?: return "$head · ${t("onTime")}"
        return "$head · ⏱ " + if (c.state == "done") t("clockDone") else Engine.formatClock(c.remainingMs)
    }

    /** El tic: la cuenta atrás del partido del torneo; al acabarse, se guarda sin preguntar. */
    fun tick(now: Long) {
        val l = match.link
        if (l == null || !l.timed) { lastClock = null; return }
        val c = hooks.linkedClock(l, now)
        val before = lastClock
        lastClock = c?.state
        val label = linkLabel(now)
        if (linkedLabel.text != label) linkedLabel.text = label
        if (before == "running" && lastClock == "done") {
            val text = resultText()
            if (commitLinked()) a.toast(t("timeUpSaved", "result" to text))
        }
    }

    // ---------- pintado ----------

    fun render() {
        val l = match.link
        for (side in Side.entries) {
            val p = panels.getValue(side)
            val s = match.now[side]
            val pt = match.point(side)
            p.points.text = pt.text
            p.points.setTextColor(a.col(if (pt.ad) R.color.padel_win else R.color.padel_text))
            p.sets.root.visibility = if (match.showSets(config)) View.VISIBLE else View.GONE
            paintMeta(p.sets, s.s, if (l != null || config.sets == 1) 0 else config.sets)
            paintMeta(p.games, s.g, 0)
            for ((b, d) in listOf(p.pointMinus to -1, p.pointPlus to 1)) {
                b.isEnabled = match.canAdjustPoint(config, side, d)
                b.alpha = if (b.isEnabled) 1f else 0.35f
            }
            p.serve.text = if (match.now.server == side) "● ${t("serve")} ${match.player}" else ""
            p.tie.visibility = if (match.now.tiebreak) View.VISIBLE else View.INVISIBLE
            val name = if (side == Side.left) match.names.left else match.names.right
            if (!p.name.isFocusable && p.name.text.toString() != name) p.name.setText(name)
            p.name.hint = t(if (side == Side.left) "teamA" else "teamB").uppercase()
            // Jugando un partido del torneo los nombres vienen del torneo: el lápiz se deshabilita.
            p.pencil.isEnabled = l == null
            p.pencil.alpha = if (l == null) 1f else 0.35f
        }
        court.show(match.now.server, match.courtSide)
        val scoring = t(when (config.scoring) { Scoring.advantage -> "advantage"; Scoring.star -> "doubleAdv"; Scoring.golden -> "golden" })
        // Jugando un partido del torneo, los sets los decide el torneo: solo se ve la puntuación.
        optionsText.text = if (l != null) scoring else "$scoring · ${t("setsLabel${config.sets}")}"
        linkedBar.visibility = if (l != null) View.VISIBLE else View.GONE
        if (l != null) linkedLabel.text = linkLabel(System.currentTimeMillis())
        newButton.text = t(if (l != null) "saveResult" else "newMatch").uppercase()
    }

    private fun paintMeta(row: MetaRow, value: Int, total: Int) {
        row.value.text = value.toString()
        row.total.text = if (total > 0) "/$total" else ""
        row.minus.isEnabled = value > 0
        row.minus.alpha = if (value > 0) 1f else 0.35f
    }

    // ---------- opciones ----------

    private fun openOptions() {
        val (dialog, body) = a.sheet(t("optionsH"))
        fun paint() {
            body.removeAllViews()
            body.addView(a.label(t("matchSets").uppercase(), 13f, a.col(R.color.padel_muted), bold = true).apply { setPadding(0, a.px(8), 0, a.px(8)) })
            body.addView(a.segmented(Config.SETS.map { it to it.toString() }, config.sets) { n ->
                config = config.copy(sets = n)
                repo.saveConfig(config)
                update(match.reconfigured(config))
                paint()
            })
            body.addView(a.label(t("desc_sets${config.sets}"), 14f, a.col(R.color.padel_muted)).apply { setPadding(0, a.px(8), 0, a.px(18)) })
            body.addView(a.label(t("scoringMode").uppercase(), 13f, a.col(R.color.padel_muted), bold = true).apply { setPadding(0, 0, 0, a.px(8)) })
            body.addView(a.segmented(listOf(Scoring.advantage to t("advantage"), Scoring.star to t("doubleAdv"), Scoring.golden to t("golden")), config.scoring) { s ->
                config = config.copy(scoring = s)
                repo.saveConfig(config)
                render()
                paint()
            })
            body.addView(a.label(t("desc_${config.scoring.name}"), 14f, a.col(R.color.padel_muted)).apply { setPadding(0, a.px(8), 0, a.px(8)) })
        }
        paint()
        dialog.show()
    }

    // ---------- resultados guardados ----------

    fun openResults() {
        val (dialog, body) = a.sheet(t("resultsH"))
        val fmt = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())
        fun paint() {
            scope.launch {
                val list = try {
                    withContext(Dispatchers.IO) { repo.results() }
                } catch (e: Exception) {
                    android.util.Log.e("padel", "could not read results", e)
                    body.removeAllViews()
                    body.addView(a.label(t("resultsLoadFailed", "reason" to (e.message ?: e.toString())), 15f, a.col(R.color.padel_muted)))
                    return@launch
                }
                body.removeAllViews()
                if (list.isEmpty()) {
                    body.addView(a.label(t("noResults"), 15f, a.col(R.color.padel_muted)).apply { setPadding(0, a.px(16), 0, a.px(16)) })
                    return@launch
                }
                for (r in list.sortedByDescending { it.date }) body.addView(resultRow(r, fmt) { id ->
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { repo.deleteResult(id) }
                        } catch (e: Exception) {
                            android.util.Log.e("padel", "could not delete result", e)
                            a.toast(t("resultDeleteFailed", "reason" to (e.message ?: e.toString())))
                            return@launch
                        }
                        paint()
                    }
                })
            }
        }
        paint()
        dialog.show()
    }

    private fun resultRow(r: Result, fmt: SimpleDateFormat, onDelete: (String) -> Unit): View {
        val leftWins = r.setsLeft > r.setsRight
        val rightWins = r.setsRight > r.setsLeft
        val info = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            addView(a.label(fmt.format(Date(r.date)), 12f, a.col(R.color.padel_muted)))
            addView(a.label("${if (leftWins) "🏆 " else ""}${r.left} ${r.setsLeft} — ${r.setsRight} ${r.right}${if (rightWins) " 🏆" else ""}",
                16f, a.col(R.color.padel_text), bold = true))
            addView(a.label(r.sets.joinToString("  ") { "${it.left}-${it.right}" }, 13f, a.col(R.color.padel_muted)))
        }
        return LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, a.px(10), 0, a.px(10))
            tag = "result-${r.id}"
            addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(a.button(t("delete"), danger = true) { onDelete(r.id) })
        }
    }
}
