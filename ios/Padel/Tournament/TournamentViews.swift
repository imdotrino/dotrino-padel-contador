import SwiftUI
import UIKit

// Las pestañas del torneo (Torneo, Reglas, Tabla y Partidos): el puerto de las páginas de
// src/tournament/view.js en SwiftUI. Leen y cambian `TournamentModel`.

private let red = Color(hex: 0xF87171)

private func sectionLabel(_ s: String) -> some View {
    Text(s.uppercased()).font(.footnote.weight(.heavy)).kerning(0.6).foregroundColor(Palette.muted)
}

private func hint(_ s: String, warn: Bool = false) -> some View {
    Text(s).font(.footnote).foregroundColor(warn ? red : Palette.muted).padding(.vertical, 4)
}

private struct AppButton: View {
    let title: String
    var filled = false
    var danger = false
    var enabled = true
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            Text(title).font(.subheadline.weight(.bold))
                .foregroundColor(filled ? Palette.onAccent : Palette.text)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(danger ? Palette.danger : filled ? Palette.accent : Palette.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

private struct IconButton: View {
    let text: String
    let label: String
    var enabled = true
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            Text(text).foregroundColor(Palette.muted).frame(width: 44, height: 44)
                .background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
        }
        .disabled(!enabled).opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

/// Mientras el almacén no está listo, las páginas del torneo solo dicen eso.
private struct StoreGate<Content: View>: View {
    @ObservedObject var tours: TournamentModel
    @ViewBuilder let content: () -> Content

    var body: some View {
        if tours.status == "ready" {
            content()
        } else if tours.status == "error" {
            VStack(alignment: .leading, spacing: 10) {
                Text(t("storeFailed", ["reason": tours.loadError ?? ""])).foregroundColor(Palette.text)
                AppButton(title: t("retry")) { tours.load() }
            }
            .padding(14).background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        } else {
            Text(t("storeLoading")).foregroundColor(Palette.muted)
        }
    }
}

private struct EmptyStateView: View {
    @ObservedObject var tours: TournamentModel
    var body: some View {
        VStack(spacing: 12) {
            Text(t("noTournament")).foregroundColor(Palette.muted).padding(.top, 24)
            AppButton(title: t("newTournament"), filled: true) { tours.startDraft() }.accessibilityIdentifier("new-tournament")
        }
        .frame(maxWidth: .infinity)
    }
}

/// Las fichas van en filas que se parten (el `flex-wrap` de la PWA).
private struct Flow: Layout {
    var gap: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > width { x = 0; y += line + gap; line = 0 }
            x += s.width + gap
            line = max(line, s.height)
        }
        return CGSize(width: width, height: y + line)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0 && x + s.width > bounds.width { x = 0; y += line + gap; line = 0 }
            v.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: .unspecified)
            x += s.width + gap
            line = max(line, s.height)
        }
    }
}

/// Un set en una lista: el nombre y sus fichas. `on`: el elegido (Torneo) o el que se edita (Reglas).
private struct RulesetCard: View {
    @ObservedObject var tours: TournamentModel
    let tour: Tournament
    let set: Ruleset
    let on: Bool
    let blocked: Bool
    let run: () -> Void

    var body: some View {
        Button(action: run) {
            VStack(alignment: .leading, spacing: 8) {
                Text((on ? "● " : "○ ") + set.name).font(.headline).foregroundColor(Palette.text)
                Flow {
                    ForEach(Array(tours.rulesChips(tour, set.settings).enumerated()), id: \.offset) { _, chip in
                        Text(chip.0).font(.caption.weight(.bold))
                            .foregroundColor(chip.1 ? red : on ? Palette.text : Palette.muted)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Palette.bg).clipShape(Capsule())
                            .overlay(Capsule().stroke(chip.1 ? red : Palette.border))
                    }
                }
                if blocked { hint(t("rulesetBlocked")) }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? Palette.accent.opacity(0.1) : Palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Palette.accent : Palette.border))
        }
        .disabled(blocked).opacity(blocked ? 0.55 : 1)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: - Torneo

struct SetupTab: View {
    @ObservedObject var tours: TournamentModel
    let openRules: (String?) -> Void

    var body: some View {
        StoreGate(tours: tours) {
            VStack(alignment: .leading, spacing: 12) {
                history
                if let tour = tours.current() { form(tour) } else { EmptyStateView(tours: tours) }
            }
        }
    }

