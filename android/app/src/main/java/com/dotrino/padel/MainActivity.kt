package com.dotrino.padel

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
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
import com.dotrino.sdk.ui.DotrinoLocale
import com.dotrino.sdk.ui.DotrinoTopbar
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
 * El marcador: la portada de la app, como en la PWA. Tocar el panel de una pareja le da el
 * punto; los +/− corrigen sets, juegos y puntos sin deshacer jugadas.
 */
class MainActivity : Activity() {
    private lateinit var repo: Repo
    private var match = Match()
    private var config = Config()
    private val scope = MainScope()

    private lateinit var panels: Map<Side, Panel>
    private lateinit var court: CourtView

    override fun attachBaseContext(base: Context) = super.attachBaseContext(DotrinoLocale.wrap(base))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repo = Repo(this)
        match = repo.loadMatch()
        config = repo.loadConfig()
        setContentView(layout())
        render()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    // ---------- pantalla ----------

    private fun layout(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(col(R.color.padel_bg))
        fitsSystemWindows = true
        addView(topbar())
        addView(board(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        addView(controls())
    }

    private fun topbar(): View {
        fun action(text: String, testId: String, run: () -> Unit) = label(text, 14f, col(R.color.padel_muted), bold = true).apply {
            setPadding(px(8), px(10), px(8), px(10))
            tag = testId
            setOnClickListener { run() }
        }
        return DotrinoTopbar(
            this,
            repo = "imdotrino/dotrino-padel-contador",
            brand = DotrinoTopbar.Brand(getString(R.string.app_name), R.drawable.padel_brand),
            actions = listOf(
                action(getString(R.string.results).uppercase(), "results-btn") { openResults() },
                action("☰", "options-btn") { openOptions() }.apply {
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                    contentDescription = getString(R.string.options_title)
                },
            ),
        ) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://dotrino.com/"))) }.view
    }

    /** Lo de un lado del tablero, para repintarlo. */
    private class Panel(
        val name: EditText,
        val sets: MetaRow,
        val games: MetaRow,
        val points: TextView,
        val pointMinus: TextView,
        val pointPlus: TextView,
        val serve: TextView,
        val tie: TextView,
    )

    private class MetaRow(val root: View, val minus: TextView, val value: TextView, val total: TextView, val plus: TextView)

    private fun board(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val built = mutableMapOf<Side, Panel>()
        for (side in Side.entries) {
            val (view, panel) = panel(side)
            built[side] = panel
            row.addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        }
        panels = built
        court = CourtView(this)
        return FrameLayout(this).apply {
            addView(row, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(court, FrameLayout.LayoutParams(px(150), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = px(40) })
        }
    }

    private fun circle(text: String, big: Boolean, onClick: () -> Unit) = TextView(this).apply {
        this.text = text
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (big) 26f else 18f)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(col(R.color.padel_text))
        background = rounded(0x33FFFFFF, px(100), px(1), 0x55FFFFFF)
        setOnClickListener { onClick() }
    }

    private fun meta(side: Side, kind: Match.Kind, big: Boolean): MetaRow {
        val size = if (big) 44 else 36
        val minus = circle("−", false) { adjust(side, kind, -1) }
        val plus = circle("+", false) { adjust(side, kind, +1) }
        val value = label("0", if (big) 28f else 20f, col(R.color.padel_text), bold = true)
        val total = label("", 14f, 0xAAFFFFFF.toInt())
        val text = label(getString(if (kind == Match.Kind.s) R.string.sets else R.string.games).uppercase(), if (big) 15f else 12f, col(R.color.padel_text), bold = true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, px(3), 0, px(3))
            addView(minus, LinearLayout.LayoutParams(px(size), px(size)))
            addView(value, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(6) })
            addView(total)
            addView(text, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(4); marginEnd = px(6) })
            addView(plus, LinearLayout.LayoutParams(px(size), px(size)))
        }
        return MetaRow(root, minus, value, total, plus)
    }

    private fun panel(side: Side): Pair<View, Panel> {
        val name = EditText(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(col(R.color.padel_text))
            setHintTextColor(0xCCFFFFFF.toInt())
            gravity = Gravity.CENTER
            background = null
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_DONE
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            filters = arrayOf(android.text.InputFilter.LengthFilter(32))
            isFocusable = false
            setOnClickListener { editName(this) }
            setOnEditorActionListener { v, action, e ->
                if (action == EditorInfo.IME_ACTION_DONE || e?.keyCode == KeyEvent.KEYCODE_ENTER) { finishName(v as EditText); true } else false
            }
            setOnFocusChangeListener { v, has -> if (!has) finishName(v as EditText) }
        }
        val pencil = label("✎", 16f, col(R.color.padel_text)).apply {
            setPadding(px(8), px(4), px(8), px(4))
            contentDescription = getString(R.string.edit_name)
            setOnClickListener { editName(name) }
        }
        val nameRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(name, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(pencil)
        }
        val sets = meta(side, Match.Kind.s, big = true)
        val games = meta(side, Match.Kind.g, big = false)
        val points = label("0", 96f, col(R.color.padel_text), bold = true).apply { gravity = Gravity.CENTER; includeFontPadding = false }
        val pointMinus = circle("−", true) { adjustPoint(side, -1) }
        val pointPlus = circle("+", true) { adjustPoint(side, +1) }
        val adj = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(pointMinus, LinearLayout.LayoutParams(px(56), px(56)).apply { marginEnd = px(22) })
            addView(pointPlus, LinearLayout.LayoutParams(px(56), px(56)))
        }
        val serve = label("", 16f, col(R.color.padel_text), bold = true).apply { gravity = Gravity.CENTER; letterSpacing = 0.08f }
        val tie = label("TIE-BREAK", 13f, col(R.color.padel_on_accent), bold = true).apply {
            background = rounded(col(R.color.padel_win), px(6))
            setPadding(px(8), px(3), px(8), px(3))
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(px(6), px(16), px(6), px(8))
            setBackgroundColor(col(if (side == Side.left) R.color.padel_left else R.color.padel_right))
            tag = "team-$side"
            addView(View(this@MainActivity), LinearLayout.LayoutParams(1, 0, 1f))
            addView(nameRow)
            addView(sets.root)
            addView(games.root)
            addView(points)
            addView(adj)
            addView(tie, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(8) })
            addView(serve, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(10) })
            addView(View(this@MainActivity), LinearLayout.LayoutParams(1, 0, 1.4f))
            // Tocar el panel (fuera de los botones y del nombre) es ganar el punto.
            setOnClickListener { play(side) }
        }
        return column to Panel(name, sets, games, points, pointMinus, pointPlus, serve, tie)
    }

    private fun controls(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(col(R.color.padel_bg))
        fun ctl(text: Int, accent: Boolean = false, run: () -> Unit) = label(getString(text).uppercase(), 16f,
            col(if (accent) R.color.padel_on_accent else R.color.padel_muted), bold = true).apply {
            gravity = Gravity.CENTER
            setPadding(0, px(18), 0, px(18))
            if (accent) setBackgroundColor(col(R.color.padel_accent))
            setOnClickListener { run() }
        }
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        addView(ctl(R.string.undo) { match.undo()?.let { update(it) } }, lp())
        addView(ctl(R.string.serve_btn, accent = true) { update(match.switchServer()) }, lp())
        addView(ctl(R.string.new_match) { newMatch() }, lp())
    }

    // ---------- jugadas ----------

    private fun update(next: Match) {
        match = next
        repo.saveMatch(match)
        render()
    }

    private fun play(side: Side) = update(match.winPoint(config, side))
    private fun adjust(side: Side, kind: Match.Kind, delta: Int) = match.adjust(config, side, kind, delta)?.let { update(it) }
    private fun adjustPoint(side: Side, delta: Int) = match.adjustPoint(config, side, delta)?.let { update(it) }

    private fun editName(input: EditText) {
        input.isFocusableInTouchMode = true
        input.isFocusable = true
        input.requestFocus()
        input.selectAll()
        getSystemService(InputMethodManager::class.java).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun finishName(input: EditText) {
        if (!input.isFocusable) return
        input.isFocusable = false
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(input.windowToken, 0)
        val names = match.names.let {
            if (input === panels.getValue(Side.left).name) it.copy(left = input.text.toString()) else it.copy(right = input.text.toString())
        }
        match = match.copy(names = names)
        repo.saveMatch(match)
    }

    private fun newMatch() {
        if (!match.hasProgress) return update(match.reset())
        ask(getString(R.string.new_match_title), getString(R.string.confirm_new), getString(R.string.new_match_ok)) {
            val r = Result.of(
                UUID.randomUUID().toString(), System.currentTimeMillis(),
                match.names.left.ifBlank { getString(R.string.team_a) },
                match.names.right.ifBlank { getString(R.string.team_b) },
                match.currentSets(),
            )
            scope.launch {
                try {
                    withContext(Dispatchers.IO) { repo.saveResult(r) }
                } catch (e: Exception) {
                    // Sin guardar no se reinicia: el marcador sigue ahí para no perder el partido.
                    android.util.Log.e("padel", "could not save result", e)
                    toast(getString(R.string.result_save_failed, e.message ?: e.toString()))
                    return@launch
                }
                update(match.reset())
            }
        }
    }

    // ---------- pintado ----------

    private fun render() {
        for (side in Side.entries) {
            val p = panels.getValue(side)
            val s = match.now[side]
            val pt = match.point(side)
            p.points.text = pt.text
            p.points.setTextColor(col(if (pt.ad) R.color.padel_win else R.color.padel_text))
            val showSets = match.showSets(config)
            p.sets.root.visibility = if (showSets) View.VISIBLE else View.GONE
            paintMeta(p.sets, s.s, if (config.sets == 1) 0 else config.sets)
            paintMeta(p.games, s.g, 0)
            p.pointMinus.isEnabled = match.canAdjustPoint(config, side, -1)
            p.pointPlus.isEnabled = match.canAdjustPoint(config, side, +1)
            p.pointMinus.alpha = if (p.pointMinus.isEnabled) 1f else 0.35f
            p.pointPlus.alpha = if (p.pointPlus.isEnabled) 1f else 0.35f
            p.serve.text = if (match.now.server == side) "● ${getString(R.string.serve)} ${match.player}" else ""
            p.tie.visibility = if (match.now.tiebreak) View.VISIBLE else View.INVISIBLE
            val name = if (side == Side.left) match.names.left else match.names.right
            if (!p.name.isFocusable && p.name.text.toString() != name) p.name.setText(name)
            p.name.hint = getString(if (side == Side.left) R.string.team_a else R.string.team_b).uppercase()
        }
        court.show(match.now.server, match.courtSide)
    }

    private fun paintMeta(row: MetaRow, value: Int, total: Int) {
        row.value.text = value.toString()
        row.total.text = if (total > 0) "/$total" else ""
        row.minus.isEnabled = value > 0
        row.minus.alpha = if (value > 0) 1f else 0.35f
    }

    // ---------- opciones ----------

    private fun openOptions() {
        val (dialog, body) = sheet(getString(R.string.options_h))
        fun paint() {
            body.removeAllViews()
            body.addView(label(getString(R.string.match_sets).uppercase(), 13f, col(R.color.padel_muted), bold = true).apply { setPadding(0, px(8), 0, px(8)) })
            body.addView(segmented(Config.SETS.map { it to it.toString() }, config.sets) { n ->
                config = config.copy(sets = n)
                repo.saveConfig(config)
                update(match.reconfigured(config))
                paint()
            })
            body.addView(label(getString(when (config.sets) { 1 -> R.string.desc_sets1; 3 -> R.string.desc_sets3; else -> R.string.desc_sets5 }), 14f, col(R.color.padel_muted)).apply { setPadding(0, px(8), 0, px(18)) })
            body.addView(label(getString(R.string.scoring_mode).uppercase(), 13f, col(R.color.padel_muted), bold = true).apply { setPadding(0, 0, 0, px(8)) })
            body.addView(segmented(listOf(
                Scoring.advantage to getString(R.string.advantage),
                Scoring.star to getString(R.string.double_adv),
                Scoring.golden to getString(R.string.golden),
            ), config.scoring) { s ->
                config = config.copy(scoring = s)
                repo.saveConfig(config)
                render()
                paint()
            })
            body.addView(label(getString(when (config.scoring) {
                Scoring.advantage -> R.string.desc_advantage
                Scoring.star -> R.string.desc_star
                Scoring.golden -> R.string.desc_golden
            }), 14f, col(R.color.padel_muted)).apply { setPadding(0, px(8), 0, px(8)) })
        }
        paint()
        dialog.show()
    }

    // ---------- resultados ----------

    private fun openResults() {
        val (dialog, body) = sheet(getString(R.string.results_h))
        val fmt = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())
        fun paint() {
            scope.launch {
                val list = try {
                    withContext(Dispatchers.IO) { repo.results() }
                } catch (e: Exception) {
                    android.util.Log.e("padel", "could not read results", e)
                    body.removeAllViews()
                    body.addView(label(getString(R.string.results_load_failed, e.message ?: e.toString()), 15f, col(R.color.padel_muted)))
                    return@launch
                }
                body.removeAllViews()
                if (list.isEmpty()) {
                    body.addView(label(getString(R.string.no_results), 15f, col(R.color.padel_muted)).apply { setPadding(0, px(16), 0, px(16)) })
                    return@launch
                }
                for (r in list.sortedByDescending { it.date }) body.addView(resultRow(r, fmt) { id ->
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { repo.deleteResult(id) }
                        } catch (e: Exception) {
                            android.util.Log.e("padel", "could not delete result", e)
                            toast(getString(R.string.result_delete_failed, e.message ?: e.toString()))
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
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(label(fmt.format(Date(r.date)), 12f, col(R.color.padel_muted)))
            addView(label(
                "${if (leftWins) "🏆 " else ""}${r.left} ${r.setsLeft} — ${r.setsRight} ${r.right}${if (rightWins) " 🏆" else ""}",
                16f, col(R.color.padel_text), bold = true,
            ))
            addView(label(r.sets.joinToString("  ") { "${it.left}-${it.right}" }, 13f, col(R.color.padel_muted)))
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(10), 0, px(10))
            tag = "result-${r.id}"
            addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(button(getString(R.string.delete), danger = true) { onDelete(r.id) })
        }
    }
}
