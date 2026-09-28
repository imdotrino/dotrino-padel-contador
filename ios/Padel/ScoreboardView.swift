import DotrinoNative
import DotrinoNativeUI
import SwiftUI

/// El estado del marcador: el partido, las opciones y los resultados guardados. Juega un
/// partido suelto o uno del torneo (`match.link`); en el segundo, el resultado vuelve al torneo.
@MainActor
final class ScoreboardModel: ObservableObject {
    @Published private(set) var match: Match
    @Published private(set) var config: Config
    private let repo: Repo
    private let tours: TournamentModel
    private var lastClock: String?

    init(tours: TournamentModel) {
        do { repo = try Repo() } catch { fatalError("padel: could not open the store: \(error)") }
        self.tours = tours
        match = repo.loadMatch()
        config = repo.loadConfig()
    }

    private func update(_ next: Match?) {
        guard let next else { return }
        match = next
        repo.saveMatch(next)
    }

    func play(_ side: Side) {
        let before = match.now.gameNum
        update(match.winPoint(config, side))
        if match.now.gameNum != before { checkLinkedTarget() }
    }

    func adjust(_ side: Side, _ kind: Match.Kind, _ delta: Int) { update(match.adjust(config, side, kind, delta)) }
    func adjustPoint(_ side: Side, _ delta: Int) { update(match.adjustPoint(config, side, delta)) }
    func undo() { update(match.undo()) }
    func switchServer() { update(match.switchServer()) }

    func rename(_ side: Side, _ name: String) {
        var m = match
        if side == .left { m.names.left = name } else { m.names.right = name }
        update(m)
    }

    func setSets(_ n: Int) {
        config.sets = n
        repo.saveConfig(config)
        update(match.reconfigured(config))
    }

    func setScoring(_ s: Scoring) {
        config.scoring = s
        repo.saveConfig(config)
    }

    /// «Nuevo»: con un partido del torneo, guarda en el torneo; si no, lo jugado va a tus
    /// resultados. Sin guardar no se reinicia: el marcador sigue ahí para no perder el partido.
    func newMatch() {
        if match.link != nil { return saveLinked() }
        guard match.hasProgress else { return update(match.reset()) }
        tours.ask(t("newMatchTitle"), t("confirmNew"), t("newMatchOk")) {
            let r = MatchResult(
                id: UUID().uuidString.lowercased(), date: nowMs(),
                left: self.match.names.left.isEmpty ? t("teamA") : self.match.names.left,
                right: self.match.names.right.isEmpty ? t("teamB") : self.match.names.right,
                sets: self.match.currentSets()
            )
            do {
                try self.repo.saveResult(r)
            } catch {
                NSLog("padel: could not save result: %@", String(describing: error))
                self.tours.toast = t("resultSaveFailed", ["reason": String(describing: error)])
                return
            }
            self.update(self.match.reset())
        }
    }

    func results() throws -> [MatchResult] { try repo.loadResults().sorted { $0.date > $1.date } }
    func deleteResult(_ id: String) throws { try repo.deleteResult(id) }

    // MARK: partido del torneo

    var linkedMatchId: String? { match.link?.matchId }

    /// Jugar un partido del torneo en el marcador.
    func playLinked(_ tour: Tournament, _ m: TMatch) {
        if match.link?.matchId == m.id { tours.tab = "score"; return }
        guard let index = tour.rounds.firstIndex(where: { $0.matches.contains { $0.id == m.id } }) else { return }
        let s = tour.settings
        let link = Match.Link(
            tournamentId: tour.id, tournamentName: tour.name, matchId: m.id, roundId: tour.rounds[index].id,
            round: index + 1, court: m.court, timed: s.matchEnd == "time",
            target: s.matchEnd == "games" ? s.gamesPerMatch : 0, sets: s.scoring.sets.on,
            left: tours.sideName(tour, m.a), right: tours.sideName(tour, m.b)
        )
        let go = {
            // El estado del reloj AL ENLAZAR: si ya corría y se acaba antes del primer tic, el
            // partido igual se guarda solo.
            self.lastClock = link.timed ? self.tours.clockForLink(link, nowMs())?.state : nil
            self.update(Match(names: .init(left: link.left, right: link.right), link: link))
            self.tours.tab = "score"
        }
        if match.hasProgress || match.link != nil {
            tours.ask(t("replaceMatchTitle"), t("replaceMatchText"), t("replace"), danger: true, go)
        } else { go() }
    }