    @ViewBuilder private var history: some View {
        if !tours.list.isEmpty {
            sectionLabel(t("myTournaments"))
            Segmented(options: Engine.historyPeriods.map { ($0, t("period_\($0)")) }, selected: tours.historyPeriod) { tours.historyPeriod = $0 }
            let list = tours.history()
            if list.isEmpty { hint(t("periodEmpty")) }
            ForEach(list) { tour in
                let st = Engine.status(tour)
                let size = Engine.isFixed(tour) ? t("teamsCount", ["n": tour.teams.filter(\.active).count]) : t("playersCount", ["n": tour.players.filter(\.active).count])
                let phase = st.finished ? t("stateFinished") : !tour.rounds.isEmpty ? t("stateRound", ["n": tour.rounds.count]) : t("stateNotStarted")
                let current = tour.id == tours.activeId
                HStack(spacing: 6) {
                    Button { tours.open(tour.id) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tour.name).font(.subheadline.weight(.bold)).foregroundColor(Palette.text)
                            Text("\(tours.formatDate(tour.createdAt)) · \(size) · \(phase)").font(.caption).foregroundColor(Palette.muted)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(current ? Palette.accent : Palette.border))
                    }
                    .accessibilityIdentifier("open-tournament")
                    IconButton(text: "✕", label: t("deleteTournament")) { tours.deleteTournament(tour) }
                }
            }
            Spacer().frame(height: 8)
        }
    }

    @ViewBuilder private func form(_ tour: Tournament) -> some View {
        let isDraft = tour === tours.draft
        Text(t(isDraft ? "newTournamentH" : "tournamentH")).font(.title2.weight(.bold)).foregroundColor(Palette.text)
        RuleRow(tours: tours, key: "name", text: tour.name) {
            NameField(value: tour.name, placeholder: t("name"), max: 40) { tours.rename($0) }
        }
        Roster(tours: tours, tour: tour)
        sectionLabel(t("rulesH")).padding(.top, 8)
        let sets = tours.rulesets()
        let own = sets.contains { $0.id == tour.rulesetId } ? [] : [Ruleset(id: "", name: t("rulesetOwn"), settings: tour.settings)]
        let chosenId = sets.contains { $0.id == tour.rulesetId } ? tour.rulesetId! : ""
        ForEach(own + sets) { set in
            let selected = set.id == chosenId
            HStack(alignment: .top, spacing: 6) {
                RulesetCard(tours: tours, tour: tour, set: set, on: selected, blocked: !selected && !Engine.canApplyRules(tour, set.settings)) {
                    tours.selectRuleset(set.id)
                }
                .accessibilityIdentifier("ruleset")
                IconButton(text: "✎", label: t("rulesetEditAria", ["name": set.name])) { openRules(set.id) }
                    .accessibilityIdentifier("edit-ruleset")
            }
        }
        let est = tours.estimateText(tour, tour.settings)
        if !est.isEmpty { hint(est) }
        let over = tours.courtsOver(tour, tour.settings)
        if !over.isEmpty { hint(over, warn: true) }
        let blocker = Engine.nextRoundBlocker(tour)
        HStack(spacing: 8) {
            if isDraft {
                AppButton(title: t("start"), filled: true, enabled: blocker == nil) { tours.startTournament() }.accessibilityIdentifier("start-tournament")
                AppButton(title: t("cancel")) { tours.cancelDraft() }
            } else {
                AppButton(title: t("newTournament")) { tours.startDraft() }.accessibilityIdentifier("new-tournament")
                AppButton(title: t("deleteTournament"), danger: true) { tours.deleteTournament(tour) }
            }
        }
        .padding(.top, 8)
        if isDraft && blocker == "players" {
            hint(t(Engine.isFixed(tour) ? "needTeams" : "needPlayers", ["n": Engine.minUnits(tour)]))
        }
    }
}

/// Un campo de texto que avisa de cada cambio (sin repintar la página al escribir).
private struct NameField: View {
    @State var value: String
    let placeholder: String
    let max: Int
    let onChange: (String) -> Void

    var body: some View {
        TextField(placeholder, text: $value)
            .onChange(of: value) { v in
                if v.count > max { value = String(v.prefix(max)) } else { onChange(v) }
            }
            .foregroundColor(Palette.text)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Palette.bg).clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
    }
}

