import DotrinoNativeUI
import SwiftUI

/// Las opciones del marcador: sets del partido y modo de puntuación. Se aplican al instante,
/// sin tocar el marcador.
struct OptionsSheet: View {
    @ObservedObject var model: ScoreboardModel
    @ObservedObject private var lang = DotrinoLang.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        SheetFrame(title: t("optionsH"), onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 10) {
                heading(t("matchSets"))
                Segmented(options: Config.setOptions.map { ($0, "\($0)") }, selected: model.config.sets) { model.setSets($0) }
                Text(t("desc_sets\(model.config.sets)"))
                    .font(.subheadline).foregroundColor(Palette.muted)
                    .padding(.bottom, 10)
                heading(t("scoringMode"))
                Segmented(options: [(Scoring.advantage, t("advantage")), (.star, t("doubleAdv")), (.golden, t("golden"))],
                          selected: model.config.scoring) { model.setScoring($0) }
                Text(t("desc_\(model.config.scoring.rawValue)"))
                    .font(.subheadline).foregroundColor(Palette.muted)
            }
        }
    }

    private func heading(_ t: String) -> some View {
        Text(t.uppercased()).font(.footnote.weight(.heavy)).foregroundColor(Palette.muted)
    }
}

/// Los resultados guardados en tu almacén, del más nuevo al más viejo.
struct ResultsSheet: View {
    @ObservedObject var model: ScoreboardModel
    @ObservedObject private var lang = DotrinoLang.shared
    @Environment(\.dismiss) private var dismiss
    @State private var list: [MatchResult]?
    @State private var failure: String?

    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "dd/MM HH:mm"
        return f
    }()

    var body: some View {
        SheetFrame(title: t("resultsH"), onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 0) {
                if let failure {
                    Text(failure).foregroundColor(Palette.muted)
                } else if let list, list.isEmpty {
                    Text(t("noResults")).foregroundColor(Palette.muted).padding(.vertical, 16)
                } else if let list {
                    ForEach(list) { r in row(r) }
                }
            }
        }
        .onAppear(perform: load)
    }

    private func load() {
        do {
            list = try model.results()
            failure = nil
        } catch {
            NSLog("padel: could not read results: %@", String(describing: error))
            failure = t("resultsLoadFailed", ["reason": String(describing: error)])
        }
    }

    private func row(_ r: MatchResult) -> some View {
        let leftWins = r.setsLeft > r.setsRight
        let rightWins = r.setsRight > r.setsLeft
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.fmt.string(from: Date(timeIntervalSince1970: Double(r.date) / 1000)))
                    .font(.caption).foregroundColor(Palette.muted)
                Text("\(leftWins ? "🏆 " : "")\(r.left) \(r.setsLeft) — \(r.setsRight) \(r.right)\(rightWins ? " 🏆" : "")")
                    .font(.headline).foregroundColor(Palette.text)
                Text(r.sets.map { "\($0.left)-\($0.right)" }.joined(separator: "  "))
                    .font(.footnote).foregroundColor(Palette.muted)
            }
            Spacer()
            Button(t("delete")) {
                do {
                    try model.deleteResult(r.id)
                } catch {
                    NSLog("padel: could not delete result: %@", String(describing: error))
                    failure = t("resultDeleteFailed", ["reason": String(describing: error)])
                    return
                }
                load()
            }
            .font(.subheadline.weight(.bold)).foregroundColor(.white)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Palette.danger).clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .padding(.vertical, 10)
    }
}

/// La forma de los modales de la PWA en un teléfono: una hoja con título y ✕.
struct SheetFrame<Content: View>: View {
    let title: String
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title.uppercased()).font(.headline.weight(.heavy)).foregroundColor(Palette.text)
                Spacer()
                Button(action: onClose) { Text("✕").font(.title2) }
                    .foregroundColor(Palette.text)
                    .accessibilityLabel(t("close"))
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 8)
            ScrollView { content().padding(.horizontal, 20).padding(.bottom, 24) }
        }
        .background(Palette.surface.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .preferredColorScheme(.dark)
    }
}

/// Un grupo de opciones excluyentes (el `.seg` de la PWA).
struct Segmented<T: Equatable>: View {
    let options: [(T, String)]
    let selected: T
    let onPick: (T) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options.indices, id: \.self) { i in
                let (v, text) = options[i]
                let on = v == selected
                Button { onPick(v) } label: {
                    Text(text)
                        .font(.subheadline.weight(.bold))
                        .foregroundColor(on ? Palette.onAccent : Palette.text)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(on ? Palette.accent : Palette.bg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Palette.border))
                }
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}