    private func checkLinkedTarget() {
        guard let l = match.link, l.target > 0 else { return }
        if match.totalGames(.left) >= l.target || match.totalGames(.right) >= l.target { saveLinked() }
    }

    private func resultText() -> String {
        guard let l = match.link else { return "" }
        let sets = l.sets ? "  (SETS \(match.now.left.s)–\(match.now.right.s))" : ""
        return "\(l.left)  \(match.totalGames(.left)) – \(match.totalGames(.right))  \(l.right)\(sets)"
    }

    private func saveLinked() {
        guard let l = match.link else { return }
        tours.ask(t("saveResultTitle"), resultText(), t("save"), cancel: t("keepPlaying")) {
            // Mientras se decidía pudo acabarse el tiempo y guardarse solo.
            if self.match.link == l { _ = self.commitLinked() }
        }
    }

    private func commitLinked() -> Bool {
        guard let l = match.link else { return false }
        let saved = tours.saveLinkedResult(l, games: (match.totalGames(.left), match.totalGames(.right)),
                                           sets: l.sets ? (match.now.left.s, match.now.right.s) : nil)
        guard saved else { return false }
        unlink()
        tours.tab = "matches"
        return true
    }

    private func unlink() {
        lastClock = nil
        update(Match())
    }

    func leaveLinked() {
        tours.ask(t("leaveLinkedTitle"), t("leaveLinkedText"), t("leave"), danger: true) { self.unlink() }
    }

    func linkLabel(_ now: Int64) -> String {
        guard let l = match.link else { return "" }
        let head = t("linkedLabel", ["name": l.tournamentName, "round": l.round, "court": l.court])
        if !l.timed { return head + " · " + (l.target > 0 ? t("toGames", ["n": l.target]) : t("freeGames")) }
        guard let c = tours.clockForLink(l, now) else { return head + " · " + t("onTime") }
        return head + " · ⏱ " + (c.state == "done" ? t("clockDone") : Engine.formatClock(c.remainingMs))
    }

    /// El tic: por tiempo, el partido del torneo se guarda solo al acabarse.
    func tick(_ now: Int64) {
        guard let l = match.link, l.timed else { lastClock = nil; return }
        let before = lastClock
        lastClock = tours.clockForLink(l, now)?.state
        if before == "running" && lastClock == "done" {
            let text = resultText()
            if commitLinked() { tours.toast = t("timeUpSaved", ["result": text]) }
        }
    }
}

/// El marcador: la portada de la app, como en la PWA. Tocar el panel de una pareja le da el
/// punto; los +/− corrigen sets, juegos y puntos sin deshacer jugadas.
struct ScoreboardView: View {
    @ObservedObject var model: ScoreboardModel
    @ObservedObject private var lang = DotrinoLang.shared
    @State private var options = false
    let now: Int64

    private var scoringLabel: String {
        t(["advantage": "advantage", "star": "doubleAdv", "golden": "golden"][model.config.scoring.rawValue]!)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Las opciones del partido, a la vista; tocarlas las edita. En un partido del
            // torneo, los sets los decide el torneo: solo se ve la puntuación.
            Button { options = true } label: {
                HStack(spacing: 8) {
                    Text(model.match.link != nil ? scoringLabel : "\(scoringLabel) · \(t("setsLabel\(model.config.sets)"))")
                        .font(.footnote.weight(.heavy)).foregroundColor(Palette.text).lineLimit(1)
                    Text("✎").font(.footnote).foregroundColor(Palette.accent)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 8).background(Palette.surface)
            }
            .accessibilityLabel(t("optionsTitle"))
            .accessibilityIdentifier("options-btn")
            if model.match.link != nil {
                HStack {
                    Text(model.linkLabel(now)).font(.footnote.weight(.bold)).foregroundColor(Palette.text).lineLimit(1)
                        .accessibilityIdentifier("linked-label")
                    Spacer()
                    Button { model.leaveLinked() } label: { Text("✕").foregroundColor(Palette.muted).padding(8) }
                        .accessibilityLabel(t("leaveLinked"))
                        .accessibilityIdentifier("leave-linked")
                }
                .padding(.leading, 14).padding(.trailing, 4).background(Palette.surface)
            }
            ZStack(alignment: .bottom) {
                HStack(spacing: 0) {
                    TeamPanel(model: model, side: .left)
                    TeamPanel(model: model, side: .right)
                }
                CourtView(server: model.match.now.server, courtSide: model.match.courtSide)
                    .frame(width: 150, height: 96)
                    .padding(.bottom, 40)
                    .allowsHitTesting(false)
            }
            HStack(spacing: 0) {
                control(t("undo")) { model.undo() }
                control(t("serveBtn"), accent: true) { model.switchServer() }
                control(t(model.match.link != nil ? "saveResult" : "newMatch")) { model.newMatch() }
            }
            .background(Palette.bg)
        }
        .sheet(isPresented: $options) { OptionsSheet(model: model) }
    }

    private func control(_ text: String, accent: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(text.uppercased())
                .font(.headline)
                .foregroundColor(accent ? Palette.onAccent : Palette.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(accent ? Palette.accent : Color.clear)
        }
    }
}