private struct Roster: View {
    @ObservedObject var tours: TournamentModel
    let tour: Tournament
    @State private var name = ""
    @State private var a = ""
    @State private var b = ""
    @FocusState private var focus: String?

    var body: some View {
        let fixed = Engine.isFixed(tour)
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel(fixed ? t("teams", ["n": tour.teams.filter(\.active).count]) : t("players", ["n": tour.players.filter(\.active).count]))
                .padding(.top, 8)
            if fixed {
                ForEach(tour.teams, id: \.id) { team in
                    HStack(spacing: 6) {
                        NameField(value: tours.playerName(tour, team.players[0]), placeholder: t("playerPlaceholder"), max: 24) { tours.renamePlayer(team.players[0], $0) }
                        Text("/").foregroundColor(Palette.muted)
                        NameField(value: tours.playerName(tour, team.players[1]), placeholder: t("playerPlaceholder"), max: 24) { tours.renamePlayer(team.players[1], $0) }
                        unitButton(team.active, remove: { tours.removeTeam(team.id) }, restore: { tours.restore(team.id) })
                    }
                    .opacity(team.active ? 1 : 0.6)
                }
                HStack(spacing: 6) {
                    field(t("playerPlaceholder"), $a, "a").onSubmit { focus = "b" }
                    Text("/").foregroundColor(Palette.muted)
                    field(t("playerPlaceholder"), $b, "b").onSubmit(addTeam)
                    AppButton(title: t("add"), run: addTeam).accessibilityIdentifier("add-team")
                }
            } else {
                ForEach(tour.players, id: \.id) { p in
                    HStack(spacing: 6) {
                        NameField(value: p.name, placeholder: t("playerPlaceholder"), max: 24) { tours.renamePlayer(p.id, $0) }
                        unitButton(p.active, remove: { tours.removePlayer(p.id) }, restore: { tours.restore(p.id) })
                    }
                    .opacity(p.active ? 1 : 0.6)
                }
                HStack(spacing: 6) {
                    field(t("playerPlaceholder"), $name, "name").onSubmit(addPlayer).submitLabel(.next)
                        .accessibilityIdentifier("add-player")
                    AppButton(title: t("add"), run: addPlayer).accessibilityIdentifier("add-player-btn")
                }
            }
        }
    }

    private func field(_ placeholder: String, _ text: Binding<String>, _ key: String) -> some View {
        TextField(placeholder, text: text)
            .focused($focus, equals: key)
            .foregroundColor(Palette.text)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Palette.bg).clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
    }

    @ViewBuilder private func unitButton(_ active: Bool, remove: @escaping () -> Void, restore: @escaping () -> Void) -> some View {
        if active {
            IconButton(text: "✕", label: t("remove"), run: remove)
        } else {
            Text(t("retired")).font(.caption).foregroundColor(Palette.muted)
            AppButton(title: t("restore"), run: restore)
        }
    }

    private func addPlayer() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { focus = "name"; return }
        tours.addPlayer(String(n.prefix(24)))
        name = ""
        // El foco vuelve al campo de añadir: se meten varios seguidos.
        focus = "name"
    }

    private func addTeam() {
        let x = a.trimmingCharacters(in: .whitespaces)
        let y = b.trimmingCharacters(in: .whitespaces)
        guard !x.isEmpty else { focus = "a"; return }
        guard !y.isEmpty else { focus = "b"; return }
        tours.addTeam(String(x.prefix(24)), String(y.prefix(24)))
        a = ""; b = ""
        focus = "a"
    }
}

// MARK: - Reglas

/// Una regla: se LEE como texto, con «Editar» al lado; al pulsarlo aparecen sus opciones y su
/// explicación. `warn`: en rojo, y `note` dice qué pasará.
private struct RuleRow<Editor: View>: View {
    @ObservedObject var tours: TournamentModel
    let key: String
    let text: String
    var note = ""
    var warn = false
    @ViewBuilder let editor: () -> Editor
    private static var infos: Set<String> { ["partners", "pairing", "courts", "limit", "scoring", "matchEnd"] }

