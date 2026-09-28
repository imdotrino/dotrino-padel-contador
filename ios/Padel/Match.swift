import Foundation

// El marcador de un partido: puntos, juegos, sets, tie-break y saque. El mismo modelo que
// `src/scoreboard.js` de la PWA (que va delante, CONVENCIONES §16.1) y que `Match.kt` de
// Android; aquí solo la lógica, sin pantalla, para poder probarla.

enum Scoring: String, Codable, CaseIterable { case advantage, star, golden }

struct Config: Codable, Equatable {
    static let setOptions = [1, 3, 5]
    var scoring: Scoring = .golden
    var sets: Int = 3
}

/// p = puntos del juego actual (0..40 / ventaja, o nº en tie-break), g = juegos del set actual,
/// s = sets ganados.
struct SideScore: Codable, Equatable {
    var p = 0
    var g = 0
    var s = 0
}

struct SetScore: Codable, Equatable {
    var left: Int
    var right: Int
}

enum Side: String, Codable, CaseIterable {
    case left, right
    var other: Side { self == .left ? .right : .left }
}

enum CourtSide { case R, L }

struct Snapshot: Codable, Equatable {
    var left = SideScore()
    var right = SideScore()
    var server: Side = .left
    var gameNum = 0 // juegos jugados en el partido (rota el orden de saque P1/P2)
    var tiebreak = false
    var setsHistory: [SetScore] = [] // sets cerrados (juegos)

    subscript(side: Side) -> SideScore {
        get { side == .left ? left : right }
        set { if side == .left { left = newValue } else { right = newValue } }
    }
}

/// Lo que se ve en el panel de puntos: el texto y si es una ventaja.
struct PointText: Equatable {
    let text: String
    let ad: Bool
}

/// El partido en curso, con su pila de deshacer. Cada jugada deja una instantánea nueva y
/// guarda la anterior.
struct Match: Codable, Equatable {
    struct Names: Codable, Equatable {
        var left = ""
        var right = ""
    }

    enum Kind { case s, g }

    /// El partido del torneo que se juega en el marcador (`state.link` de la PWA); nil = suelto.
    /// `target`: a cuántos juegos (0 = sin límite); `timed`: por tiempo; `sets`: si cuenta sets.
    struct Link: Codable, Equatable {
        let tournamentId: String
        let tournamentName: String
        let matchId: String
        let roundId: String
        let round: Int
        let court: Int
        let timed: Bool
        let target: Int
        let sets: Bool
        let left: String
        let right: String
    }

    var now = Snapshot()
    var undoStack: [Snapshot] = []
    var names = Names()
    var link: Link?

    enum CodingKeys: String, CodingKey { case now, undoStack = "undo", names, link }

    /// Juegos de un lado en todo el partido: los de los sets cerrados más los del set en curso.
    func totalGames(_ side: Side) -> Int {
        now.setsHistory.reduce(0) { $0 + (side == .left ? $1.left : $1.right) } + now[side].g
    }

    private func push(_ next: Snapshot) -> Match {
        var m = self
        m.undoStack.append(now)
        m.now = next
        return m
    }

    /// Los juegos se acumulan sin cerrar sets a 1 set («cuenta sin fin»), o en un partido del
    /// torneo que no cuenta sets. Si el torneo puntúa por sets, su partido cierra sets de verdad.
    private func endless(_ c: Config) -> Bool { link.map { !$0.sets } ?? (c.sets == 1) }

    // Puntos de diferencia para cerrar el juego según el modo:
    //  · golden    → 1: en 40-40 el siguiente punto define.
    //  · advantage → 2: hay que ganar por dos (la igualdad se repite sin fin).
    //  · star      → 2, pero a la 3.ª igualdad (ambos en 5 = se gastaron las dos ventajas)
    //                pasa a punto de oro = 1.
    private func diffNeeded(_ c: Config, _ a: Int, _ b: Int) -> Int {
        if c.scoring == .golden { return 1 }
        if c.scoring == .star && min(a, b) >= 5 { return 1 }
        return 2
    }

    /// ¿El marcador a-b ya cierra el juego (o el tie-break) a favor del primero?
    private func closes(_ c: Config, _ s: Snapshot, _ a: Int, _ b: Int) -> Bool {
        s.tiebreak ? a >= 7 && a - b >= 2 : a >= 4 && a - b >= diffNeeded(c, a, b)
    }

    func winPoint(_ c: Config, _ side: Side) -> Match {
        var s = now
        s[side].p += 1
        let a = s[side].p
        let b = s[side.other].p
        if s.tiebreak {
            // El saque pasa tras el 1.er punto y luego cada 2 puntos.
            if (s.left.p + s.right.p) % 2 == 1 { s.server = s.server.other }
            if closes(c, s, a, b) { s = closeSet(s, side, viaTie: true) }
        } else if closes(c, s, a, b) {
            s = winGame(c, s, side)
        }
        return push(s)
    }

