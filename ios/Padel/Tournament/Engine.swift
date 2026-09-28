import Foundation

/// La lógica del torneo: el puerto de `src/tournament/engine.js` de la PWA, que va delante
/// (CONVENCIONES §16.1), y el mismo que `Engine.kt`. Con la misma semilla arma EXACTAMENTE las
/// mismas rondas: lo comprueban los casos de oro que genera `test/vectors/gen.mjs` desde el JS
/// (EngineVectorsTests). Por eso se respeta el orden de todo lo que el azar recorre: listas,
/// conjuntos que conservan el orden de inserción (`OrderedSet`) y ordenaciones ESTABLES
/// (`stableSorted`; el `sort` de Swift no promete serlo).
///
/// Los comentarios de cada regla están en el JS; aquí solo lo que es propio del puerto.
enum Engine {
    static let minPlayers = 4
    static let minTeams = 3
    static let scoreKinds = ["games", "sets", "match"]
    static let historyPeriods = ["all", "month", "week", "today"]
    private static let partnersModes = ["rotating", "fixed"]
    private static let pairings = ["random", "ranked"]
    private static let limits = ["perPlayer", "rounds", "matches", "everyone"]
    private static let matchEnds = ["time", "games"]
    private static let courtsModes = ["auto", "fixed"]
    private static let minute: Int64 = 60000
    private static let partnerWeight = 100
    private static let restarts = 24
    private static let planBudget = 60000
    private static let planExtraRounds = 2

    /// De dónde salen los ids. Las pruebas lo cambian por un contador.
    nonisolated(unsafe) static var newId: () -> String = { UUID().uuidString.lowercased() }
    static let random: () -> Double = { Double.random(in: 0..<1) }

    struct EngineError: Error, CustomStringConvertible { let description: String }
    private static func fail(_ m: String) -> EngineError { EngineError(description: m) }

    static func defaultSettings() -> Settings { Settings() }
    static func builtinRulesets() -> [Ruleset] {
        [Ruleset(id: "builtin-default", name: "Default", settings: defaultSettings(), builtin: true)]
    }

    private static func key(_ x: String, _ y: String) -> String { x < y ? "\(x)|\(y)" : "\(y)|\(x)" }

    static func checkSettings(_ s: Settings) throws {
        guard partnersModes.contains(s.partners) else { throw fail("unknown partners mode: \(s.partners)") }
        guard pairings.contains(s.pairing) else { throw fail("unknown pairing mode: \(s.pairing)") }
        guard limits.contains(s.limitType) else { throw fail("unknown limit type: \(s.limitType)") }
        guard courtsModes.contains(s.courtsMode) else { throw fail("unknown courts mode: \(s.courtsMode)") }
        guard s.courts >= 1 else { throw fail("invalid courts: \(s.courts)") }
        guard s.limitValue >= 1 else { throw fail("invalid limit: \(s.limitValue)") }
        for k in scoreKinds where s.scoring[k].points < 1 { throw fail("invalid scoring.\(k)") }
        guard scoreKinds.contains(where: { s.scoring[$0].on }) else { throw fail("scoring needs at least one kind turned on") }
        guard matchEnds.contains(s.matchEnd) else { throw fail("unknown match end: \(s.matchEnd)") }
        guard s.matchMinutes >= 1 else { throw fail("invalid match minutes: \(s.matchMinutes)") }
        guard s.gamesPerMatch >= 0 else { throw fail("invalid games per match: \(s.gamesPerMatch)") }
        let c = settingsConflicts(s)
        guard c.isEmpty else { throw fail("conflicting rules: \(c.joined(separator: ", "))") }
    }

    static func settingsConflicts(_ s: Settings) -> [String] {
        s.pairing == "ranked" && s.limitType == "everyone" ? ["pairing", "limit"] : []
    }

    /// Desde cuándo cuenta un periodo de «Mis torneos», en la hora local. nil = desde siempre.
    static func periodStart(_ period: String, now: Date = Date(), calendar: Calendar = .current) -> Int64? {
        if period == "all" { return nil }
        let day = calendar.startOfDay(for: now)
        let start: Date
        switch period {
        case "today": start = day
        case "week":
            // Lunes: weekday 1 = domingo en el calendario gregoriano.
            let back = (calendar.component(.weekday, from: day) + 5) % 7
            start = calendar.date(byAdding: .day, value: -back, to: day)!
        case "month": start = calendar.date(from: calendar.dateComponents([.year, .month], from: day))!
        default: preconditionFailure("unknown period: \(period)")
        }
        return Int64(start.timeIntervalSince1970 * 1000)
    }