/// Un lado del tablero.
private struct TeamPanel: View {
    @ObservedObject var model: ScoreboardModel
    let side: Side
    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var score: SideScore { model.match.now[side] }
    private var cfg: Config { model.config }

    var body: some View {
        VStack(spacing: 6) {
            Spacer(minLength: 0)
            name
            if model.match.showSets(cfg) {
                meta(.s, value: score.s, total: model.match.link != nil || cfg.sets == 1 ? 0 : cfg.sets, label: "sets", big: true)
            }
            meta(.g, value: score.g, total: 0, label: "games", big: false)
            let p = model.match.point(side)
            Text(p.text)
                .font(.system(size: 96, weight: .heavy))
                .foregroundColor(p.ad ? Palette.win : Palette.text)
                .minimumScaleFactor(0.5).lineLimit(1)
                .accessibilityIdentifier("points-\(side.rawValue)")
            HStack(spacing: 22) {
                circle("−", big: true, enabled: model.match.canAdjustPoint(cfg, side, -1)) { model.adjustPoint(side, -1) }
                circle("+", big: true, enabled: model.match.canAdjustPoint(cfg, side, 1)) { model.adjustPoint(side, 1) }
            }
            Text("TIE-BREAK")
                .font(.footnote.weight(.bold)).foregroundColor(Palette.onAccent)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Palette.win).clipShape(RoundedRectangle(cornerRadius: 6))
                .opacity(model.match.now.tiebreak ? 1 : 0)
            Text(model.match.now.server == side ? "● \(t("serve")) \(model.match.player)" : " ")
                .font(.headline).kerning(1.2).foregroundColor(Palette.text)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(side == .left ? Palette.left : Palette.right)
        .contentShape(Rectangle())
        // Tocar el panel (fuera de los botones y del nombre) es ganar el punto.
        .onTapGesture { model.play(side) }
        .accessibilityIdentifier("team-\(side.rawValue)")
    }

