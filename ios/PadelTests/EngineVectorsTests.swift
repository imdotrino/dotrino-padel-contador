import Foundation
import XCTest
@testable import Padel

/// Los casos de oro de `test/vectors/engine.json`, sacados del motor de la PWA: cada caso se
/// repite aquí con el mismo azar (mulberry32 con la misma semilla) y los mismos ids, y después
/// de cada operación el torneo y todo lo que la pantalla lee de él tiene que ser IDÉNTICO. Los
/// mismos casos que prueba Android (EngineVectorsTest.kt).
final class EngineVectorsTests: XCTestCase {
    /// mulberry32, bit a bit como `seeded` de gen.mjs.
    static func seeded(_ seed: Int) -> () -> Double {
        var a = UInt32(truncatingIfNeeded: seed)
        return {
            a = a &+ 0x6d2b79f5
            var x = a
            x = (x ^ (x >> 15)) &* (x | 1)
            x ^= x &+ ((x ^ (x >> 7)) &* (x | 61))
            return Double(x ^ (x >> 14)) / 4294967296.0
        }
    }

    private func scorer(_ kind: String, _ i: Int) -> (Int, Int) {
        switch kind {
        case "fixed": return (6, 3)
        case "cycle": return (6, (i * 5) % 7)
        case "draws": return i % 3 == 0 ? (4, 4) : (6, i % 5)
        default: preconditionFailure(kind)
        }
    }

    private func scoreRound(_ t: Tournament, _ r: Round, _ kind: String, _ withSets: Bool) {
        for (i, m) in r.matches.enumerated() {
            let (a, b) = scorer(kind, i + t.rounds.count * 3)
            Engine.setScore(t, m.id, a, b)
            if withSets { Engine.setSets(t, m.id, a > b ? 2 : a < b ? 0 : 1, a > b ? 0 : a < b ? 2 : 1) }
        }
    }

