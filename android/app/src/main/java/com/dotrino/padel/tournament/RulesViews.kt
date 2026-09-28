package com.dotrino.padel.tournament

import android.app.Activity
import android.graphics.Typeface
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
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

// Las piezas de las reglas, en vistas nativas: la regla que se lee como texto con «Editar»
// al lado, los contadores, los interruptores de puntos y el formulario entero. Las usan la
// pestaña Reglas, el modal de reglas y la pestaña Torneo (el nombre).

private val INFOS = setOf("partners", "pairing", "courts", "limit", "scoring", "matchEnd")
private val LABELS = mapOf("name" to "name", "rulesetName" to "rulesetName", "partners" to "partners", "pairing" to "pairing",
    "courts" to "courts", "limit" to "limit", "scoring" to "scoring", "matchEnd" to "matchEnd")

fun Activity.sectionLabel(text: String) = label(text.uppercase(), 13f, col(R.color.padel_muted), bold = true).apply { letterSpacing = 0.05f }

fun Activity.hint(text: String, warn: Boolean = false) =
    label(text, 13f, if (warn) 0xFFF87171.toInt() else col(R.color.padel_muted)).apply { setPadding(0, px(4), 0, px(4)) }

/**
 * Una regla: se LEE como texto, con «Editar» al lado; al pulsarlo aparecen sus opciones y su
 * explicación. `editor` se pinta solo si está abierta. `warn`: en rojo, y `note` dice qué pasará.
 */
fun Activity.rule(c: TournamentController, key: String, text: String, editable: Boolean = true, note: String = "",
                  warn: Boolean = false, editor: () -> View): View {
    val open = editable && c.openRule == key
    val label = t(LABELS.getValue(key))
    val red = 0xFFF87171.toInt()
    return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, px(12), 0, px(12))
        tag = "rule-$key"
        val line = LinearLayout(this@rule).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val main = LinearLayout(this@rule).apply {
                orientation = LinearLayout.VERTICAL
                addView(sectionLabel(label))
                addView(label(text, 16f, if (warn) red else col(R.color.padel_text), bold = true).apply { tag = "rule-$key-text"; setPadding(0, px(3), 0, 0) })
                if (note.isNotEmpty()) addView(hint(note, warn))
            }
            addView(main, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(button(t(if (open) "ruleDone" else "ruleEdit")) { c.toggleRule(key) }.apply {
                isEnabled = editable
                alpha = if (editable) 1f else 0.45f
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                if (open) setTextColor(col(R.color.padel_accent))
                contentDescription = t(if (open) "ruleDoneAria" else "ruleEditAria", "rule" to label)
                tag = "edit-$key"
            })
        }
        addView(line)
        if (open) addView(LinearLayout(this@rule).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, px(12), 0, 0)
            if (key in INFOS) addView(label(t("info_$key"), 14f, 0xFFCBD5E1.toInt()).apply { setPadding(0, 0, 0, px(10)) })
            addView(editor())
        })
        addView(View(this@rule).apply { setBackgroundColor(col(R.color.padel_surface2)) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(1)).apply { topMargin = px(12) })
    }
}

/** Un contador «− valor +». `disabled`: se ve pero no se toca (su valor no aplica ahora). */
fun Activity.stepper(value: Int, shown: String, range: IntRange, step: Int = 1, disabled: Boolean = false, testId: String, onStep: (Int) -> Unit): View =
    LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = rounded(0, px(10), px(1), col(R.color.padel_border))
        alpha = if (disabled) 0.55f else 1f
        fun b(text: String, delta: Int, enabled: Boolean, id: String) = TextView(this@stepper).apply {
            this.text = text
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTextColor(col(R.color.padel_text))
            isEnabled = enabled && !disabled
            alpha = if (isEnabled) 1f else 0.35f
            tag = id
            contentDescription = (if (delta > 0) "+" else "−") + step
            setOnClickListener { onStep(delta) }
        }
        addView(b("−", -step, value > range.first, "$testId-minus"), LinearLayout.LayoutParams(px(44), px(40)))
        addView(label(shown, 16f, col(R.color.padel_text), bold = true).apply { gravity = Gravity.CENTER; minWidth = px(44); tag = "$testId-value" })
        addView(b("+", step, value < range.last, "$testId-plus"), LinearLayout.LayoutParams(px(44), px(40)))
    }

private fun Activity.row(vararg views: View) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(0, px(10), 0, 0)
    for (v in views) addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = px(12) })
}

private fun Activity.unit(text: String) = label(text, 14f, col(R.color.padel_muted))