    var body: some View {
        let open = tours.openRule == key
        let label = t(key)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    sectionLabel(label)
                    Text(text).font(.body.weight(.semibold)).foregroundColor(warn ? red : Palette.text)
                        .accessibilityIdentifier("rule-\(key)-text")
                    if !note.isEmpty { hint(note, warn: warn) }
                }
                Spacer()
                Button { tours.openRule = open ? nil : key } label: {
                    Text(t(open ? "ruleDone" : "ruleEdit")).font(.footnote.weight(.bold))
                        .foregroundColor(open ? Palette.accent : Palette.text)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Palette.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .accessibilityLabel(t(open ? "ruleDoneAria" : "ruleEditAria", ["rule": label]))
                .accessibilityIdentifier("edit-\(key)")
            }
            if open {
                if Self.infos.contains(key) { Text(t("info_\(key)")).font(.subheadline).foregroundColor(Color(hex: 0xCBD5E1)) }
                editor()
            }
            Rectangle().fill(Palette.surface2).frame(height: 1)
        }
        .padding(.vertical, 12)
    }
}

/// Un contador «− valor +». `disabled`: se ve pero no se toca (su valor no aplica ahora).
private struct Counter: View {
    let value: Int
    let shown: String
    let range: ClosedRange<Int>
    var disabled = false
    let onStep: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button { onStep(-1) } label: { Text("−").font(.title3).frame(width: 44, height: 40) }
                .disabled(disabled || value <= range.lowerBound)
            Text(shown).font(.headline).frame(minWidth: 44)
            Button { onStep(1) } label: { Text("+").font(.title3).frame(width: 44, height: 40) }
                .disabled(disabled || value >= range.upperBound)
        }
        .foregroundColor(Palette.text)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
        .opacity(disabled ? 0.55 : 1)
    }
}

/// El formulario de reglas (pestaña Reglas o modal). `close` = cerrar el modal si es el modal.
struct RulesForm: View {
    @ObservedObject var tours: TournamentModel
    let close: () -> Void

