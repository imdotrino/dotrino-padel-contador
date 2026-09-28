package com.dotrino.padel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Las reglas del marcador de la PWA (src/scoreboard.js), una por prueba.
class MatchTest {
    private val golden = Config(Scoring.golden, 3)
    private val adv = Config(Scoring.advantage, 3)
    private val star = Config(Scoring.star, 3)

    private fun Match.points(c: Config, vararg sides: Side) = sides.fold(this) { m, s -> m.winPoint(c, s) }
    private fun Match.game(c: Config, side: Side) = points(c, side, side, side, side)
    private fun Match.games(c: Config, side: Side, n: Int) = (1..n).fold(this) { m, _ -> m.game(c, side) }
    private val L = Side.left
    private val R = Side.right

    @Test fun pointsRead015304() {
        var m = Match()
        val seen = mutableListOf(m.point(L).text)
        repeat(3) { m = m.winPoint(golden, L); seen += m.point(L).text }
        assertEquals(listOf("0", "15", "30", "40"), seen)
    }

    @Test fun goldenPointDecidesAt4040() {
        val m = Match().points(golden, L, L, L, R, R, R, R)
        assertEquals(0, m.now.left.g)
        assertEquals(1, m.now.right.g)
    }

    @Test fun advantageNeedsTwo() {
        var m = Match().points(adv, L, L, L, R, R, R, L)
        assertEquals(PointText("AD", true), m.point(L))
        m = m.winPoint(adv, R)
        assertEquals("40", m.point(L).text)
        assertEquals("40", m.point(R).text)
        m = m.points(adv, R, R)
        assertEquals(1, m.now.right.g)
    }

    @Test fun starPointGoesGoldenOnTheThirdDeuce() {
        // 40-40, AD L, deuce, AD R, deuce (5-5): the next point decides.
        val m = Match().points(star, L, L, L, R, R, R, L, R, R, L)
        assertEquals(5, m.now.left.p)
        assertEquals(5, m.now.right.p)
        val after = m.winPoint(star, R)
        assertEquals(1, after.now.right.g)
    }

    @Test fun serveChangesEveryGameAndPlayerRotates() {
        var m = Match()
        assertEquals(Side.left, m.now.server)
        assertEquals("P1", m.player)
        m = m.game(golden, L)
        assertEquals(Side.right, m.now.server)
        assertEquals("P1", m.player)
        m = m.game(golden, L)
        assertEquals("P2", m.player)
    }

    @Test fun setClosesAtSixByTwo() {
        val m = Match().games(golden, L, 6)
        assertEquals(1, m.now.left.s)
        assertEquals(listOf(SetScore(6, 0)), m.now.setsHistory)
        assertEquals(0, m.now.left.g)
    }

    @Test fun sixAllGoesToTiebreakAndSevenFiveCloses() {
        var m = Match().games(golden, L, 5).games(golden, R, 5).game(golden, L).game(golden, R)
        assertTrue(m.now.tiebreak)
        m = m.points(golden, L, L, L, L, L, L)
        assertEquals("6", m.point(L).text)
        m = m.winPoint(golden, L)
        assertFalse(m.now.tiebreak)
        assertEquals(listOf(SetScore(7, 6)), m.now.setsHistory)
        assertEquals(1, m.now.left.s)
    }

    @Test fun tiebreakServeChangesAfterFirstThenEveryTwo() {
        var m = Match().games(golden, L, 5).games(golden, R, 5).game(golden, L).game(golden, R)
        val first = m.now.server
        m = m.winPoint(golden, L)
        assertEquals(first.other, m.now.server)
        m = m.winPoint(golden, L)
        assertEquals(first.other, m.now.server)
        m = m.winPoint(golden, L)
        assertEquals(first, m.now.server)
    }

    @Test fun endlessNeverClosesASet() {
        val one = Config(Scoring.golden, 1)
        val m = Match().games(one, L, 8)
        assertEquals(8, m.now.left.g)
        assertEquals(0, m.now.left.s)
        assertFalse(m.showSets(one))
    }

    @Test fun undoReturnsTheLastSnapshot() {
        val a = Match().winPoint(golden, L)
        val b = a.winPoint(golden, R)
        assertEquals(a.now, b.undo()!!.now)
        assertNull(Match().undo())
    }

    @Test fun pointAdjustNeverClosesAGame() {
        val m = Match().points(golden, L, L, L)
        assertFalse(m.canAdjustPoint(golden, L, +1))
        assertNull(m.adjustPoint(golden, L, +1))
        assertTrue(m.canAdjustPoint(golden, L, -1))
        assertFalse(Match().canAdjustPoint(golden, L, -1))
    }

    @Test fun gameAdjustToSixAllStartsTiebreak() {
        val m = Match().games(golden, L, 5).games(golden, R, 5).game(golden, L)
            .adjust(golden, R, Match.Kind.g, +1)!!
        assertTrue(m.now.tiebreak)
        assertNull(Match().adjust(golden, L, Match.Kind.s, -1))
    }

    @Test fun resultCountsSetsWon() {
        val m = Match().games(golden, L, 6).games(golden, R, 2)
        val r = Result.of("x", 0, "A", "B", m.currentSets())
        assertEquals(listOf(SetScore(6, 0), SetScore(0, 2)), r.sets)
        assertEquals(1, r.setsLeft)
        assertEquals(1, r.setsRight)
    }
}