/** El formulario de reglas (pestaña Reglas o modal). `close` = cerrar el modal si es el modal. */
fun Activity.rulesForm(c: TournamentController, close: () -> Unit): View {
    val tour = c.rulesTour()
    val f = c.formFor(tour)
    val s = f.settings
    val est = c.estimateText(tour, s)
    val over = c.courtsOver(tour, s)
    val builtin = f.source == "builtin"
    val others = c.usedByOthers(f)
    val conflicts = Engine.settingsConflicts(s)
    fun clashNote(key: String) = if (key in conflicts) t("conflictRankedEveryone", "limit" to t("limitEveryone_${s.partners}")) else ""
    return LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        tag = "rules-form"
        addView(rule(c, "rulesetName", f.name) {
            EditText(this@rulesForm).apply {
                setText(f.name)
                setTextColor(col(R.color.padel_text))
                background = rounded(col(R.color.padel_bg), px(10), px(1), col(R.color.padel_border))
                setPadding(px(12), px(10), px(12), px(10))
                filters = arrayOf(InputFilter.LengthFilter(40))
                isSingleLine = true
                tag = "ruleset-name"
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                    override fun onTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                    override fun afterTextChanged(e: Editable?) { f.name = e.toString() }
                })
                post { requestFocus() }
            }
        })
        addView(rule(c, "partners", t(if (s.partners == "rotating") "partnersRotating" else "partnersFixed")) {
            segmented(listOf("rotating" to t("partnersRotating"), "fixed" to t("partnersFixed")), s.partners) { c.setRule("partners", it) }
        })
        addView(rule(c, "pairing", t(if (s.pairing == "random") "pairingRandom" else "pairingRanked"), note = clashNote("pairing"), warn = "pairing" in conflicts) {
            segmented(listOf("random" to t("pairingRandom"), "ranked" to t("pairingRanked")), s.pairing) { c.setRule("pairing", it) }
        })
        addView(rule(c, "courts", c.courtsSummary(tour, s), note = over, warn = over.isNotEmpty()) {
            val auto = s.courtsMode == "auto"
            val max = Engine.maxCourts(tour.copy(settings = s))
            val value = if (auto) max else s.courts
            LinearLayout(this@rulesForm).apply {
                orientation = LinearLayout.VERTICAL
                addView(segmented(listOf("auto" to t("courtsModeAuto"), "fixed" to t("courtsModeFixed")), s.courtsMode) { c.setRule("courtsMode", it) })
                addView(row(stepper(value, if (auto && max < 1) "—" else "$value", TournamentController.RANGES.getValue("courts"), disabled = auto, testId = "courts") { c.step("courts", it) },
                    unit(tn("unit_courts", value))))
            }
        })
        addView(rule(c, "limit", c.limitSummary(tour, s) + if (est.isNotEmpty()) " · $est" else "", note = clashNote("limit"), warn = "limit" in conflicts) {
            val everyone = s.limitType == "everyone"
            val each = if (everyone) Engine.everyoneMatchesEach(tour.copy(settings = s)) else null
            val value = if (everyone) each ?: 0 else s.limitValue
            LinearLayout(this@rulesForm).apply {
                orientation = LinearLayout.VERTICAL
                addView(segmented(listOf("perPlayer" to t("limitPerPlayer"), "rounds" to t("limitRounds"), "matches" to t("limitMatches"),
                    "everyone" to t("limitEveryone_${s.partners}")), s.limitType) { c.setRule("limitType", it) })
                addView(row(stepper(value, if (everyone && each == null) "—" else "$value", TournamentController.RANGES.getValue("limitValue"), disabled = everyone, testId = "limitValue") { c.step("limitValue", it) },
                    unit(tn(if (everyone) "unit_perPlayer" else "unit_${s.limitType}", value))))
                addView(hint(est).apply { tag = "estimate" })
            }
        })
        addView(rule(c, "scoring", c.scoringSummary(s)) {
            val on = Engine.SCORE_KINDS.filter { s.scoring[it].on }
            LinearLayout(this@rulesForm).apply {
                orientation = LinearLayout.VERTICAL
                for (k in Engine.SCORE_KINDS) {
                    val x = s.scoring[k]
                    val last = x.on && on.size == 1
                    val toggle = TextView(this@rulesForm).apply {
                        text = (if (x.on) "✓ " else "") + t("scoring_$k")
                        gravity = Gravity.CENTER
                        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                        setTypeface(typeface, Typeface.BOLD)
                        setTextColor(if (x.on) col(R.color.padel_on_accent) else col(R.color.padel_text))
                        background = rounded(if (x.on) col(R.color.padel_accent) else col(R.color.padel_bg), px(8), px(1), col(R.color.padel_border))
                        setPadding(px(10), px(10), px(10), px(10))
                        isEnabled = !last
                        tag = "scoring-$k"
                        setOnClickListener { c.toggleScoring(k) }
                    }
                    addView(LinearLayout(this@rulesForm).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(0, px(6), 0, px(6))
                        addView(toggle, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = px(10) })
                        addView(stepper(x.points, "${x.points}", TournamentController.RANGES.getValue("points"), disabled = !x.on, testId = "points-$k") { c.step("points-$k", it) })
                        addView(unit(t("unit_points")).apply { setPadding(px(8), 0, 0, 0) })
                    })
                }
            }
        })
        addView(rule(c, "matchEnd", c.matchEndSummary(s)) {
            val time = s.matchEnd == "time"
            LinearLayout(this@rulesForm).apply {
                orientation = LinearLayout.VERTICAL
                addView(segmented(listOf("time" to t("matchEndTime"), "games" to t("matchEndGames")), s.matchEnd) { c.setRule("matchEnd", it) })
                addView(row(stepper(s.matchMinutes, "${s.matchMinutes}", TournamentController.RANGES.getValue("matchMinutes"), disabled = !time, testId = "matchMinutes") { c.step("matchMinutes", it) },
                    unit(t("unit_minutes"))))
                addView(row(stepper(s.gamesPerMatch, if (s.gamesPerMatch > 0) "${s.gamesPerMatch}" else t("free"), TournamentController.RANGES.getValue("gamesPerMatch"), disabled = time, testId = "gamesPerMatch") { c.step("gamesPerMatch", it) },
                    unit(tn("unit_games", s.gamesPerMatch))))
            }
        })
        if (conflicts.isNotEmpty()) addView(hint(t("rulesConflictSave"), warn = true).apply { tag = "rules-conflict" })
        if (builtin) addView(hint(t("rulesetBuiltinNote")).apply { tag = "builtin-note" })
        if (others > 0) addView(hint(tn("rulesetUsedByPast", others)).apply { tag = "used-by-past" })
        addView(LinearLayout(this@rulesForm).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, px(16), 0, 0)
            val updateOff = builtin || others > 0 || conflicts.isNotEmpty()
            addView(button(t("rulesetUpdate"), filled = others == 0) { c.updateRuleset(close) }.apply {
                isEnabled = !updateOff; alpha = if (updateOff) 0.45f else 1f; tag = "update-ruleset"
            })
            addView(button(t("rulesetSaveNew"), filled = others > 0) { c.saveRuleset(close) }.apply {
                isEnabled = conflicts.isEmpty(); alpha = if (conflicts.isEmpty()) 1f else 0.45f; tag = "save-ruleset"
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = px(8) })
        })
    }
}