    private func winGame(_ c: Config, _ s0: Snapshot, _ side: Side) -> Snapshot {
        var s = s0
        s[side].g += 1
        s.left.p = 0
        s.right.p = 0
        s.gameNum += 1
        s.server = s.server.other // el saque cambia de pareja en cada juego
        if endless(c) { return s }
        if s[side].g >= 6 && s[side].g - s[side.other].g >= 2 { return closeSet(s, side, viaTie: false) }
        if s.left.g == 6 && s.right.g == 6 { s.tiebreak = true }
        return s
    }

    private func closeSet(_ s0: Snapshot, _ side: Side, viaTie: Bool) -> Snapshot {
        var s = s0
        if viaTie { s[side].g = 7; s[side.other].g = 6 }
        s.setsHistory.append(SetScore(left: s.left.g, right: s.right.g))
        s[side].s += 1
        s.left.g = 0; s.right.g = 0
        s.left.p = 0; s.right.p = 0
        s.tiebreak = false
        return s
    }

    /// Ajuste manual de sets/juegos (+/−) para corregir el marcador. nil si no aplica.
    func adjust(_ c: Config, _ side: Side, _ kind: Kind, _ delta: Int) -> Match? {
        var s = now
        let next = (kind == .s ? s[side].s : s[side].g) + delta
        if next < 0 { return nil }
        if kind == .s { s[side].s = next } else { s[side].g = next }
        if kind == .g { s.tiebreak = !endless(c) && s.left.g == 6 && s.right.g == 6 }
        return push(s)
    }

    // Ajuste fino del punto (+/−): corrige el juego en curso sin deshacer jugadas. Nunca
    // cierra el juego ni el set —para eso está tocar el panel—, así que se rechaza el ajuste
    // que dejaría un juego ya ganado (y así el marcador sigue en 0/15/30/40/AD).
    func canAdjustPoint(_ c: Config, _ side: Side, _ delta: Int) -> Bool {
        let a = now[side].p + delta
        let b = now[side.other].p
        return a >= 0 && !closes(c, now, a, b) && !closes(c, now, b, a)
    }

    func adjustPoint(_ c: Config, _ side: Side, _ delta: Int) -> Match? {
        guard canAdjustPoint(c, side, delta) else { return nil }
        var s = now
        s[side].p += delta
        return push(s)
    }

    func point(_ side: Side) -> PointText {
        let a = now[side].p
        let b = now[side.other].p
        if now.tiebreak { return PointText(text: String(a), ad: false) }
        if a >= 3 && b >= 3 {
            if a == b { return PointText(text: "40", ad: false) }
            return a > b ? PointText(text: "AD", ad: true) : PointText(text: "40", ad: false)
        }
        return PointText(text: ["0", "15", "30", "40"][a], ad: false)
    }

    /// Lado de la cancha desde el que se saca: alterna en cada punto.
    var courtSide: CourtSide { (now.left.p + now.right.p) % 2 == 0 ? .R : .L }

    /// Quién de la pareja saca: rota P1, P1, P2, P2… por juego.
    var player: String { (now.gameNum / 2) % 2 == 0 ? "P1" : "P2" }

    func undo() -> Match? {
        guard let prev = undoStack.last else { return nil }
        var m = self
        m.now = prev
        m.undoStack.removeLast()
        return m
    }

    func switchServer() -> Match {
        var s = now
        s.server = s.server.other
        return push(s)
    }

    /// Al cambiar los sets del partido: sin fin no hay tie-break; al volver, un 6-6 sí lo es.
    func reconfigured(_ c: Config) -> Match {
        var m = self
        m.now.tiebreak = !endless(c) && now.left.g == 6 && now.right.g == 6
        return m
    }

    /// ¿Mostrar la fila de sets? Sin sets que cerrar no dice nada, salvo que quede uno ganado.
    func showSets(_ c: Config) -> Bool { !endless(c) || now.left.s > 0 || now.right.s > 0 }

    var hasProgress: Bool {
        now.left.s > 0 || now.right.s > 0 || now.left.g > 0 || now.right.g > 0 ||
            now.left.p > 0 || now.right.p > 0 || !now.setsHistory.isEmpty
    }

    /// Los sets jugados, con el set en curso si ya empezó.
    func currentSets() -> [SetScore] {
        let started = now.left.g > 0 || now.right.g > 0 || now.left.p > 0 || now.right.p > 0
        return started ? now.setsHistory + [SetScore(left: now.left.g, right: now.right.g)] : now.setsHistory
    }

    /// Partido nuevo con los mismos nombres (y el mismo partido del torneo, si lo hay).
    func reset() -> Match { Match(names: names, link: link) }
}

/// Un resultado guardado: el mismo documento que guarda la PWA en `padel.results`.
struct MatchResult: Codable, Equatable, Identifiable {
    let id: String
    let date: Int64
    let left: String
    let right: String
    let sets: [SetScore]
    let setsLeft: Int
    let setsRight: Int

    init(id: String, date: Int64, left: String, right: String, sets: [SetScore]) {
        self.id = id
        self.date = date
        self.left = left
        self.right = right
        self.sets = sets
        setsLeft = sets.filter { $0.left > $0.right }.count
        setsRight = sets.filter { $0.right > $0.left }.count
    }
}
