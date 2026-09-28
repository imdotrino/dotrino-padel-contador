package com.dotrino.padel.tournament

import kotlinx.serialization.Serializable

// El torneo, con la MISMA forma que el documento que guarda la PWA en `padel.tournaments`
// (src/tournament/engine.js). Los modos van como texto, igual que en el JSON, y los objetos
// son mutables porque el motor los edita en el sitio, como el de la PWA.

@Serializable
data class ScoreKind(var on: Boolean, var points: Int)

@Serializable
data class ScoringRules(var games: ScoreKind, var sets: ScoreKind, var match: ScoreKind) {
    operator fun get(kind: String) = when (kind) {
        "games" -> games
        "sets" -> sets
        "match" -> match
        else -> throw IllegalArgumentException("unknown scoring kind: $kind")
    }
}

@Serializable
data class Settings(
    var partners: String = "rotating",
    var pairing: String = "random",
    // Canchas: "auto" = una por cada 4 jugadores (2 parejas); "fixed" = las de `courts`.
    var courtsMode: String = "auto",
    var courts: Int = 2,
    var limitType: String = "everyone",
    var limitValue: Int = 3,
    var scoring: ScoringRules = ScoringRules(ScoreKind(true, 1), ScoreKind(false, 2), ScoreKind(true, 3)),
    var matchEnd: String = "time",
    var matchMinutes: Int = 12,
    var gamesPerMatch: Int = 6,
) {
    fun deepCopy() = copy(scoring = ScoringRules(scoring.games.copy(), scoring.sets.copy(), scoring.match.copy()))
}

@Serializable
data class Player(val id: String, var name: String, var active: Boolean)

@Serializable
data class Team(val id: String, val players: List<String>, var active: Boolean)

/** Un marcador de juegos o de sets; un lado puede faltar mientras se escribe. */
@Serializable
data class Score(val a: Int?, val b: Int?)

/** El cronómetro de la ronda: guarda INSTANTES, no un contador que avanza. */
@Serializable
data class Clock(val minutes: Int, var runningSince: Long?, var elapsedMs: Long)

@Serializable
data class TMatch(
    val id: String,
    val court: Int,
    val a: List<String>,
    val b: List<String>,
    val teams: List<String>?,
    var score: Score?,
    var sets: Score?,
)

@Serializable
data class Round(val id: String, val matches: List<TMatch>, val rest: List<String>, var clock: Clock?)

/** La clave del enlace para mirar en vivo (solo del organizador; no se emite). */
@Serializable
data class ShareRef(val key: String, val secret: String)

@Serializable
data class Tournament(
    val id: String,
    var name: String,
    val createdAt: Long,
    var updatedAt: Long,
    var rulesetId: String?,
    var settings: Settings,
    var players: MutableList<Player>,
    var teams: MutableList<Team>,
    var rounds: MutableList<Round>,
    var share: ShareRef? = null,
)

/** Un set de reglas del usuario (`padel.rulesets`); los de fábrica llevan `builtin`. */
@Serializable
data class Ruleset(
    val id: String,
    val name: String,
    val createdAt: Long = 0,
    val settings: Settings,
    val builtin: Boolean = false,
)

@Serializable
data class Standing(
    val id: String,
    val active: Boolean,
    var played: Int = 0,
    var won: Int = 0,
    var drawn: Int = 0,
    var lost: Int = 0,
    var setsFor: Int = 0,
    var setsAgainst: Int = 0,
    var gamesFor: Int = 0,
    var gamesAgainst: Int = 0,
    var points: Int = 0,
)

@Serializable
data class Status(val scheduled: Int, val scored: Int, val reached: Boolean, val finished: Boolean)

@Serializable
data class Estimate(val matches: Int, val rounds: Int, val exact: Boolean)

@Serializable
data class ClockState(val state: String, val remainingMs: Long, val minutes: Int)
