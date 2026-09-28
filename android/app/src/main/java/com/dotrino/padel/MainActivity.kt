package com.dotrino.padel

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.dotrino.padel.tournament.ClockState
import com.dotrino.padel.tournament.Engine
import com.dotrino.padel.tournament.Host
import com.dotrino.padel.tournament.MatchesRefs
import com.dotrino.padel.tournament.TMatch
import com.dotrino.padel.tournament.Tournament
import com.dotrino.padel.tournament.TournamentController
import com.dotrino.padel.tournament.TournamentRepo
import com.dotrino.padel.tournament.matchesTab
import com.dotrino.padel.tournament.rulesForm
import com.dotrino.padel.tournament.rulesTab
import com.dotrino.padel.tournament.setupTab
import com.dotrino.padel.tournament.tableTab
import com.dotrino.padel.tournament.tickClocks
import com.dotrino.sdk.ui.DotrinoLocale
import com.dotrino.sdk.ui.DotrinoTopbar

/**
 * La app: el marcador (la portada) y las pestañas del torneo, como la PWA. «Volver» desde una
 * pestaña regresa al marcador; desde el marcador, sale.
 */
class MainActivity : Activity(), TournamentController.Ui, Host {
    companion object {
        private val TABS = listOf("score", "setup", "rules", "table", "matches")
        private val TAB_LABELS = mapOf("score" to "tabScore", "setup" to "tabSetup", "rules" to "tabRules", "table" to "tabTable", "matches" to "tabMatches")
        private const val TAB_KEY = "tab"
    }

    private lateinit var repo: Repo
    private lateinit var tours: TournamentRepo
    private lateinit var c: TournamentController
    private lateinit var scoreboard: Scoreboard
    private lateinit var tabPage: LinearLayout
    private lateinit var tabScroll: ScrollView
    private val tabButtons = mutableMapOf<String, TextView>()
    private var tab = "score"
    private val refs = MatchesRefs()
    private var rulesModal: Pair<Dialog, LinearLayout>? = null
    private val main = Handler(Looper.getMainLooper())
    private val seenClock = mutableMapOf<String, String>()