    var body: some View {
        let tour = tours.rulesTour()
        let f = tours.formFor(tour)
        let s = f.settings
        let est = tours.estimateText(tour, s)
        let over = tours.courtsOver(tour, s)
        let builtin = f.source == "builtin"
        let others = tours.usedByOthers(f)
        let conflicts = Engine.settingsConflicts(s)
        let clash = { (k: String) in conflicts.contains(k) ? t("conflictRankedEveryone", ["limit": t("limitEveryone_\(s.partners)")]) : "" }
        let r = TournamentModel.ranges
        VStack(alignment: .leading, spacing: 0) {
            RuleRow(tours: tours, key: "rulesetName", text: f.name) {
                NameField(value: f.name, placeholder: t("rulesetName"), max: 40) { f.name = $0 }
            }
            RuleRow(tours: tours, key: "partners", text: t(s.partners == "rotating" ? "partnersRotating" : "partnersFixed")) {
                Segmented(options: [("rotating", t("partnersRotating")), ("fixed", t("partnersFixed"))], selected: s.partners) { tours.setRule("partners", $0) }
            }
            RuleRow(tours: tours, key: "pairing", text: t(s.pairing == "random" ? "pairingRandom" : "pairingRanked"), note: clash("pairing"), warn: conflicts.contains("pairing")) {
                Segmented(options: [("random", t("pairingRandom")), ("ranked", t("pairingRanked"))], selected: s.pairing) { tours.setRule("pairing", $0) }
            }
            RuleRow(tours: tours, key: "courts", text: tours.courtsSummary(tour, s), note: over, warn: !over.isEmpty) {
                let auto = s.courtsMode == "auto"
                let p = Tournament(id: tour.id, name: "", createdAt: 0, rulesetId: nil, settings: s)
                let _ = { p.players = tour.players; p.teams = tour.teams }()
                let max = Engine.maxCourts(p)
                let value = auto ? max : s.courts
                VStack(alignment: .leading, spacing: 10) {
                    Segmented(options: [("auto", t("courtsModeAuto")), ("fixed", t("courtsModeFixed"))], selected: s.courtsMode) { tours.setRule("courtsMode", $0) }
                    HStack(spacing: 12) {
                        Counter(value: value, shown: auto && max < 1 ? "—" : "\(value)", range: r["courts"]!, disabled: auto) { tours.step("courts", $0) }
                        Text(tn("unit_courts", value)).foregroundColor(Palette.muted)
                    }
                }
            }
            RuleRow(tours: tours, key: "limit", text: tours.limitSummary(tour, s) + (est.isEmpty ? "" : " · \(est)"), note: clash("limit"), warn: conflicts.contains("limit")) {
                let everyone = s.limitType == "everyone"
                let p = Tournament(id: tour.id, name: "", createdAt: 0, rulesetId: nil, settings: s)
                let _ = { p.players = tour.players; p.teams = tour.teams }()
                let each = everyone ? Engine.everyoneMatchesEach(p) : nil
                let value = everyone ? each ?? 0 : s.limitValue
                VStack(alignment: .leading, spacing: 10) {
                    Segmented(options: [("perPlayer", t("limitPerPlayer")), ("rounds", t("limitRounds")), ("matches", t("limitMatches")), ("everyone", t("limitEveryone_\(s.partners)"))],
                              selected: s.limitType) { tours.setRule("limitType", $0) }
                    HStack(spacing: 12) {
                        Counter(value: value, shown: everyone && each == nil ? "—" : "\(value)", range: r["limitValue"]!, disabled: everyone) { tours.step("limitValue", $0) }
                        Text(tn(everyone ? "unit_perPlayer" : "unit_\(s.limitType)", value)).foregroundColor(Palette.muted)
                    }
                    hint(est)
                }
            }
            RuleRow(tours: tours, key: "scoring", text: tours.scoringSummary(s)) {
                let on = Engine.scoreKinds.filter { s.scoring[$0].on }
                VStack(spacing: 8) {
                    ForEach(Engine.scoreKinds, id: \.self) { k in
                        let x = s.scoring[k]
                        HStack(spacing: 10) {
                            Button { tours.toggleScoring(k) } label: {
                                Text((x.on ? "✓ " : "") + t("scoring_\(k)")).font(.subheadline.weight(.bold))
                                    .foregroundColor(x.on ? Palette.onAccent : Palette.text)
                                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                                    .background(x.on ? Palette.accent : Palette.bg).clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Palette.border))
                            }
                            .disabled(x.on && on.count == 1)
                            Counter(value: x.points, shown: "\(x.points)", range: r["points"]!, disabled: !x.on) { tours.step("points-\(k)", $0) }
                            Text(t("unit_points")).foregroundColor(Palette.muted)
                        }
                    }
                }
            }
            RuleRow(tours: tours, key: "matchEnd", text: tours.matchEndSummary(s)) {
                let time = s.matchEnd == "time"
                VStack(alignment: .leading, spacing: 10) {
                    Segmented(options: [("time", t("matchEndTime")), ("games", t("matchEndGames"))], selected: s.matchEnd) { tours.setRule("matchEnd", $0) }
                    HStack(spacing: 12) {
                        Counter(value: s.matchMinutes, shown: "\(s.matchMinutes)", range: r["matchMinutes"]!, disabled: !time) { tours.step("matchMinutes", $0) }
                        Text(t("unit_minutes")).foregroundColor(Palette.muted)
                    }
                    HStack(spacing: 12) {
                        Counter(value: s.gamesPerMatch, shown: s.gamesPerMatch > 0 ? "\(s.gamesPerMatch)" : t("free"), range: r["gamesPerMatch"]!, disabled: time) { tours.step("gamesPerMatch", $0) }
                        Text(tn("unit_games", s.gamesPerMatch)).foregroundColor(Palette.muted)
                    }
                }
            }
            if !conflicts.isEmpty { hint(t("rulesConflictSave"), warn: true) }
            if builtin { hint(t("rulesetBuiltinNote")) }
            if others > 0 { hint(tn("rulesetUsedByPast", others)).accessibilityIdentifier("used-by-past") }
            HStack(spacing: 8) {
                AppButton(title: t("rulesetUpdate"), filled: others == 0, enabled: !builtin && others == 0 && conflicts.isEmpty) { tours.updateRuleset(close) }
                    .accessibilityIdentifier("update-ruleset")
                AppButton(title: t("rulesetSaveNew"), filled: others > 0, enabled: conflicts.isEmpty) { tours.saveRuleset(close) }
                    .accessibilityIdentifier("save-ruleset")
            }
            .padding(.top, 16)
        }
    }
}

struct RulesTab: View {
    @ObservedObject var tours: TournamentModel
    /// Con el modal abierto el formulario está solo en el modal: nunca dos copias a la vez.
    let formHere: Bool

