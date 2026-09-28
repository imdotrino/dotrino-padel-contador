import DotrinoNativeUI
import SwiftUI

/// El estado de la pantalla: el partido, las opciones y los resultados guardados.
@MainActor
final class ScoreboardModel: ObservableObject {
    @Published private(set) var match: Match
    @Published private(set) var config: Config
    @Published var error: String?
    private let repo: Repo

    init() {
        do {
            repo = try Repo()
        } catch {
            fatalError("padel: could not open the store: \(error)")
        }
        match = repo.loadMatch()
        config = repo.loadConfig()
    }

    private func update(_ next: Match?) {
        guard let next else { return }
        match = next
        repo.saveMatch(next)
    }

    func play(_ side: Side) { update(match.winPoint(config, side)) }
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

    /// Partido nuevo: lo jugado se guarda en tus resultados. Sin guardar no se reinicia: el
    /// marcador sigue ahí para no perder el partido.
    func newMatch() {
        guard match.hasProgress else { return update(match.reset()) }
        let r = MatchResult(
            id: UUID().uuidString.lowercased(), date: Int64(Date().timeIntervalSince1970 * 1000),
            left: match.names.left.isEmpty ? L("team_a") : match.names.left,
            right: match.names.right.isEmpty ? L("team_b") : match.names.right,
            sets: match.currentSets()
        )
        do {
            try repo.saveResult(r)
        } catch {
            NSLog("padel: could not save result: %@", String(describing: error))
            self.error = L("result_save_failed", String(describing: error))
            return
        }
        update(match.reset())
    }

    func results() throws -> [MatchResult] { try repo.loadResults().sorted { $0.date > $1.date } }
    func deleteResult(_ id: String) throws { try repo.deleteResult(id) }
}

/// El marcador: la portada de la app, como en la PWA. Tocar el panel de una pareja le da el
/// punto; los +/− corrigen sets, juegos y puntos sin deshacer jugadas.
struct ScoreboardView: View {
    @ObservedObject var model: ScoreboardModel
    @ObservedObject private var lang = DotrinoLang.shared
    @State private var sheet: Sheet?
    @State private var confirmNew = false

    enum Sheet: String, Identifiable { case results, options; var id: String { rawValue } }

    var body: some View {
        VStack(spacing: 0) {
            DotrinoTopbar(repo: "imdotrino/dotrino-padel-contador", brand: .init(name: "Padel", image: Image("Brand"))) {
                Button(L("results").uppercased()) { sheet = .results }
                    .font(.footnote.weight(.bold)).foregroundColor(Palette.muted).lineLimit(1)
                    .accessibilityIdentifier("results-btn")
                Button { sheet = .options } label: { Text("☰").font(.title3) }
                    .foregroundColor(Palette.muted)
                    .accessibilityLabel(L("options_title"))
                    .accessibilityIdentifier("options-btn")
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
            controls
        }
        .background(Palette.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(item: $sheet) { s in
            switch s {
            case .results: ResultsSheet(model: model)
            case .options: OptionsSheet(model: model)
            }
        }
        .alert(L("new_match_title"), isPresented: $confirmNew) {
            Button(L("cancel"), role: .cancel) {}
            Button(L("new_match_ok")) { model.newMatch() }
        } message: { Text(L("confirm_new")) }
        .alert(model.error ?? "", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private var controls: some View {
        HStack(spacing: 0) {
            control(L("undo")) { model.undo() }
            control(L("serve_btn"), accent: true) { model.switchServer() }
            control(L("new_match")) {
                if model.match.hasProgress { confirmNew = true } else { model.newMatch() }
            }
        }
        .background(Palette.bg)
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
                meta(.s, value: score.s, total: cfg.sets == 1 ? 0 : cfg.sets, label: L("sets"), big: true)
            }
            meta(.g, value: score.g, total: 0, label: L("games"), big: false)
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
            Text(model.match.now.server == side ? "● \(L("serve")) \(model.match.player)" : " ")
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
        let placeholder = L(side == .left ? "team_a" : "team_b").uppercased()
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
                    .onTapGesture { startEditing(current) }
            }
            Button { startEditing(current) } label: { Text("✎") }
                .foregroundColor(Palette.text)
                .accessibilityLabel(L("edit_name"))
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
