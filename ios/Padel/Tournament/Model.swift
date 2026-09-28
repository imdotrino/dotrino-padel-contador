import Foundation

// El torneo, con la MISMA forma que el documento que guarda la PWA en `padel.tournaments`
// (src/tournament/engine.js). Los modos van como texto, igual que en el JSON, y son clases
// porque el motor los edita en el sitio, como el de la PWA. El mismo modelo que `Model.kt`.

final class ScoreKind: Codable, Equatable {
    var on: Bool
    var points: Int
    init(_ on: Bool, _ points: Int) { self.on = on; self.points = points }
    static func == (a: ScoreKind, b: ScoreKind) -> Bool { a.on == b.on && a.points == b.points }
}

final class ScoringRules: Codable, Equatable {
    var games: ScoreKind
    var sets: ScoreKind
    var match: ScoreKind
    init(games: ScoreKind, sets: ScoreKind, match: ScoreKind) { self.games = games; self.sets = sets; self.match = match }
    subscript(kind: String) -> ScoreKind {
        switch kind {
        case "games": return games
        case "sets": return sets
        case "match": return match
        default: preconditionFailure("unknown scoring kind: \(kind)")
        }
    }
    static func == (a: ScoringRules, b: ScoringRules) -> Bool { a.games == b.games && a.sets == b.sets && a.match == b.match }
}

final class Settings: Codable, Equatable {
    var partners = "rotating"
    var pairing = "random"
    /// "auto" = una cancha por cada 4 jugadores (2 parejas); "fixed" = las de `courts`.
    var courtsMode = "auto"
    var courts = 2
    var limitType = "everyone"
    var limitValue = 3
    var scoring = ScoringRules(games: ScoreKind(true, 1), sets: ScoreKind(false, 2), match: ScoreKind(true, 3))
    var matchEnd = "time"
    var matchMinutes = 12
    var gamesPerMatch = 6

    init() {}

    func copy() -> Settings {
        let s = Settings()
        s.partners = partners; s.pairing = pairing; s.courtsMode = courtsMode; s.courts = courts
        s.limitType = limitType; s.limitValue = limitValue
        s.scoring = ScoringRules(games: ScoreKind(scoring.games.on, scoring.games.points),
                                 sets: ScoreKind(scoring.sets.on, scoring.sets.points),
                                 match: ScoreKind(scoring.match.on, scoring.match.points))
        s.matchEnd = matchEnd; s.matchMinutes = matchMinutes; s.gamesPerMatch = gamesPerMatch
        return s
    }

    static func == (a: Settings, b: Settings) -> Bool {
        a.partners == b.partners && a.pairing == b.pairing && a.courtsMode == b.courtsMode && a.courts == b.courts &&
            a.limitType == b.limitType && a.limitValue == b.limitValue && a.scoring == b.scoring &&
            a.matchEnd == b.matchEnd && a.matchMinutes == b.matchMinutes && a.gamesPerMatch == b.gamesPerMatch
    }
}

final class Player: Codable {
    let id: String
    var name: String
    var active: Bool
    init(id: String, name: String, active: Bool) { self.id = id; self.name = name; self.active = active }
}

final class Team: Codable {
    let id: String
    let players: [String]
    var active: Bool
    init(id: String, players: [String], active: Bool) { self.id = id; self.players = players; self.active = active }
}

/// Un marcador de juegos o de sets; un lado puede faltar mientras se escribe.
struct Score: Codable, Equatable {
    var a: Int?
    var b: Int?
}

/// El cronómetro de la ronda: guarda INSTANTES, no un contador que avanza.
final class Clock: Codable {
    let minutes: Int
    var runningSince: Int64?
    var elapsedMs: Int64
    init(minutes: Int, runningSince: Int64?, elapsedMs: Int64) { self.minutes = minutes; self.runningSince = runningSince; self.elapsedMs = elapsedMs }
}

final class TMatch: Codable {
    let id: String
    let court: Int
    let a: [String]
    let b: [String]
    let teams: [String]?
    var score: Score?
    var sets: Score?
    init(id: String, court: Int, a: [String], b: [String], teams: [String]?) {
        self.id = id; self.court = court; self.a = a; self.b = b; self.teams = teams
    }
}

final class Round: Codable {
    let id: String
    let matches: [TMatch]
    let rest: [String]
    var clock: Clock?
    init(id: String, matches: [TMatch], rest: [String]) { self.id = id; self.matches = matches; self.rest = rest }
}

/// La clave del enlace para mirar en vivo (solo del organizador; no se emite).
struct ShareRef: Codable, Equatable {
    let key: String
    let secret: String
}

final class Tournament: Codable, Identifiable {
    let id: String
    var name: String
    let createdAt: Int64
    var updatedAt: Int64
    var rulesetId: String?
    var settings: Settings
    var players: [Player] = []
    var teams: [Team] = []
    var rounds: [Round] = []
    var share: ShareRef?

    init(id: String, name: String, createdAt: Int64, rulesetId: String?, settings: Settings) {
        self.id = id; self.name = name; self.createdAt = createdAt; self.updatedAt = createdAt
        self.rulesetId = rulesetId; self.settings = settings
    }
}

/// Un set de reglas del usuario (`padel.rulesets`); los de fábrica llevan `builtin`.
struct Ruleset: Codable, Identifiable {
    let id: String
    var name: String
    var createdAt: Int64 = 0
    var settings: Settings
    var builtin: Bool? = nil
}

struct Standing: Codable, Equatable {
    let id: String
    let active: Bool
    var played = 0, won = 0, drawn = 0, lost = 0
    var setsFor = 0, setsAgainst = 0, gamesFor = 0, gamesAgainst = 0
    var points = 0
}

struct TStatus: Codable, Equatable {
    let scheduled: Int
    let scored: Int
    let reached: Bool
    let finished: Bool
}

struct Estimate: Codable, Equatable {
    let matches: Int
    let rounds: Int
    let exact: Bool
}

struct ClockState: Codable, Equatable {
    let state: String
    let remainingMs: Int64
    let minutes: Int
}