    override fun attachBaseContext(base: Context) = super.attachBaseContext(DotrinoLocale.wrap(base))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        I18n.load(this)
        repo = Repo(this)
        tours = TournamentRepo(this)
        c = TournamentController(tours, this)
        tours.onError = { e -> toast(t("saveFailed", "reason" to (e.message ?: e.toString())), error = true) }
        scoreboard = Scoreboard(this, repo, object : Scoreboard.Hooks {
            override fun saveLinked(link: Match.Link, games: Pair<Int, Int>, sets: Pair<Int, Int>?) =
                c.saveLinkedResult(link.tournamentId, link.matchId, games, sets)
            override fun linkedSaved() { goTab("matches"); rerender() }
            override fun linkedClock(link: Match.Link, now: Long): ClockState? = c.clockForLink(link.tournamentId, link.roundId, now)
        })
        // La pestaña sobrevive a girar el teléfono, no a cerrar la app (como sessionStorage).
        tab = savedInstanceState?.getString(TAB_KEY)?.takeIf { it in TABS } ?: "score"
        setContentView(layout())
        setTab(tab)
        tours.load { rerender(); scoreboard.render() }
        tick()
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        out.putString(TAB_KEY, tab)
    }

    // Lo que quedó sin escribir se escribe antes de que el sistema congele la app.
    override fun onPause() {
        tours.flush()
        super.onPause()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        scoreboard.dispose()
        super.onDestroy()
    }

    @Deprecated("Activity without AndroidX: the back button still comes here")
    override fun onBackPressed() {
        if (tab != "score") return setTab("score")
        @Suppress("DEPRECATION") super.onBackPressed()
    }

    // ---------- pantalla ----------

    private fun layout(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(col(R.color.padel_bg))
        fitsSystemWindows = true
        addView(topbar())
        addView(tabs())
        tabPage = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(px(16), px(16), px(16), px(16)) }
        tabScroll = ScrollView(this@MainActivity).apply { addView(tabPage); isFillViewport = true }
        addView(FrameLayout(this@MainActivity).apply {
            addView(scoreboard.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(tabScroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
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
            brand = DotrinoTopbar.Brand("Padel", R.drawable.padel_brand),
            actions = listOf(
                action(t("rulesBtn").uppercase(), "rules-btn") { openRules(null) },
                action(t("results").uppercase(), "results-btn") { scoreboard.openResults() },
            ),
        ) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://dotrino.com/"))) }.view
    }

    private fun tabs(): View = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(col(R.color.padel_bg))
        for (name in TABS) {
            val b = label(t(TAB_LABELS.getValue(name)), 14f, col(R.color.padel_muted), bold = true).apply {
                gravity = Gravity.CENTER
                isSingleLine = true
                setPadding(px(2), px(12), px(2), px(12))
                tag = "tab-$name"
                setOnClickListener { setTab(name) }
            }
            tabButtons[name] = b
            addView(b, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
    }

    private fun setTab(name: String) {
        check(name in TABS) { "unknown tab: $name" }
        tab = name
        for ((n, b) in tabButtons) {
            val on = n == name
            b.setTextColor(col(if (on) R.color.padel_text else R.color.padel_muted))
            b.background = if (on) android.graphics.drawable.LayerDrawable(arrayOf(
                android.graphics.drawable.ColorDrawable(col(R.color.padel_bg)),
                android.graphics.drawable.ColorDrawable(col(R.color.padel_accent)),
            )).apply { setLayerInset(1, 0, b.height.coerceAtLeast(px(44)) - px(3), 0, 0) } else null
            b.isSelected = on
        }
        scoreboard.view.visibility = if (name == "score") View.VISIBLE else View.GONE
        tabScroll.visibility = if (name == "score") View.GONE else View.VISIBLE
        if (name == "score") scoreboard.render() else renderTab()
    }

    private fun renderTab() {
        if (tab == "score") return
        tabPage.removeAllViews()
        when (tab) {
            "setup" -> setupTab(c, tabPage)
            "rules" -> rulesTab(c, tabPage, formHere = rulesModal == null)
            "table" -> tableTab(c, tabPage)
            "matches" -> matchesTab(c, tabPage, refs)
        }
    }

    /** El modal de reglas, desde cualquier pestaña. Sin `rulesetId`, con las del torneo abierto. */
    override fun openRules(rulesetId: String?) {
        c.loadForm(rulesetId)
        val (dialog, body) = sheet(t("rulesH"))
        rulesModal = dialog to body
        // Al cerrarse, el formulario vuelve a la pestaña Reglas.
        dialog.setOnDismissListener { rulesModal = null; rerender() }
        paintRulesModal()
        dialog.show()
        rerender()
    }

    private fun paintRulesModal() {
        val (dialog, body) = rulesModal ?: return
        body.removeAllViews()
        body.addView(rulesForm(c) { dialog.dismiss() })
    }

    // ---------- TournamentController.Ui / Host ----------

    override fun changed() = rerender()

    override fun rerender() {
        renderTab()
        paintRulesModal()
    }

    override fun ask(title: String, text: String, ok: String, danger: Boolean, onYes: () -> Unit) =
        (this as Activity).ask(title, text, ok, danger = danger, onYes = onYes)

    override fun toast(message: String, error: Boolean) = (this as Activity).toast(message)

    override fun goTab(tab: String) = setTab(tab)

    override fun linkedMatchId() = scoreboard.linkedMatchId()

    override fun playMatch(tour: Tournament, match: TMatch) = scoreboard.playLinked(tour, match) { ok -> if (ok) setTab("score") }

    // ---------- el reloj ----------

    /**
     * Un solo reloj para los cronómetros: el de la ronda en Partidos y la cuenta atrás del
     * partido en el marcador. Avisa UNA vez cuando uno llega a cero con la app abierta, y deja
     * la pantalla encendida mientras corre (el aviso tiene que sonar).
     */
    private fun tick() {
        val now = System.currentTimeMillis()
        val tour = if (tours.status == "ready") tours.active() else null
        var running = false
        tour?.rounds?.forEachIndexed { i, r ->
            if (r.clock == null) return@forEachIndexed
            val st = Engine.clockOf(tour, r, now)
            val before = seenClock[r.id]
            seenClock[r.id] = st.state
            if (st.state == "running") running = true
            if (before == "running" && st.state == "done") {
                ring()
                toast(t("timeUp", "n" to i + 1), false)
            }
        }
        if (tour != null && tab == "matches" && !tickClocks(tour, refs, now)) renderTab()
        scoreboard.tick(now)
        if (running) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        main.postDelayed({ tick() }, 500)
    }

    private fun ring() {
        try {
            ToneGenerator(AudioManager.STREAM_ALARM, 100).startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 1500)
        } catch (e: RuntimeException) {
            android.util.Log.e("padel", "could not play the time-up tone", e)
        }
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400, 200, 400), -1))
    }
}