    var body: some View {
        StoreGate(tours: tours) {
            VStack(alignment: .leading, spacing: 8) {
                Text(t("rulesH")).font(.title2.weight(.bold)).foregroundColor(Palette.text)
                let tour = tours.rulesTour()
                let sets = tours.rulesets()
                let withOwn = tours.current() != nil && !sets.contains { $0.id == tour.rulesetId }
                    ? [Ruleset(id: "", name: t("rulesetOwn"), settings: tour.settings)] + sets : sets
                ForEach(withOwn) { set in
                    HStack(alignment: .top, spacing: 6) {
                        RulesetCard(tours: tours, tour: tour, set: set, on: tours.editing(set.id), blocked: false) { tours.loadForm(set.id) }
                            .accessibilityIdentifier("rules-item")
                        IconButton(text: "✕", label: t("rulesetDelete", ["name": set.name]), enabled: set.builtin != true && !set.id.isEmpty) {
                            tours.deleteRuleset(set.id)
                        }
                        .accessibilityIdentifier("delete-ruleset")
                    }
                }
                if formHere { RulesForm(tours: tours) {}.padding(.top, 16) }
            }
        }
    }
}

// MARK: - Tabla

struct TableTab: View {
    @ObservedObject var tours: TournamentModel

    var body: some View {
        StoreGate(tours: tours) {
            if let tour = tours.active() {
                let rows = Engine.standings(tour)
                let finished = Engine.status(tour).finished
                let sets = tour.settings.scoring.sets.on
                let signed = { (n: Int) in n > 0 ? "+\(n)" : n < 0 ? "−\(-n)" : "0" }
                VStack(alignment: .leading, spacing: 0) {
                    Text(tour.name).font(.title2.weight(.bold)).foregroundColor(Palette.text)
                    Text("\(t("scoring")): \(tours.scoringSummary(tour.settings))").font(.footnote).foregroundColor(Palette.muted).padding(.bottom, 12)
                        .accessibilityIdentifier("scoring-summary")
                    row(["#", t(Engine.isFixed(tour) ? "colTeam" : "colPlayer"), t("colPlayed"), t("colWon")] + (sets ? [t("colSetDiff")] : []) + [t("colDiff"), t("colPoints")],
                        header: true, bg: Palette.surface)
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                        let rank = finished && i < 3 ? ["🥇", "🥈", "🥉"][i] : "\(i + 1)"
                        let name = tours.unitName(tour, r.id) + (r.active ? "" : " (\(t("retired")))")
                        row([rank, name, "\(r.played)", "\(r.won)"] + (sets ? [signed(r.setsFor - r.setsAgainst)] : []) + [signed(r.gamesFor - r.gamesAgainst), "\(r.points)"],
                            header: false, bg: i % 2 == 0 ? Palette.bg : Palette.surface)
                            .opacity(r.active ? 1 : 0.6)
                    }
                }
            } else { EmptyStateView(tours: tours) }
        }
    }

    private func row(_ cells: [String], header: Bool, bg: Color) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { i, c in
                Text(c).font(.subheadline.weight(header || i == cells.count - 1 ? .bold : .regular))
                    .foregroundColor(header ? Palette.muted : i == cells.count - 1 ? Palette.accent : Palette.text)
                    .lineLimit(1)
                    .frame(width: i == 1 ? nil : i == 0 ? 36 : 44, alignment: i == 1 ? .leading : .center)
                    .frame(maxWidth: i == 1 ? .infinity : nil, alignment: .leading)
                    .padding(.vertical, 8).padding(.horizontal, 4)
            }
        }
        .background(bg)
    }
}

// MARK: - Partidos

struct MatchesTab: View {
    @ObservedObject var tours: TournamentModel
    @ObservedObject var score: ScoreboardModel
    @ObservedObject var live: LiveShare
    let now: Int64
    @State private var shareLink: ShareItem?
    @State private var sharing = false

    struct ShareItem: Identifiable { let id = UUID(); let url: URL; let text: String }

