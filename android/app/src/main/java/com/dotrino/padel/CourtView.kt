package com.dotrino.padel

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * La mini cancha (vista superior, apaisada): red vertical en el centro, mitad izquierda = pareja
 * izquierda. El que saca está en SU mitad y sirve cruzado a la caja del rival. R/L = derecha o
 * izquierda del que saca mirando a la red. El mismo dibujo que `courtSvg` de la PWA, en un
 * lienzo de 100×64.
 */
class CourtView(context: Context) : View(context) {
    private var server = Side.left
    private var courtSide = CourtSide.R
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.argb(217, 255, 255, 255) }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val win = Color.parseColor("#FDE047")

    fun show(server: Side, courtSide: CourtSide) {
        if (server == this.server && courtSide == this.courtSide) return
        this.server = server
        this.courtSide = courtSide
        invalidate()
    }

    override fun onMeasure(w: Int, h: Int) {
        val width = MeasureSpec.getSize(w)
        setMeasuredDimension(width, width * 64 / 100)
    }

    override fun onDraw(c: Canvas) {
        val k = width / 100f
        fun x(v: Float) = v * k
        val left = server == Side.left
        // left mira a la derecha: R = abajo, L = arriba. right mira a la izquierda: R = arriba, L = abajo.
        val srvTop = if (left) courtSide == CourtSide.L else courtSide == CourtSide.R
        val recTop = !srvTop
        val boxX = { l: Boolean -> if (l) 28f else 50f }
        val centerX = { l: Boolean -> if (l) 39f else 61f }
        val centerY = { top: Boolean -> if (top) 18f else 46f }

        line.strokeWidth = 2 * k
        c.drawRect(x(4f), x(4f), x(96f), x(60f), line)
        line.strokeWidth = 2.6f * k
        c.drawLine(x(50f), 0f, x(50f), x(64f), line)
        line.strokeWidth = 1 * k
        c.drawLine(x(28f), x(4f), x(28f), x(60f), line)
        c.drawLine(x(72f), x(4f), x(72f), x(60f), line)
        c.drawLine(x(28f), x(32f), x(72f), x(32f), line)

        fill.color = Color.argb(46, 255, 255, 255)
        val rx = boxX(!left)
        val ry = if (recTop) 4f else 32f
        c.drawRect(x(rx), x(ry), x(rx + 22), x(ry + 28), fill)
        fill.color = Color.argb(140, 253, 224, 71)
        val sx = boxX(left)
        val sy = if (srvTop) 4f else 32f
        c.drawRect(x(sx), x(sy), x(sx + 22), x(sy + 28), fill)

        // La flecha del saque, cruzada.
        val ax = x(centerX(left)); val ay = x(centerY(srvTop))
        val ex = x(centerX(!left)); val ey = x(centerY(recTop))
        line.color = win
        line.strokeWidth = 2.4f * k
        c.drawLine(ax, ay, ex, ey, line)
        val a = atan2(ey - ay, ex - ax)
        val head = 4.5f * k
        fill.color = win
        c.drawPath(Path().apply {
            moveTo(ex, ey)
            lineTo(ex - head * cos(a - 0.45f), ey - head * sin(a - 0.45f))
            lineTo(ex - head * cos(a + 0.45f), ey - head * sin(a + 0.45f))
            close()
        }, fill)
        line.color = Color.argb(217, 255, 255, 255)
        fill.color = Color.WHITE
        c.drawCircle(ax, ay, 2.8f * k, fill)
    }
}