    @ViewBuilder private var name: some View {
        let current = side == .left ? model.match.names.left : model.match.names.right
        let placeholder = t(side == .left ? "teamA" : "teamB").uppercased()
        let linked = model.match.link != nil
        HStack(spacing: 4) {
            if editing {
                TextField(placeholder, text: $draft)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { finish() }
                    .onChange(of: focused) { if !$0 { finish() } }
            } else {
                Text(current.isEmpty ? placeholder : current)
                    .foregroundColor(current.isEmpty ? Palette.text.opacity(0.8) : Palette.text)
                    .lineLimit(1)
                    .onTapGesture { if !linked { startEditing(current) } }
            }
            // Jugando un partido del torneo los nombres vienen del torneo: el lápiz se deshabilita.
            Button { startEditing(current) } label: { Text("✎") }
                .foregroundColor(Palette.text)
                .disabled(linked)
                .opacity(linked ? 0.35 : 1)
                .accessibilityLabel(t("editName"))
        }
        .font(.headline)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 6)
    }

    private func startEditing(_ current: String) {
        draft = current
        editing = true
        focused = true
    }

    private func finish() {
        guard editing else { return }
        editing = false
        model.rename(side, String(draft.prefix(32)))
    }

    private func meta(_ kind: Match.Kind, value: Int, total: Int, label: String, big: Bool) -> some View {
        HStack(spacing: 6) {
            circle("−", big: false, enabled: value > 0, size: big ? 40 : 34) { model.adjust(side, kind, -1) }
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text("\(value)").font(.system(size: big ? 28 : 20, weight: .bold))
                if total > 0 { Text("/\(total)").font(.footnote).opacity(0.7) }
                Text(" " + label.uppercased()).font(.system(size: big ? 15 : 12, weight: .bold))
            }
            .foregroundColor(Palette.text)
            .lineLimit(1).minimumScaleFactor(0.6)
            circle("+", big: false, enabled: true, size: big ? 40 : 34) { model.adjust(side, kind, 1) }
        }
    }

    private func circle(_ text: String, big: Bool, enabled: Bool, size: CGFloat? = nil, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(text)
                .font(.system(size: big ? 26 : 18, weight: .bold))
                .foregroundColor(Palette.text)
                .frame(width: size ?? (big ? 56 : 40), height: size ?? (big ? 56 : 40))
                .background(Circle().fill(Color.white.opacity(0.2)))
                .overlay(Circle().stroke(Color.white.opacity(0.33)))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }
}

/// La mini cancha (vista superior, apaisada): red vertical en el centro, mitad izquierda =
/// pareja izquierda. El que saca está en SU mitad y sirve cruzado a la caja del rival. El mismo
/// dibujo que `courtSvg` de la PWA, en un lienzo de 100×64.
struct CourtView: View {
    let server: Side
    let courtSide: CourtSide

    var body: some View {
        Canvas { c, size in
            let k = size.width / 100
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: y * k) }
            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> Path { Path(CGRect(x: x * k, y: y * k, width: w * k, height: h * k)) }
            func line(_ a: CGPoint, _ b: CGPoint) -> Path { var q = Path(); q.move(to: a); q.addLine(to: b); return q }
            let white = Color.white.opacity(0.85)
            let left = server == .left
            // left mira a la derecha: R = abajo, L = arriba. right mira a la izquierda: R = arriba, L = abajo.
            let srvTop = left ? courtSide == .L : courtSide == .R
            let recTop = !srvTop
            let boxX: (Bool) -> CGFloat = { $0 ? 28 : 50 }
            let centerX: (Bool) -> CGFloat = { $0 ? 39 : 61 }
            let centerY: (Bool) -> CGFloat = { $0 ? 18 : 46 }

            c.stroke(rect(4, 4, 92, 56), with: .color(white), lineWidth: 2 * k)
            c.stroke(line(p(50, 0), p(50, 64)), with: .color(white), lineWidth: 2.6 * k)
            c.stroke(line(p(28, 4), p(28, 60)), with: .color(white), lineWidth: k)
            c.stroke(line(p(72, 4), p(72, 60)), with: .color(white), lineWidth: k)
            c.stroke(line(p(28, 32), p(72, 32)), with: .color(white), lineWidth: k)
            c.fill(rect(boxX(!left), recTop ? 4 : 32, 22, 28), with: .color(.white.opacity(0.18)))
            c.fill(rect(boxX(left), srvTop ? 4 : 32, 22, 28), with: .color(Palette.win.opacity(0.55)))

            let a = p(centerX(left), centerY(srvTop))
            let e = p(centerX(!left), centerY(recTop))
            c.stroke(line(a, e), with: .color(Palette.win), lineWidth: 2.4 * k)
            let ang = atan2(e.y - a.y, e.x - a.x)
            let h = 4.5 * k
            var head = Path()
            head.move(to: e)
            head.addLine(to: CGPoint(x: e.x - h * cos(ang - 0.45), y: e.y - h * sin(ang - 0.45)))
            head.addLine(to: CGPoint(x: e.x - h * cos(ang + 0.45), y: e.y - h * sin(ang + 0.45)))
            head.closeSubpath()
            c.fill(head, with: .color(Palette.win))
            c.fill(Path(ellipseIn: CGRect(x: a.x - 2.8 * k, y: a.y - 2.8 * k, width: 5.6 * k, height: 5.6 * k)), with: .color(.white))
        }
    }
}