    /// Compartir en vivo: los dos botones están siempre; «Dejar de compartir», deshabilitado si no se comparte.
    private func liveBar(_ tour: Tournament) -> some View {
        let on = live.isSharing(tour)
        let n = live.viewers[tour.id] ?? 0
        return HStack(spacing: 6) {
            Text(on ? t(n == 1 ? "liveOn_one" : "liveOn", ["n": n]) : t("liveOff"))
                .font(.footnote.weight(.bold)).foregroundColor(Palette.text)
                .accessibilityIdentifier("live-state")
            Spacer()
            AppButton(title: t("liveShare"), enabled: !sharing) {
                sharing = true
                Task {
                    defer { sharing = false }
                    do {
                        let link = try await live.share(tour)
                        // La clave del enlace se guarda con el torneo: así sobrevive a cerrar la app.
                        tours.save(tour)
                        tours.changed()
                        if let u = URL(string: link) { shareLink = ShareItem(url: u, text: t("liveShareText", ["name": tour.name])) }
                    } catch {
                        tours.toast = live.reason(error)
                    }
                }
            }
            .accessibilityIdentifier("live-share")
            AppButton(title: t("liveStop"), enabled: on) {
                tours.ask(t("liveStopTitle"), t("liveStopText"), t("liveStop"), danger: true) {
                    live.stop(tour)
                    tours.save(tour)
                    tours.changed()
                }
            }
            .accessibilityIdentifier("live-stop")
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Palette.accent : Palette.border))
        .sheet(item: $shareLink) { item in ShareSheet(items: [item.text, item.url]) }
    }

    var body: some View {
        StoreGate(tours: tours) {
            if let tour = tours.active() {
                VStack(alignment: .leading, spacing: 8) {
                    // Si este torneo se compartía (abierto desde «Mis torneos»), vuelve a emitirse.
                    liveBar(tour).onAppear { live.resume(tour) }
                    Text(tour.name).font(.title2.weight(.bold)).foregroundColor(Palette.text)
                    let st = Engine.status(tour)
                    let est = Engine.estimate(tour)
                    let total = max(est?.matches ?? 0, st.scheduled)
                    let approx = est != nil && !est!.exact && !st.reached
                    Text(t(approx ? "progressApprox" : "progress", ["scored": st.scored, "total": total])).font(.footnote).foregroundColor(Palette.muted)
                    ForEach(Array(tour.rounds.enumerated()), id: \.element.id) { i, r in round(tour, r, i) }
                    next(tour).padding(.top, 16)
                }
            } else { EmptyStateView(tours: tours) }
        }
    }

    @ViewBuilder private func round(_ tour: Tournament, _ r: Round, _ i: Int) -> some View {
        let last = i == tour.rounds.count - 1
        HStack {
            Text(t("round", ["n": i + 1])).font(.headline).foregroundColor(Palette.text)
            Spacer()
            if last {
                // Solo la última se rehace o se quita, y solo sin resultados.
                let can = Engine.canRedoLastRound(tour)
                AppButton(title: t("redo"), enabled: can) { tours.redo(tour) }.accessibilityIdentifier("redo-round")
                AppButton(title: t("dropRound"), enabled: can) { tours.drop(tour) }.accessibilityIdentifier("drop-round")
            }
        }
        .padding(.top, 18)
        if last && (tour.settings.matchEnd == "time" || r.clock != nil) { clock(tour, r) }
        ForEach(r.matches, id: \.id) { m in MatchCard(tours: tours, score: score, tour: tour, match: m) }
        if !r.rest.isEmpty { hint(t("resting", ["names": r.rest.map { tours.unitName(tour, $0) }.joined(separator: ", ")])) }
    }

    private func clock(_ tour: Tournament, _ r: Round) -> some View {
        let st = Engine.clockOf(tour, r, now)
        return HStack(spacing: 6) {
            Text(st.state == "done" ? t("clockDone") : Engine.formatClock(st.remainingMs))
                .font(.system(size: 28, weight: .bold, design: .monospaced)).foregroundColor(Palette.text)
                .accessibilityIdentifier("clock-time")
            Spacer()
            switch st.state {
            case "idle": AppButton(title: t("clockStart"), filled: true) { tours.clock(tour, r.id, "start") }
            case "running": AppButton(title: t("clockPause")) { tours.clock(tour, r.id, "pause") }
            case "paused": AppButton(title: t("clockResume"), filled: true) { tours.clock(tour, r.id, "resume") }
            default: AppButton(title: t("clockStart"), filled: true, enabled: false) {}
            }
            AppButton(title: t("clockReset"), enabled: st.state != "idle") { tours.clock(tour, r.id, "reset") }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(st.state == "running" ? Palette.accent : Palette.border))
        .accessibilityLabel(t("clockAria"))
    }

    @ViewBuilder private func next(_ tour: Tournament) -> some View {
        let blocker = Engine.nextRoundBlocker(tour)
        if blocker == "finished" && Engine.status(tour).finished {
            HStack {
                Text("🏆 \(t("finished"))").font(.headline).foregroundColor(Palette.text)
                Spacer()
                AppButton(title: t("seeTable")) { tours.tab = "table" }
            }
            .padding(14).background(Palette.win.opacity(0.2)).clipShape(RoundedRectangle(cornerRadius: 12))
        }
        Button { tours.nextRound(tour) } label: {
            Text(t("nextRound", ["n": tour.rounds.count + 1])).font(.headline).foregroundColor(Palette.onAccent)
                .frame(maxWidth: .infinity).padding(.vertical, 14).background(Palette.accent).clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(blocker != nil).opacity(blocker == nil ? 1 : 0.45)
        .accessibilityIdentifier("next-round")
        if blocker == "players" {
            VStack(alignment: .leading, spacing: 10) {
                Text(t(Engine.isFixed(tour) ? "needTeams" : "needPlayers", ["n": Engine.minUnits(tour)])).foregroundColor(Palette.text)
                AppButton(title: t("goSetup")) { tours.tab = "setup" }
            }
            .padding(14).background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        }
        if blocker == nil && tour.settings.pairing == "ranked", let last = tour.rounds.last, !last.matches.allSatisfy(Engine.hasScore) {
            hint(t("rankedPending", ["n": tour.rounds.count]))
        }
    }
}