    // MARK: construcción

    static func createTournament(name: String = "", settings: Settings = defaultSettings(), rulesetId: String? = nil,
                                 now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Tournament {
        Tournament(id: newId(), name: name, createdAt: now, rulesetId: rulesetId, settings: settings.copy())
    }

    @discardableResult
    static func addPlayer(_ t: Tournament, _ name: String) -> Player {
        let p = Player(id: newId(), name: name, active: true)
        t.players.append(p)
        return p
    }

    @discardableResult
    static func addTeam(_ t: Tournament, _ a: String, _ b: String) -> Team {
        let pa = addPlayer(t, a)
        let pb = addPlayer(t, b)
        let team = Team(id: newId(), players: [pa.id, pb.id], active: true)
        t.teams.append(team)
        return team
    }

    // MARK: consultas

    static func isFixed(_ t: Tournament) -> Bool { t.settings.partners == "fixed" }
    private static func slotsPerMatch(_ t: Tournament) -> Int { isFixed(t) ? 2 : 4 }
    static func minUnits(_ t: Tournament) -> Int { isFixed(t) ? minTeams : minPlayers }

    static func activeUnits(_ t: Tournament) -> [String] {
        isFixed(t) ? t.teams.filter(\.active).map(\.id) : t.players.filter(\.active).map(\.id)
    }

    static func maxCourts(_ t: Tournament) -> Int { activeUnits(t).count / slotsPerMatch(t) }
    private static func courtsFor(_ t: Tournament) -> Int {
        t.settings.courtsMode == "auto" ? maxCourts(t) : min(t.settings.courts, maxCourts(t))
    }
    static func courtsInUse(_ t: Tournament) -> Int { max(1, courtsFor(t)) }

    static func hasScore(_ m: TMatch) -> Bool { m.score?.a != nil && m.score?.b != nil }
    static func hasSets(_ m: TMatch) -> Bool { m.sets?.a != nil && m.sets?.b != nil }

    /// "a", "b", "draw", o nil sin resultado de juegos.
    static func outcome(_ m: TMatch) -> String? {
        guard hasScore(m) else { return nil }
        let (x, y) = hasSets(m) && m.sets!.a != m.sets!.b ? (m.sets!.a!, m.sets!.b!) : (m.score!.a!, m.score!.b!)
        return x == y ? "draw" : x > y ? "a" : "b"
    }

    static func hasResults(_ t: Tournament) -> Bool { t.rounds.contains { $0.matches.contains(where: hasScore) } }
    static func countMatches(_ t: Tournament) -> Int { t.rounds.reduce(0) { $0 + $1.matches.count } }
    static func findMatch(_ t: Tournament, _ id: String) -> TMatch? {
        for r in t.rounds { if let m = r.matches.first(where: { $0.id == id }) { return m } }
        return nil
    }
    private static func playerScheduled(_ t: Tournament, _ pid: String) -> Bool {
        t.rounds.contains { $0.matches.contains { $0.a.contains(pid) || $0.b.contains(pid) } }
    }
    private static func teamScheduled(_ t: Tournament, _ tid: String) -> Bool {
        t.rounds.contains { $0.matches.contains { $0.teams?.contains(tid) == true } }
    }

    private static func unitSides(_ m: TMatch, _ fixed: Bool) -> ([String], [String]) {
        if !fixed { return (m.a, m.b) }
        guard let teams = m.teams else { preconditionFailure("match \(m.id) has no teams but the tournament uses fixed pairs") }
        return ([teams[0]], [teams[1]])
    }

    private final class History {
        var appearances: [String: Int] = [:]
        var rests: [String: Int] = [:]
        var lastPlayed: [String: Int] = [:]
        var partners: [String: Int] = [:]
        var opponents: [String: Int] = [:]
    }

    private static func history(_ t: Tournament) -> History {
        let fixed = isFixed(t)
        let h = History()
        for (ri, r) in t.rounds.enumerated() {
            for u in r.rest { h.rests[u, default: 0] += 1 }
            for m in r.matches {
                let (sa, sb) = unitSides(m, fixed)
                for u in sa + sb {
                    h.appearances[u, default: 0] += 1
                    h.lastPlayed[u] = ri
                }
                h.partners[key(m.a[0], m.a[1]), default: 0] += 1
                h.partners[key(m.b[0], m.b[1]), default: 0] += 1
                for x in sa { for y in sb { h.opponents[key(x, y), default: 0] += 1 } }
            }
        }
        return h
    }

    private static func limitReached(_ t: Tournament, _ h0: History? = nil) -> Bool {
        let h = h0 ?? history(t)
        let s = t.settings
        switch s.limitType {
        case "rounds": return t.rounds.count >= s.limitValue
        case "matches": return countMatches(t) >= s.limitValue
        case "perPlayer":
            let units = activeUnits(t)
            return !units.isEmpty && units.allSatisfy { (h.appearances[$0] ?? 0) >= s.limitValue }
        case "everyone": return pendingPairs(t, h).isEmpty
        default: preconditionFailure("unknown limit type: \(s.limitType)")
        }
    }

    private static func pendingPairs(_ t: Tournament, _ h: History) -> [(String, String)] {
        let units = activeUnits(t)
        let met = isFixed(t) ? h.opponents : h.partners
        var out: [(String, String)] = []
        for i in 0..<units.count {
            for j in (i + 1)..<max(i + 1, units.count) where (met[key(units[i], units[j])] ?? 0) == 0 {
                out.append((units[i], units[j]))
            }
        }
        return out
    }

    static func everyoneMatchesEach(_ t: Tournament) -> Int? {
        let n = activeUnits(t).count
        return n >= 2 ? n - 1 : nil
    }

    /// "players", "finished" o nil si se puede armar otra ronda.
    static func nextRoundBlocker(_ t: Tournament) -> String? {
        if activeUnits(t).count < minUnits(t) { return "players" }
        if limitReached(t) { return "finished" }
        return nil
    }

    static func status(_ t: Tournament) -> TStatus {
        let scheduled = countMatches(t)
        let scored = t.rounds.reduce(0) { $0 + $1.matches.filter(hasScore).count }
        let reached = limitReached(t)
        return TStatus(scheduled: scheduled, scored: scored, reached: reached, finished: reached && scheduled > 0 && scored == scheduled)
    }

    private static func ceilDiv(_ a: Int, _ b: Int) -> Int { Int((Double(a) / Double(b)).rounded(.up)) }

    static func estimate(_ t: Tournament) -> Estimate? {
        let units = activeUnits(t)
        let slots = slotsPerMatch(t)
        let courts = courtsFor(t)
        if courts < 1 { return nil }
        let s = t.settings
        let done = countMatches(t)
        let doneRounds = t.rounds.count
        if s.limitType == "rounds" {
            let left = max(0, s.limitValue - doneRounds)
            return Estimate(matches: done + left * courts, rounds: doneRounds + left, exact: true)
        }
        let left: Int
        switch s.limitType {
        case "matches": left = max(0, s.limitValue - done)
        case "everyone": left = ceilDiv(pendingPairs(t, history(t)).count, isFixed(t) ? 1 : 2)
        default:
            let h = history(t)
            let deficit = units.reduce(0) { $0 + max(0, s.limitValue - (h.appearances[$1] ?? 0)) }
            left = ceilDiv(deficit, slots)
        }
        return Estimate(matches: done + left, rounds: doneRounds + ceilDiv(left, courts), exact: s.limitType == "matches")
    }

    // MARK: clasificación

    static func standings(_ t: Tournament) -> [Standing] {
        precondition((try? checkSettings(t.settings)) != nil, "invalid settings")
        let fixed = isFixed(t)
        var order: [String] = []
        var rows: [String: Standing] = [:]
        for (id, active) in fixed ? t.teams.map({ ($0.id, $0.active) }) : t.players.map({ ($0.id, $0.active) }) {
            order.append(id)
            rows[id] = Standing(id: id, active: active)
        }
        func tally(_ side: [String], _ result: String, _ games: (Int, Int), _ sets: (Int, Int)) {
            for u in side {
                guard var row = rows[u] else { preconditionFailure("match references unknown unit \(u)") }
                row.played += 1
                row.gamesFor += games.0
                row.gamesAgainst += games.1
                row.setsFor += sets.0
                row.setsAgainst += sets.1
                switch result { case "won": row.won += 1; case "lost": row.lost += 1; default: row.drawn += 1 }
                rows[u] = row
            }
        }
        for r in t.rounds {
            for m in r.matches where hasScore(m) {
                let (sa, sb) = unitSides(m, fixed)
                let o = outcome(m)
                let sets = hasSets(m) ? (m.sets!.a!, m.sets!.b!) : (0, 0)
                let score = (m.score!.a!, m.score!.b!)
                tally(sa, o == "a" ? "won" : o == "b" ? "lost" : "drawn", score, sets)
                tally(sb, o == "b" ? "won" : o == "a" ? "lost" : "drawn", (score.1, score.0), (sets.1, sets.0))
            }
        }
        let sc = t.settings.scoring
        for id in order {
            var row = rows[id]!
            row.points = (sc.games.on ? row.gamesFor * sc.games.points : 0) +
                (sc.sets.on ? row.setsFor * sc.sets.points : 0) +
                (sc.match.on ? row.won * sc.match.points : 0)
            rows[id] = row
        }
        return stableSorted(order.map { rows[$0]! }) { x, y in
            if y.points != x.points { return y.points - x.points }
            if y.won != x.won { return y.won - x.won }
            let sd = (y.setsFor - y.setsAgainst) - (x.setsFor - x.setsAgainst)
            if sd != 0 { return sd }
            let gd = (y.gamesFor - y.gamesAgainst) - (x.gamesFor - x.gamesAgainst)
            if gd != 0 { return gd }
            return y.gamesFor - x.gamesFor
        }
    }

    // MARK: generación de rondas

    /// Ordenación ESTABLE con un comparador de JS (negativo, cero, positivo).
    static func stableSorted<T>(_ items: [T], _ cmp: (T, T) -> Int) -> [T] {
        items.enumerated().sorted { a, b in
            let c = cmp(a.element, b.element)
            return c != 0 ? c < 0 : a.offset < b.offset
        }.map(\.element)
    }

    private static func shuffle<T>(_ items: [T], _ rng: () -> Double) -> [T] {
        var a = items
        var i = a.count - 1
        while i > 0 {
            let j = Int((rng() * Double(i + 1)).rounded(.down))
            a.swapAt(i, j)
            i -= 1
        }
        return a
    }

    private static func rotatingCost(_ arr: [String], _ h: History) -> Int {
        var c = 0
        for i in stride(from: 0, to: arr.count, by: 4) {
            let (p0, p1, p2, p3) = (arr[i], arr[i + 1], arr[i + 2], arr[i + 3])
            let pa = h.partners[key(p0, p1)] ?? 0
            let pb = h.partners[key(p2, p3)] ?? 0
            c += partnerWeight * (pa * pa + pb * pb)
            for (x, y) in [(p0, p2), (p0, p3), (p1, p2), (p1, p3)] {
                let o = h.opponents[key(x, y)] ?? 0
                c += o * o
            }
        }
        return c
    }

    private static func teamCost(_ arr: [String], _ h: History) -> Int {
        var c = 0
        for i in stride(from: 0, to: arr.count, by: 2) {
            let o = h.opponents[key(arr[i], arr[i + 1])] ?? 0
            c += o * o
        }
        return c
    }

    private static func bestArrangement<T>(_ items: [T], _ cost: ([T]) -> Int, _ rng: () -> Double) -> [T] {
        var best: [T]?
        var bestCost = Int.max
        var r = 0
        while r < restarts && bestCost > 0 {
            var arr = shuffle(items, rng)
            var c = cost(arr)
            var improved = true
            while improved && c > 0 {
                improved = false
                for i in 0..<arr.count {
                    for j in (i + 1)..<max(i + 1, arr.count) {
                        arr.swapAt(i, j)
                        let nc = cost(arr)
                        if nc < c { c = nc; improved = true } else { arr.swapAt(i, j) }
                    }
                }
            }
            if c < bestCost { best = arr; bestCost = c }
            r += 1
        }
        return best!
    }

    private static func byStanding(_ t: Tournament, _ ids: [String]) -> [String] {
        var rank: [String: Int] = [:]
        for (i, row) in standings(t).enumerated() { rank[row.id] = i }
        return stableSorted(ids) { rank[$0]! - rank[$1]! }
    }

    private static func rankedPlayers(_ t: Tournament, _ playing: [String], _ h: History) -> [String] {
        let order = byStanding(t, playing)
        var out: [String] = []
        for i in stride(from: 0, to: order.count, by: 4) {
            let (p1, p2, p3, p4) = (order[i], order[i + 1], order[i + 2], order[i + 3])
            let options = [[p1, p4, p2, p3], [p1, p3, p2, p4], [p1, p2, p3, p4]]
            var best = options[0]
            var bestCost = Int.max
            for o in options {
                let c = (h.partners[key(o[0], o[1])] ?? 0) + (h.partners[key(o[2], o[3])] ?? 0)
                if c < bestCost { best = o; bestCost = c }
            }
            out += best
        }
        return out
    }

    private static func rankedTeams(_ t: Tournament, _ playing: [String], _ h: History) -> [String] {
        var order = byStanding(t, playing)
        var i = 0
        while i + 3 < order.count {
            if (h.opponents[key(order[i], order[i + 1])] ?? 0) > (h.opponents[key(order[i], order[i + 2])] ?? 0) {
                order.swapAt(i + 1, i + 2)
            }
            i += 2
        }
        return order
    }

    private struct Group { let a: [String]; let b: [String]; let teams: [String]? }

    private static func team(_ t: Tournament, _ id: String) -> Team {
        guard let x = t.teams.first(where: { $0.id == id }) else { preconditionFailure("unknown team \(id)") }
        return x
    }

    static func generateRound(_ t: Tournament, _ rng: () -> Double = random) throws -> Round? {
        try checkSettings(t.settings)
        if nextRoundBlocker(t) != nil { return nil }
        let h = history(t)
        if t.settings.limitType == "everyone" { return try everyoneRound(t, h, rng) }
        let units = activeUnits(t)
        let slots = slotsPerMatch(t)
        let courts = courtsInUse(t)
        let s = t.settings
        var size = courts
        if s.limitType == "matches" { size = min(courts, s.limitValue - countMatches(t)) }
        if s.limitType == "perPlayer" {
            let short = units.filter { (h.appearances[$0] ?? 0) < s.limitValue }.count
            size = min(courts, ceilDiv(short, slots))
        }
        let order = stableSorted(shuffle(units, rng)) { x, y in
            let a = (h.appearances[x] ?? 0) - (h.appearances[y] ?? 0)
            if a != 0 { return a }
            let r = (h.rests[y] ?? 0) - (h.rests[x] ?? 0)
            if r != 0 { return r }
            return (h.lastPlayed[x] ?? -1) - (h.lastPlayed[y] ?? -1)
        }
        let playing = Array(order[0..<(size * slots)])
        let rest = Array(order[(size * slots)...])
        let ranked = s.pairing == "ranked" && hasResults(t)
        var groups: [Group] = []
        if isFixed(t) {
            let arr = ranked ? rankedTeams(t, playing, h) : bestArrangement(playing, { teamCost($0, h) }, rng)
            for i in stride(from: 0, to: arr.count, by: 2) {
                groups.append(Group(a: team(t, arr[i]).players, b: team(t, arr[i + 1]).players, teams: [arr[i], arr[i + 1]]))
            }
        } else {
            let arr = ranked ? rankedPlayers(t, playing, h) : bestArrangement(playing, { rotatingCost($0, h) }, rng)
            for i in stride(from: 0, to: arr.count, by: 4) {
                groups.append(Group(a: [arr[i], arr[i + 1]], b: [arr[i + 2], arr[i + 3]], teams: nil))
            }
        }
        return makeRound(groups, rest)
    }

    private static func makeRound(_ groups: [Group], _ rest: [String]) -> Round {
        let id = newId()
        let matches = groups.enumerated().map { i, g in TMatch(id: newId(), court: i + 1, a: g.a, b: g.b, teams: g.teams) }
        return Round(id: id, matches: matches, rest: rest)
    }

    // MARK: todos contra todos / con todos

    /// Un conjunto que conserva el orden de inserción, como el `Set` de JS: quitar y volver a
    /// poner un elemento lo manda al final. De eso depende qué sale del azar.
    private struct OrderedSet {
        private(set) var items: [String] = []
        var count: Int { items.count }
        mutating func add(_ x: String) { if !items.contains(x) { items.append(x) } }
        mutating func remove(_ x: String) { items.removeAll { $0 == x } }
    }

    private static func planFirstRound(_ units: [String], _ pending: [(String, String)], _ cap: Int, _ rng: () -> Double) -> [(String, String)] {
        var adj: [String: OrderedSet] = [:]
        for u in units { adj[u] = OrderedSet() }
        for (x, y) in pending { adj[x]!.add(y); adj[y]!.add(x) }
        func degree(_ u: String) -> Int { adj[u]!.count }
        var edgesLeft = pending.count
        var budget = planBudget

        func fill(_ rounds: Int, _ used: inout Set<String>, _ chosen: inout [(String, String)]) -> [(String, String)]? {
            budget -= 1
            if budget < 0 { return nil }
            let usedNow = used
            func free(_ u: String) -> Bool { !usedNow.contains(u) }
            if units.contains(where: { free($0) && degree($0) > rounds }) { return nil }
            let mustPlay = units.filter { free($0) && degree($0) == rounds }
            let open = units.filter { u in free(u) && adj[u]!.items.contains(where: free) }
            if chosen.count == cap || open.isEmpty {
                if !mustPlay.isEmpty { return nil }
                if edgesLeft == 0 { return chosen }
                if rounds == 1 || edgesLeft > (rounds - 1) * cap { return nil }
                var u2 = Set<String>()
                var c2: [(String, String)] = []
                return fill(rounds - 1, &u2, &c2) != nil ? chosen : nil
            }
            let v = shuffle(mustPlay.isEmpty ? open : mustPlay, rng).reduce(nil as String?) { a, b in
                guard let a else { return b }
                return degree(b) > degree(a) ? b : a
            }!
            let partners = stableSorted(shuffle(adj[v]!.items.filter(free), rng)) { degree($1) - degree($0) }
            for w in partners {
                adj[v]!.remove(w); adj[w]!.remove(v); edgesLeft -= 1
                used.insert(v); used.insert(w); chosen.append((v, w))
                let res = fill(rounds, &used, &chosen)
                chosen.removeLast(); used.remove(v); used.remove(w)
                adj[v]!.add(w); adj[w]!.add(v); edgesLeft += 1
                if let res { return res }
                if budget < 0 { return nil }
            }
            if degree(v) == rounds { return nil }
            used.insert(v)
            let res = fill(rounds, &used, &chosen)
            used.remove(v)
            return res
        }

        let lower = max(ceilDiv(pending.count, cap), units.map(degree).max() ?? Int.min)
        var rounds = lower
        while rounds <= lower + planExtraRounds && budget > 0 {
            var used = Set<String>()
            var chosen: [(String, String)] = []
            if let first = fill(rounds, &used, &chosen) { return first }
            rounds += 1
        }
        return greedyPairs(units, adj.mapValues(\.items), cap, rng)
    }

    private static func greedyPairs(_ units: [String], _ adj: [String: [String]], _ cap: Int, _ rng: () -> Double) -> [(String, String)] {
        var used = Set<String>()
        var out: [(String, String)] = []
        func degree(_ u: String) -> Int { adj[u]!.count }
        func most(_ list: [String]) -> String { list.dropFirst().reduce(list[0]) { degree($1) > degree($0) ? $1 : $0 } }
        while out.count < cap {
            let open = shuffle(units.filter { u in !used.contains(u) && adj[u]!.contains { !used.contains($0) } }, rng)
            if open.isEmpty { break }
            let v = most(open)
            let w = most(shuffle(adj[v]!.filter { !used.contains($0) }, rng))
            used.insert(v); used.insert(w); out.append((v, w))
        }
        return out
    }

    private static func opponentCost(_ arr: [[String]], _ h: History) -> Int {
        var c = 0
        for i in stride(from: 0, to: arr.count, by: 2) {
            for x in arr[i] { for y in arr[i + 1] {
                let o = h.opponents[key(x, y)] ?? 0
                c += o * o
            } }
        }
        return c
    }

    private static func everyoneRound(_ t: Tournament, _ h: History, _ rng: () -> Double) throws -> Round {
        let units = activeUnits(t)
        let fixed = isFixed(t)
        let courts = courtsInUse(t)
        let pairs = planFirstRound(units, pendingPairs(t, h), fixed ? courts : courts * 2, rng)
        var groups: [Group] = []
        if fixed {
            groups = pairs.map { x, y in Group(a: team(t, x).players, b: team(t, y).players, teams: [x, y]) }
        } else {
            var teams = pairs.map { [$0.0, $0.1] }
            if teams.count % 2 == 1 {
                let used = Set(teams.flatMap { $0 })
                let free = stableSorted(shuffle(units.filter { !used.contains($0) }, rng)) { (h.appearances[$0] ?? 0) - (h.appearances[$1] ?? 0) }
                guard free.count >= 2 else { throw fail("no players left to complete the last match") }
                let f1 = free[0]
                let others = Array(free.dropFirst())
                let f2 = others.dropFirst().reduce(others[0]) { a, b in
                    (h.partners[key(f1, b)] ?? 0) < (h.partners[key(f1, a)] ?? 0) ? b : a
                }
                teams.append([f1, f2])
            }
            let arr = bestArrangement(teams, { opponentCost($0, h) }, rng)
            for i in stride(from: 0, to: arr.count, by: 2) { groups.append(Group(a: arr[i], b: arr[i + 1], teams: nil)) }
        }
        let playing = Set(groups.flatMap { fixed ? $0.teams! : $0.a + $0.b })
        return makeRound(shuffle(groups, rng), units.filter { !playing.contains($0) })
    }

    // MARK: ediciones

    static func setScore(_ t: Tournament, _ matchId: String, _ a: Int?, _ b: Int?) {
        guard let m = findMatch(t, matchId) else { preconditionFailure("unknown match \(matchId)") }
        m.score = a == nil && b == nil ? nil : Score(a: a, b: b)
    }

    static func setSets(_ t: Tournament, _ matchId: String, _ a: Int?, _ b: Int?) {
        guard let m = findMatch(t, matchId) else { preconditionFailure("unknown match \(matchId)") }
        m.sets = a == nil && b == nil ? nil : Score(a: a, b: b)
    }

    static func toggleScoring(_ s: Settings, _ kind: String, _ on: Bool) {
        precondition(scoreKinds.contains(kind), "unknown scoring kind: \(kind)")
        precondition(on || !scoreKinds.allSatisfy { $0 == kind || !s.scoring[$0].on }, "at least one scoring kind must stay on")
        s.scoring[kind].on = on
    }

    private static func lastRoundScored(_ t: Tournament) -> Bool {
        guard let last = t.rounds.last else { return false }
        return last.matches.contains { $0.score != nil || $0.sets != nil }
    }

    static func canRedoLastRound(_ t: Tournament) -> Bool { !t.rounds.isEmpty && !lastRoundScored(t) }

    @discardableResult
    static func redoLastRound(_ t: Tournament, _ rng: () -> Double = random) throws -> Round? {
        guard canRedoLastRound(t) else { throw fail("the last round already has results") }
        t.rounds.removeLast()
        let r = try generateRound(t, rng)
        if let r { t.rounds.append(r) }
        return r
    }

    static func removeLastRound(_ t: Tournament) throws {
        guard canRedoLastRound(t) else { throw fail("the last round already has results") }
        t.rounds.removeLast()
    }

    static func setPartners(_ t: Tournament, _ mode: String, _ rng: () -> Double = random) throws {
        guard partnersModes.contains(mode) else { throw fail("unknown partners mode: \(mode)") }
        guard !hasResults(t) else { throw fail("partners mode is locked once there are results") }
        t.settings.partners = mode
        if mode == "fixed" && !t.teams.contains(where: \.active) {
            let free = t.players.filter(\.active)
            var i = 0
            while i + 1 < free.count {
                t.teams.append(Team(id: newId(), players: [free[i].id, free[i + 1].id], active: true))
                i += 2
            }
        }
        let had = !t.rounds.isEmpty
        t.rounds = []
        if had, let r = try generateRound(t, rng) { t.rounds.append(r) }
    }

    static func canApplyRules(_ t: Tournament, _ s: Settings) -> Bool { s.partners == t.settings.partners || !hasResults(t) }

    static func applyRules(_ t: Tournament, _ settings: Settings, _ rng: () -> Double = random) throws {
        try checkSettings(settings)
        guard canApplyRules(t, settings) else { throw fail("partners mode is locked once there are results") }
        let next = settings.copy()
        let partners = next.partners
        next.partners = t.settings.partners
        t.settings = next
        if partners != t.settings.partners { try setPartners(t, partners, rng) }
    }

    /// "retired" si ya jugó (sigue en la tabla), "deleted" si no.
    @discardableResult
    static func removePlayer(_ t: Tournament, _ pid: String) -> String {
        guard let p = t.players.first(where: { $0.id == pid }) else { preconditionFailure("unknown player \(pid)") }
        if playerScheduled(t, pid) { p.active = false; return "retired" }
        t.players.removeAll { $0.id == pid }
        t.teams.removeAll { $0.players.contains(pid) }
        return "deleted"
    }

    @discardableResult
    static func removeTeam(_ t: Tournament, _ tid: String) -> String {
        guard let team = t.teams.first(where: { $0.id == tid }) else { preconditionFailure("unknown team \(tid)") }
        if teamScheduled(t, tid) { team.active = false; return "retired" }
        t.teams.removeAll { $0.id == tid }
        t.players = t.players.filter { !team.players.contains($0.id) || playerScheduled(t, $0.id) }
        return "deleted"
    }

    static func restoreUnit(_ t: Tournament, _ id: String) {
        if let p = t.players.first(where: { $0.id == id }) { p.active = true; return }
        if let x = t.teams.first(where: { $0.id == id }) { x.active = true; return }
        preconditionFailure("unknown unit \(id)")
    }

    // MARK: cronómetro de la ronda

    static func findRound(_ t: Tournament, _ id: String) -> Round {
        guard let r = t.rounds.first(where: { $0.id == id }) else { preconditionFailure("unknown round \(id)") }
        return r
    }

    static func clockOf(_ t: Tournament, _ round: Round, _ now: Int64) -> ClockState {
        guard let c = round.clock else {
            return ClockState(state: "idle", remainingMs: Int64(t.settings.matchMinutes) * minute, minutes: t.settings.matchMinutes)
        }
        let elapsed = c.elapsedMs + (c.runningSince.map { now - $0 } ?? 0)
        let remaining = max(0, Int64(c.minutes) * minute - elapsed)
        let state = remaining == 0 ? "done" : c.runningSince == nil ? "paused" : "running"
        return ClockState(state: state, remainingMs: remaining, minutes: c.minutes)
    }

    static func startClock(_ t: Tournament, _ roundId: String, _ now: Int64) {
        precondition(t.settings.matchEnd == "time", "this tournament does not play on time")
        let r = findRound(t, roundId)
        precondition(r.clock == nil, "the clock of round \(roundId) already started")
        r.clock = Clock(minutes: t.settings.matchMinutes, runningSince: now, elapsedMs: 0)
    }

    static func pauseClock(_ t: Tournament, _ roundId: String, _ now: Int64) {
        let r = findRound(t, roundId)
        precondition(clockOf(t, r, now).state == "running", "the clock of round \(roundId) is not running")
        r.clock!.elapsedMs += now - r.clock!.runningSince!
        r.clock!.runningSince = nil
    }

    static func resumeClock(_ t: Tournament, _ roundId: String, _ now: Int64) {
        let r = findRound(t, roundId)
        precondition(clockOf(t, r, now).state == "paused", "the clock of round \(roundId) is not paused")
        r.clock!.runningSince = now
    }

    static func resetClock(_ t: Tournament, _ roundId: String) { findRound(t, roundId).clock = nil }

    /// m:ss, redondeando hacia arriba: marca 0:00 solo cuando de verdad se acabó.
    static func formatClock(_ ms: Int64) -> String {
        let s = Int64((Double(ms) / 1000).rounded(.up))
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}
