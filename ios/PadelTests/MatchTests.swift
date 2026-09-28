import XCTest
@testable import Padel

// Las reglas del marcador de la PWA (src/scoreboard.js), una por prueba. Las mismas que
// `android/app/src/test/.../MatchTest.kt`.
final class MatchTests: XCTestCase {
    private let golden = Config(scoring: .golden, sets: 3)
    private let adv = Config(scoring: .advantage, sets: 3)
    private let star = Config(scoring: .star, sets: 3)
    private let L = Side.left
    private let R = Side.right

    private func points(_ m: Match, _ c: Config, _ sides: Side...) -> Match { sides.reduce(m) { $0.winPoint(c, $1) } }
    private func game(_ m: Match, _ c: Config, _ side: Side) -> Match { points(m, c, side, side, side, side) }
    private func games(_ m: Match, _ c: Config, _ side: Side, _ n: Int) -> Match { (0..<n).reduce(m) { m, _ in game(m, c, side) } }

    func testPointsRead015304() {
        var m = Match()
        var seen = [m.point(L).text]
        for _ in 0..<3 { m = m.winPoint(golden, L); seen.append(m.point(L).text) }
        XCTAssertEqual(seen, ["0", "15", "30", "40"])
    }

    func testGoldenPointDecidesAt4040() {
        let m = points(Match(), golden, L, L, L, R, R, R, R)
        XCTAssertEqual(m.now.left.g, 0)
        XCTAssertEqual(m.now.right.g, 1)
    }

    func testAdvantageNeedsTwo() {
        var m = points(Match(), adv, L, L, L, R, R, R, L)
        XCTAssertEqual(m.point(L), PointText(text: "AD", ad: true))
        m = m.winPoint(adv, R)
        XCTAssertEqual(m.point(L).text, "40")
        XCTAssertEqual(m.point(R).text, "40")
        m = points(m, adv, R, R)
        XCTAssertEqual(m.now.right.g, 1)
    }

    func testStarPointGoesGoldenOnTheThirdDeuce() {
        let m = points(Match(), star, L, L, L, R, R, R, L, R, R, L)
        XCTAssertEqual(m.now.left.p, 5)
        XCTAssertEqual(m.now.right.p, 5)
        XCTAssertEqual(m.winPoint(star, R).now.right.g, 1)
    }

    func testServeChangesEveryGameAndPlayerRotates() {
        var m = Match()
        XCTAssertEqual(m.now.server, .left)
        XCTAssertEqual(m.player, "P1")
        m = game(m, golden, L)
        XCTAssertEqual(m.now.server, .right)
        XCTAssertEqual(m.player, "P1")
        m = game(m, golden, L)
        XCTAssertEqual(m.player, "P2")
    }

    func testSetClosesAtSixByTwo() {
        let m = games(Match(), golden, L, 6)
        XCTAssertEqual(m.now.left.s, 1)
        XCTAssertEqual(m.now.setsHistory, [SetScore(left: 6, right: 0)])
    }

    func testSixAllGoesToTiebreakAndSevenFiveCloses() {
        var m = game(game(games(games(Match(), golden, L, 5), golden, R, 5), golden, L), golden, R)
        XCTAssertTrue(m.now.tiebreak)
        m = points(m, golden, L, L, L, L, L, L)
        XCTAssertEqual(m.point(L).text, "6")
        m = m.winPoint(golden, L)
        XCTAssertFalse(m.now.tiebreak)
        XCTAssertEqual(m.now.setsHistory, [SetScore(left: 7, right: 6)])
    }

    func testEndlessNeverClosesASet() {
        let one = Config(scoring: .golden, sets: 1)
        let m = games(Match(), one, L, 8)
        XCTAssertEqual(m.now.left.g, 8)
        XCTAssertEqual(m.now.left.s, 0)
        XCTAssertFalse(m.showSets(one))
    }

    func testUndoReturnsTheLastSnapshot() {
        let a = Match().winPoint(golden, L)
        let b = a.winPoint(golden, R)
        XCTAssertEqual(b.undo()?.now, a.now)
        XCTAssertNil(Match().undo())
    }

    func testPointAdjustNeverClosesAGame() {
        let m = points(Match(), golden, L, L, L)
        XCTAssertFalse(m.canAdjustPoint(golden, L, 1))
        XCTAssertNil(m.adjustPoint(golden, L, 1))
        XCTAssertTrue(m.canAdjustPoint(golden, L, -1))
        XCTAssertFalse(Match().canAdjustPoint(golden, L, -1))
    }

    func testResultCountsSetsWon() {
        let m = games(games(Match(), golden, L, 6), golden, R, 2)
        let r = MatchResult(id: "x", date: 0, left: "A", right: "B", sets: m.currentSets())
        XCTAssertEqual(r.sets, [SetScore(left: 6, right: 0), SetScore(left: 0, right: 2)])
        XCTAssertEqual(r.setsLeft, 1)
        XCTAssertEqual(r.setsRight, 1)
    }

    func testMatchSurvivesSaving() throws {
        let m = points(Match(), golden, L, R, L)
        let back = try JSONDecoder().decode(Match.self, from: JSONEncoder().encode(m))
        XCTAssertEqual(back, m)
    }
}
