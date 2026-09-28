import AVFoundation
import DotrinoNativeUI
import SwiftUI
import UIKit

/// La app: el marcador (la portada) y las pestañas del torneo, como la PWA.
struct AppView: View {
    @StateObject private var tours: TournamentModel
    @StateObject private var score: ScoreboardModel
    @ObservedObject private var lang = DotrinoLang.shared
    @State private var sheet: Sheet?
    @Environment(\.scenePhase) private var phase

    enum Sheet: Identifiable {
        case results, rules
        var id: Int { hashValue }
    }

    private static let tabs = ["score", "setup", "rules", "table", "matches"]
    private static let tabLabels = ["score": "tabScore", "setup": "tabSetup", "rules": "tabRules", "table": "tabTable", "matches": "tabMatches"]

    init() {
        let t = TournamentModel()
        _tours = StateObject(wrappedValue: t)
        _score = StateObject(wrappedValue: ScoreboardModel(tours: t))
    }

    var body: some View {
        // Un solo reloj para los cronómetros: el de la ronda en Partidos y la cuenta atrás del
        // partido en el marcador.
        TimelineView(.periodic(from: .now, by: 0.5)) { ctx in
            let now = Int64(ctx.date.timeIntervalSince1970 * 1000)
            content(now)
                .onChange(of: now) { Ticker.shared.tick(tours, score, $0) }
        }
        .background(Palette.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .onAppear { if tours.status == "idle" { tours.load() } }
        // Lo que quedó sin escribir se escribe antes de que el sistema congele la app.
        .onChange(of: phase) { if $0 != .active { tours.flush() } }
        .sheet(item: $sheet, onDismiss: { tours.changed() }) { s in
            switch s {
            case .results: ResultsSheet(model: score)
            case .rules:
                SheetFrame(title: t("rulesH"), onClose: { sheet = nil }) {
                    RulesForm(tours: tours) { sheet = nil }
                }
            }
        }
        .alert(tours.question?.title ?? "", isPresented: Binding(get: { tours.question != nil }, set: { if !$0 { tours.question = nil } }), presenting: tours.question) { q in
            Button(q.cancel, role: .cancel) {}
            Button(q.ok, role: q.danger ? .destructive : nil) { q.onYes() }
        } message: { q in Text(q.text) }
        .overlay(alignment: .bottom) {
            if let msg = tours.toast {
                Text(msg)
                    .font(.subheadline.weight(.semibold)).foregroundColor(Palette.text)
                    .padding(14).background(Palette.surface2).clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16).padding(.bottom, 90)
                    .onTapGesture { tours.toast = nil }
                    .task(id: msg) {
                        try? await Task.sleep(nanoseconds: 4_000_000_000)
                        if tours.toast == msg { tours.toast = nil }
                    }
            }
        }
    }

    @ViewBuilder private func content(_ now: Int64) -> some View {
        VStack(spacing: 0) {
            DotrinoTopbar(repo: "imdotrino/dotrino-padel-contador", brand: .init(name: "Padel", image: Image("Brand"))) {
                Button(t("rulesBtn").uppercased()) { openRules(nil) }
                    .font(.footnote.weight(.bold)).foregroundColor(Palette.muted).lineLimit(1)
                    .accessibilityIdentifier("rules-btn")
                Button(t("results").uppercased()) { sheet = .results }
                    .font(.footnote.weight(.bold)).foregroundColor(Palette.muted).lineLimit(1)
                    .accessibilityIdentifier("results-btn")
            }
            HStack(spacing: 0) {
                ForEach(Self.tabs, id: \.self) { name in
                    Button { tours.tab = name } label: {
                        Text(t(Self.tabLabels[name]!))
                            .font(.subheadline.weight(.heavy)).lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundColor(tours.tab == name ? Palette.text : Palette.muted)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                            .overlay(alignment: .bottom) { Rectangle().fill(tours.tab == name ? Palette.accent : .clear).frame(height: 3) }
                    }
                    .accessibilityIdentifier("tab-\(name)")
                    .accessibilityAddTraits(tours.tab == name ? .isSelected : [])
                }
            }
            .background(Palette.bg)
            if tours.tab == "score" {
                ScoreboardView(model: score, now: now)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        switch tours.tab {
                        case "setup": SetupTab(tours: tours, openRules: openRules)
                        case "rules": RulesTab(tours: tours, formHere: sheet != .rules)
                        case "table": TableTab(tours: tours)
                        default: MatchesTab(tours: tours, score: score, now: now)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 900)
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    /// El modal de reglas, desde cualquier pestaña. Sin `rulesetId`, con las del torneo abierto.
    private func openRules(_ rulesetId: String?) {
        tours.loadForm(rulesetId)
        sheet = .rules
    }
}

/// Avisa UNA vez cuando un cronómetro llega a cero con la app abierta (sonido y vibración) y
/// deja la pantalla encendida mientras corre: el aviso tiene que sonar.
@MainActor
final class Ticker {
    static let shared = Ticker()
    private var seen: [String: String] = [:]

    func tick(_ tours: TournamentModel, _ score: ScoreboardModel, _ now: Int64) {
        var running = false
        if tours.status == "ready", let tour = tours.active() {
            for (i, r) in tour.rounds.enumerated() where r.clock != nil {
                let st = Engine.clockOf(tour, r, now)
                let before = seen[r.id]
                seen[r.id] = st.state
                if st.state == "running" { running = true }
                if before == "running" && st.state == "done" {
                    ring()
                    tours.toast = t("timeUp", ["n": i + 1])
                }
            }
        }
        score.tick(now)
        UIApplication.shared.isIdleTimerDisabled = running
    }

    private func ring() {
        AudioServicesPlayAlertSound(SystemSoundID(1005))
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}