/// Un partido de una ronda: sus dos lados con los campos del resultado.
private struct MatchCard: View {
    @ObservedObject var tours: TournamentModel
    @ObservedObject var score: ScoreboardModel
    let tour: Tournament
    let match: TMatch

    var body: some View {
        let linked = score.linkedMatchId == match.id
        let withSets = tour.settings.scoring.sets.on
        let w = Engine.outcome(match)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(t("court", ["n": match.court])).font(.footnote.weight(.bold)).foregroundColor(Palette.muted)
                Spacer()
                if linked { Text("● \(t("inScoreboard"))").font(.caption.weight(.bold)).foregroundColor(Palette.accent) }
                AppButton(title: t("play")) { score.playLinked(tour, match) }.accessibilityIdentifier("play-match")
            }
            if withSets {
                HStack {
                    Spacer()
                    Text(t("setsShort")).font(.caption2).foregroundColor(Palette.muted).frame(width: 52)
                    Text(t("gamesShort")).font(.caption2).foregroundColor(Palette.muted).frame(width: 52)
                }
            }
            ForEach(["a", "b"], id: \.self) { side in
                HStack(spacing: 6) {
                    Text(tours.sideName(tour, side == "a" ? match.a : match.b)).font(.subheadline.weight(.bold)).foregroundColor(Palette.text)
                    Spacer()
                    if withSets { ScoreField(tours: tours, tour: tour, match: match, kind: "sets", side: side) }
                    ScoreField(tours: tours, tour: tour, match: match, kind: "games", side: side)
                }
                .padding(.horizontal, 6).padding(.vertical, 4)
                .background(w == side ? Palette.win.opacity(0.15) : .clear).clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(12)
        .background(Palette.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(linked ? Palette.accent : Palette.border))
        .padding(.top, 8)
        .accessibilityIdentifier("match")
    }
}

/// Un campo de resultado. Escribir NO repinta la ronda (se perdería el foco del teclado).
private struct ScoreField: View {
    @ObservedObject var tours: TournamentModel
    let tour: Tournament
    let match: TMatch
    let kind: String
    let side: String
    @State private var text = ""

    var body: some View {
        TextField("", text: $text)
            .keyboardType(.numberPad)
            .multilineTextAlignment(.center)
            .font(.headline).foregroundColor(Palette.text)
            .frame(width: 52, height: 44)
            .background(Palette.bg).clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Palette.border))
            .accessibilityIdentifier("\(kind == "sets" ? "sets" : "score")-\(side)")
            .onAppear {
                let v = kind == "sets" ? match.sets : match.score
                text = (side == "a" ? v?.a : v?.b).map(String.init) ?? ""
            }
            .onChange(of: text) { v in
                let digits = String(v.filter(\.isNumber).prefix(2))
                if digits != v { text = digits; return }
                let other = kind == "sets" ? match.sets : match.score
                let mine = Int(digits).map { min(99, $0) }
                let a = side == "a" ? mine : other?.a
                let b = side == "b" ? mine : other?.b
                let current = side == "a" ? other?.a : other?.b
                if mine != current { tours.setScore(tour, match.id, kind, a, b) }
            }
    }
}

/// El menú de compartir del sistema (el enlace para mirar va por `#fragment`: no llega a ningún servidor).
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
