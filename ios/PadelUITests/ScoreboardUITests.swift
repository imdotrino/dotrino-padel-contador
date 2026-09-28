import XCTest

// De punta a punta en el simulador: tocar paneles, cambiar de idioma, empezar un partido nuevo
// (que guarda el resultado en el almacén sellado) y verlo en Resultados.
final class ScoreboardUITests: XCTestCase {
    func testPlayChangeLanguageSaveAndListResult() {
        let app = XCUIApplication()
        app.launch()
        let left = app.otherElements["team-left"].exists ? app.otherElements["team-left"] : app.descendants(matching: .any)["team-left"]
        let right = app.descendants(matching: .any)["team-right"]
        XCTAssertTrue(left.waitForExistence(timeout: 10))
        // Arranca de cero aunque otra pasada haya dejado un partido a medias.
        for _ in 0..<3 { left.tap() }
        right.tap()
        XCTAssertEqual(app.staticTexts["points-left"].label, "40")
        XCTAssertEqual(app.staticTexts["points-right"].label, "15")

        app.buttons["lang-es"].tap()
        XCTAssertTrue(app.buttons["+ NUEVO"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["points-left"].label, "40", "changing language keeps the match")

        app.buttons["+ NUEVO"].tap()
        app.alerts.buttons["Empezar partido nuevo"].tap()
        XCTAssertEqual(app.staticTexts["points-left"].label, "0")

        app.buttons["results-btn"].tap()
        XCTAssertTrue(app.buttons["Borrar"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["lang-en"].firstMatch.tap()
    }
}