/** Un set en una lista: el nombre y sus fichas. `on`: el elegido (Torneo) o el que se edita (Reglas). */
fun Activity.rulesetCard(c: TournamentController, tour: Tournament, set: Ruleset, on: Boolean, blocked: Boolean, testId: String, onClick: () -> Unit): View =
    LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(px(14), px(12), px(14), px(12))
        background = rounded(if (on) 0x1AF59E0B else col(R.color.padel_surface), px(12), px(1), if (on) col(R.color.padel_accent) else col(R.color.padel_border))
        alpha = if (blocked) 0.55f else 1f
        isEnabled = !blocked
        tag = testId
        isSelected = on
        addView(label((if (on) "● " else "○ ") + set.name, 16f, col(R.color.padel_text), bold = true))
        val chips = FlowLayout(this@rulesetCard)
        for ((text, warn) in c.rulesChips(tour, set.settings)) {
            chips.addView(label(text, 12f, if (warn) 0xFFF87171.toInt() else if (on) col(R.color.padel_text) else col(R.color.padel_muted), bold = true).apply {
                background = rounded(col(R.color.padel_bg), px(100), px(1), if (warn) 0xFFF87171.toInt() else col(R.color.padel_border))
                setPadding(px(8), px(2), px(8), px(2))
            })
        }
        addView(chips, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = px(8) })
        if (blocked) addView(hint(t("rulesetBlocked")))
        setOnClickListener { if (!blocked) onClick() }
    }

/** Las fichas van en filas que se parten (el `flex-wrap` de la PWA). */
class FlowLayout(context: android.content.Context) : ViewGroup(context) {
    private val gap = (6 * context.resources.displayMetrics.density).toInt()

    override fun onMeasure(widthSpec: Int, heightSpec: Int) {
        val width = MeasureSpec.getSize(widthSpec)
        var x = 0; var y = 0; var line = 0
        for (i in 0 until childCount) {
            val ch = getChildAt(i)
            measureChild(ch, MeasureSpec.makeMeasureSpec(width, MeasureSpec.AT_MOST), heightSpec)
            if (x > 0 && x + ch.measuredWidth > width) { x = 0; y += line + gap; line = 0 }
            x += ch.measuredWidth + gap
            line = maxOf(line, ch.measuredHeight)
        }
        setMeasuredDimension(width, y + line)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val width = r - l
        var x = 0; var y = 0; var line = 0
        for (i in 0 until childCount) {
            val ch = getChildAt(i)
            if (x > 0 && x + ch.measuredWidth > width) { x = 0; y += line + gap; line = 0 }
            ch.layout(x, y, x + ch.measuredWidth, y + ch.measuredHeight)
            x += ch.measuredWidth + gap
            line = maxOf(line, ch.measuredHeight)
        }
    }
}