    private func settings(_ partial: [String: Any]) throws -> Settings {
        var base = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Engine.defaultSettings())) as! [String: Any]
        for (k, v) in partial { base[k] = v }
        return try JSONDecoder().decode(Settings.self, from: JSONSerialization.data(withJSONObject: base))
    }

    private func apply(_ t: Tournament, _ rng: () -> Double, _ o: [String: Any]) throws {
        let i = { (k: String) in o[k] as! Int }
        let now = { Int64(o["now"] as! Int) }
        switch o["op"] as! String {
        case "generate": if let r = try Engine.generateRound(t, rng) { t.rounds.append(r) }
        case "scoreLast": scoreRound(t, t.rounds.last!, o["scorer"] as! String, o["sets"] as? Bool ?? false)
        case "playAll":
            for _ in 0..<60 {
                guard let r = try Engine.generateRound(t, rng) else { return }
                t.rounds.append(r)
                scoreRound(t, r, o["scorer"] as! String, o["sets"] as? Bool ?? false)
            }
            XCTFail("tournament never ended")
        case "addPlayer": Engine.addPlayer(t, o["name"] as! String)
        case "addTeam": Engine.addTeam(t, o["a"] as! String, o["b"] as! String)
        case "removePlayer": Engine.removePlayer(t, t.players[i("index")].id)
        case "removeTeam": Engine.removeTeam(t, t.teams[i("index")].id)
        case "restore": Engine.restoreUnit(t, (o["team"] as? Bool ?? false) ? t.teams[i("index")].id : t.players[i("index")].id)
        case "redo": try Engine.redoLastRound(t, rng)
        case "dropLast": try Engine.removeLastRound(t)
        case "applyRules": try Engine.applyRules(t, settings(o["settings"] as! [String: Any]), rng)
        case "toggleScoring": Engine.toggleScoring(t.settings, o["kind"] as! String, o["on"] as! Bool)
        case "startClock": Engine.startClock(t, t.rounds[i("round")].id, now())
        case "pauseClock": Engine.pauseClock(t, t.rounds[i("round")].id, now())
        case "resumeClock": Engine.resumeClock(t, t.rounds[i("round")].id, now())
        case "resetClock": Engine.resetClock(t, t.rounds[i("round")].id)
        default: XCTFail("unknown op \(o["op"]!)")
        }
    }

    /// Un valor codificable como el objeto de JSONSerialization, para compararlo con el caso.
    /// Los `null` se quitan de los dos lados: Swift omite las claves nulas al codificar.
    private func plain<T: Encodable>(_ v: T) throws -> Any { strip(try JSONSerialization.jsonObject(with: JSONEncoder().encode([v]))) }

    private func strip(_ v: Any) -> Any {
        if let o = v as? [String: Any] { return o.filter { !($0.value is NSNull) && $0.key != "share" }.mapValues(strip) }
        if let a = v as? [Any] { return a.map(strip) }
        return v
    }

    /// Igualdad profunda de valores de JSONSerialization. Propia y no `NSArray.isEqual`: en la
    /// Foundation de Linux dos `false` sueltos no salían iguales.
    private func same(_ a: Any, _ b: Any) -> Bool { deepEqual(strip(a), strip(b)) }

    private func deepEqual(_ a: Any, _ b: Any) -> Bool {
        switch (a, b) {
        case let (x as [String: Any], y as [String: Any]):
            return x.count == y.count && x.allSatisfy { k, v in y[k].map { deepEqual(v, $0) } ?? false }
        case let (x as [Any], y as [Any]):
            return x.count == y.count && zip(x, y).allSatisfy { deepEqual($0, $1) }
        case let (x as String, y as String): return x == y
        case (is NSNull, is NSNull): return true
        case let (x as NSNumber, y as NSNumber): return x.stringValue == y.stringValue
        default: return false
        }
    }

    func testMatchesThePwaEngine() throws {
        let url = Bundle(for: Self.self).url(forResource: "engine", withExtension: "json")
            ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../test/vectors/engine.json")
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let cases = root["cases"] as! [[String: Any]]
        XCTAssertGreaterThanOrEqual(cases.count, 20)
        let saved = Engine.newId
        defer { Engine.newId = saved }
        for c in cases {
            let name = c["name"] as! String
            var next = 0
            Engine.newId = { next += 1; return "id\(next)" }
            let initial = c["initial"] as! [String: Any]
            let t = Engine.createTournament(
                name: initial["name"] as! String,
                settings: try settings(initial["settings"] as! [String: Any]),
                now: Int64(initial["createdAt"] as! Int)
            )
            let players = initial["players"] as! [[String: Any]]
            let teams = initial["teams"] as! [[String: Any]]
            if teams.isEmpty {
                for p in players { Engine.addPlayer(t, p["name"] as! String) }
            } else {
                let nameOf = { (id: String) in players.first { $0["id"] as! String == id }!["name"] as! String }
                for team in teams {
                    let ids = team["players"] as! [String]
                    Engine.addTeam(t, nameOf(ids[0]), nameOf(ids[1]))
                }
            }
            XCTAssertTrue(same((try plain(t) as! [Any])[0], initial), "\(name): initial")
            let rng = Self.seeded(c["seed"] as! Int)
            let ops = c["ops"] as! [[String: Any]]
            let steps = c["steps"] as! [[String: Any]]
            for (i, o) in ops.enumerated() {
                try apply(t, rng, o)
                let want = steps[i]
                let label = "\(name): step \(i) (\(o["op"]!))"
                let got: [String: Any] = [
                    "status": (try plain(Engine.status(t)) as! [Any])[0],
                    "estimate": (try plain(Engine.estimate(t)) as! [Any])[0],
                    // Todo por el mismo camino (codificar y leer), también los escalares: un Bool
                    // suelto y uno leído de JSON no se comparan igual en todas las plataformas.
                    "blocker": (try plain(Engine.nextRoundBlocker(t)) as! [Any])[0],
                    "everyoneMatchesEach": (try plain(Engine.everyoneMatchesEach(t)) as! [Any])[0],
                    "maxCourts": (try plain(Engine.maxCourts(t)) as! [Any])[0],
                    "canRedo": (try plain(Engine.canRedoLastRound(t)) as! [Any])[0],
                    "standings": (try plain(Engine.standings(t)) as! [Any])[0],
                    "tournament": (try plain(t) as! [Any])[0],
                ]
                for k in ["status", "estimate", "blocker", "everyoneMatchesEach", "maxCourts", "canRedo", "standings", "tournament"] {
                    XCTAssertTrue(same(got[k]!, want[k]!), "\(label) \(k)")
                }
                if let at = o["clockAt"] as? Int {
                    let clock = try plain(t.rounds.map { Engine.clockOf(t, $0, Int64(at)) })
                    XCTAssertTrue(same((clock as! [Any])[0], want["clock"]!), "\(label) clock")
                }
            }
        }
    }

    func testFormatClockRoundsUp() {
        XCTAssertEqual(Engine.formatClock(720000), "12:00")
        XCTAssertEqual(Engine.formatClock(1), "0:01")
        XCTAssertEqual(Engine.formatClock(0), "0:00")
    }
}
