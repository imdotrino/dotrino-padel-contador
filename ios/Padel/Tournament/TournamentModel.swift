import DotrinoNative
import Foundation
import SwiftUI

/// Los torneos del usuario y lo que hacen las pestañas del torneo: el puerto de
/// `src/tournament/repo.js` y `view.js` (la PWA va delante, CONVENCIONES §16.1), y el mismo que
/// `TournamentRepo.kt` + `TournamentController.kt`. Mismos hilos del almacén que la PWA:
/// `padel.tournaments`, `padel.meta` y `padel.rulesets`.
///
/// Los torneos son clases que el motor edita en el sitio: después de cada cambio se avisa a
/// la pantalla con `objectWillChange` (`changed()`).
@MainActor
final class TournamentModel: ObservableObject {
    static let thread = "padel.tournaments"
    static let metaThread = "padel.meta"
    static let rulesThread = "padel.rulesets"
    static let ranges: [String: ClosedRange<Int>] = ["courts": 1...20, "limitValue": 1...99, "gamesPerMatch": 0...20, "matchMinutes": 5...120, "points": 1...10]

    private let store: DotrinoStore
    private let io = DispatchQueue(label: "padel.store")

    @Published private(set) var status = "idle" // idle | loading | ready | error
    private(set) var loadError: String?
    private(set) var list: [Tournament] = []
    private(set) var activeId: String?
    private(set) var rulesetsSaved: [Ruleset] = []

    // Lo que la pantalla enseña o pregunta.
    @Published var toast: String?
    @Published var question: Question?
    @Published var tab = "score"

    struct Question: Identifiable {
        let id = UUID()
        let title: String
        let text: String
        let ok: String
        var cancel = t("cancel")
        var danger = false
        let onYes: () -> Void
    }

    /// El formulario de reglas. `source`: "set", "own" (el set del torneo ya no existe) o
    /// "builtin" («Default», no se edita).
    final class RuleForm {
        let source: String
        let baseId: String?
        let baseName: String
        var name: String
        let settings: Settings
        init(source: String, baseId: String?, baseName: String, settings: Settings) {
            self.source = source; self.baseId = baseId; self.baseName = baseName; self.name = baseName; self.settings = settings
        }
    }

    private(set) var draft: Tournament?
    var openRule: String? { didSet { changed() } }
    private(set) var ruleForm: RuleForm?
    var historyPeriod = "today" { didSet { changed() } }
    private var probe: Tournament?
    private var correctionNoted = Set<String>()

    init() {
        do { store = try DotrinoStore(app: "padel") } catch { fatalError("padel: could not open the store: \(error)") }
    }

    func changed() { objectWillChange.send() }

    private func fail(_ e: Error) { toast = t("saveFailed", ["reason": String(describing: e)]) }

    // MARK: almacén

    private func docs<T: Decodable>(_ thread: String, _ type: T.Type) throws -> [T] { try store.listDocs(thread, as: T.self) }

    func load() {
        status = "loading"
        loadError = nil
        io.async { [store] in
            do {
                let tours = try store.listDocs(Self.thread, as: Tournament.self)
                let meta = try store.listThread(Self.metaThread)
                let sets = try store.listDocs(Self.rulesThread, as: Ruleset.self)
                for s in sets { try Engine.checkSettings(s.settings) }
                let active = meta.last?["doc"]?["activeId"]?.string
                DispatchQueue.main.async {
                    self.list = tours
                    self.rulesetsSaved = sets
                    self.activeId = tours.contains { $0.id == active } ? active : nil
                    self.status = "ready"
                }
            } catch {
                NSLog("padel: could not load tournaments: %@", String(describing: error))
                DispatchQueue.main.async { self.status = "error"; self.loadError = String(describing: error) }
            }
        }
    }

    func active() -> Tournament? { list.first { $0.id == activeId } }

    private var pending: [String: Tournament] = [:]
    private var flushTask: DispatchWorkItem?

    /// Guardar agrupa los cambios seguidos (un marcador dígito a dígito) en una escritura.
    func save(_ tour: Tournament) {
        precondition(status == "ready", "cannot save a tournament while the store is \(status)")
        tour.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        if !list.contains(where: { $0 === tour }) { list.append(tour) }
        pending[tour.id] = tour
        flushTask?.cancel()
        let task = DispatchWorkItem { [weak self] in self?.flush() }
        flushTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: task)
    }

    /// Lo que quedó sin escribir, ya (al ir la app a segundo plano).
    func flush() {
        flushTask?.cancel()
        guard !pending.isEmpty else { return }
        // Se codifica AQUÍ, en el hilo de la pantalla: el objeto no cambia a medias.
        let batch: [(String, Data, Tournament)] = pending.values.compactMap { tour in
            (try? JSONEncoder().encode(tour)).map { (tour.id, $0, tour) }
        }
        pending.removeAll()
        io.async { [store] in
            for (id, data, tour) in batch {
                do {
                    let doc = try JSON.parse(data)
                    try store.appendMessage(Self.thread, .object(["id": .string(id), "ts": .int(nowMs()), "doc": doc]))
                } catch {
                    NSLog("padel: could not save tournament %@: %@", id, String(describing: error))
                    DispatchQueue.main.async { self.pending[id] = tour; self.fail(error) } // se reintenta con el próximo guardado
                }
            }
        }
    }

    func setActive(_ id: String?) {
        activeId = id
        io.async { [store] in
            do {
                try store.appendMessage(Self.metaThread, .object(["id": "meta", "ts": .int(nowMs()), "doc": .object(["activeId": id.map { .string($0) } ?? .null])]))
            } catch {
                NSLog("padel: could not save the open tournament: %@", String(describing: error))
                DispatchQueue.main.async { self.fail(error) }
            }
        }
    }

    private func removeTournament(_ id: String) {
        pending[id] = nil
        list.removeAll { $0.id == id }
        if activeId == id { setActive(nil) }
        io.async { [store] in
            do { try store.removeMessage(Self.thread, id: id) } catch {
                NSLog("padel: could not delete tournament %@: %@", id, String(describing: error))
                DispatchQueue.main.async { self.fail(error) }
            }
        }
    }

    /// Un set se escribe primero y solo entonces entra en la lista.
    private func storeRuleset(_ set: Ruleset, _ done: @escaping (Bool) -> Void) {
        io.async { [store] in
            do {
                try store.putDoc(Self.rulesThread, id: set.id, set)
                DispatchQueue.main.async {
                    self.rulesetsSaved = self.rulesetsSaved.filter { $0.id != set.id } + [set]
                    done(true)
                }
            } catch {
                NSLog("padel: could not save the rules: %@", String(describing: error))
                DispatchQueue.main.async { self.fail(error); done(false) }
            }
        }
    }

    // MARK: lo común

    func current() -> Tournament? { draft ?? active() }

    /// Sin torneo, las reglas se miden contra uno vacío con «Default».
    func rulesTour() -> Tournament {
        if let c = current() { return c }
        if let p = probe { return p }
        let base = Engine.builtinRulesets()[0]
        let p = Engine.createTournament(settings: base.settings, rulesetId: base.id)
        probe = p
        return p
    }

    func ask(_ title: String, _ text: String, _ ok: String, danger: Bool = false, cancel: String = t("cancel"), _ onYes: @escaping () -> Void) {
        question = Question(title: title, text: text, ok: ok, cancel: cancel, danger: danger, onYes: onYes)
    }

    // MARK: nombres

    func playerName(_ tour: Tournament, _ pid: String) -> String {
        guard let p = tour.players.first(where: { $0.id == pid }) else { preconditionFailure("unknown player \(pid)") }
        return p.name
    }

    func sideName(_ tour: Tournament, _ ids: [String]) -> String { ids.map { playerName(tour, $0) }.joined(separator: " / ") }

    func unitName(_ tour: Tournament, _ id: String) -> String {
        if !Engine.isFixed(tour) { return playerName(tour, id) }
        guard let team = tour.teams.first(where: { $0.id == id }) else { preconditionFailure("unknown team \(id)") }
        return sideName(tour, team.players)
    }

    func formatDate(_ ms: Int64) -> String {
        let f = DateFormatter()
        f.dateFormat = "dd/MM"
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    // MARK: resúmenes de reglas

    private func probe(_ tour: Tournament, _ s: Settings) -> Tournament {
        let p = Tournament(id: tour.id, name: tour.name, createdAt: tour.createdAt, rulesetId: tour.rulesetId, settings: s)
        p.players = tour.players; p.teams = tour.teams; p.rounds = tour.rounds
        return p
    }

    func scoringSummary(_ s: Settings) -> String {
        Engine.scoreKinds.filter { s.scoring[$0].on }.map { t("pointsPer_\($0)", ["n": s.scoring[$0].points]) }.joined(separator: " · ")
    }

    func matchEndSummary(_ s: Settings) -> String {
        s.matchEnd == "time" ? t("matchEndSummaryTime", ["n": s.matchMinutes])
            : s.gamesPerMatch > 0 ? tn("matchEndSummaryGames", s.gamesPerMatch) : t("matchEndSummaryFree")
    }

    func courtsOver(_ tour: Tournament, _ s: Settings) -> String {
        if s.courtsMode == "auto" { return "" }
        let p = probe(tour, s)
        let max = Engine.maxCourts(p)
        if max < 1 || s.courts <= max { return "" }
        return tn(Engine.isFixed(p) ? "courtsOverTeams" : "courtsOverPlayers", max, ["units": Engine.activeUnits(p).count, "n": max])
    }

    func courtsSummary(_ tour: Tournament, _ s: Settings) -> String {
        if s.courtsMode != "auto" { return tn("courtsCount", s.courts) }
        let p = probe(tour, s)
        let max = Engine.maxCourts(p)
        let base = t(Engine.isFixed(p) ? "courtsAutoTeams" : "courtsAutoPlayers")
        return max >= 1 ? "\(base) · \(tn("courtsCount", max))" : base
    }

    func estimateText(_ tour: Tournament, _ s: Settings) -> String {
        guard let est = Engine.estimate(probe(tour, s)) else { return "" }
        return t(est.exact ? "estimateExact" : "estimate", ["matches": est.matches, "rounds": est.rounds]) +
            (s.matchEnd == "time" ? " · " + t("estimateMinutes", ["n": est.rounds * s.matchMinutes]) : "")
    }

    func limitSummary(_ tour: Tournament, _ s: Settings) -> String {
        if s.limitType != "everyone" { return "\(s.limitValue) \(tn("unit_\(s.limitType)", s.limitValue))" }
        let name = t("limitEveryone_\(s.partners)")
        guard let each = Engine.everyoneMatchesEach(probe(tour, s)) else { return name }
        return "\(name) · \(each) \(tn("unit_perPlayer", each))"
    }

    func rulesChips(_ tour: Tournament, _ s: Settings) -> [(String, Bool)] {
        [(t("partnersSummary_\(s.partners)"), false), (t("pairingSummary_\(s.pairing)"), false),
         (courtsSummary(tour, s), !courtsOver(tour, s).isEmpty), (limitSummary(tour, s), false),
         (scoringSummary(s), false), (matchEndSummary(s), false)]
    }

    // MARK: sets de reglas

    func rulesets() -> [Ruleset] { Engine.builtinRulesets() + rulesetsSaved.sorted { $0.createdAt < $1.createdAt } }

    private func formFrom(_ set: Ruleset?, _ settings: Settings) -> RuleForm {
        let source = set == nil ? "own" : set!.builtin == true ? "builtin" : "set"
        return RuleForm(source: source, baseId: set?.id, baseName: set?.name ?? t("rulesetOwn"), settings: settings.copy())
    }

    func formFor(_ tour: Tournament) -> RuleForm {
        if let f = ruleForm { return f }
        let f = formFrom(rulesets().first { $0.id == tour.rulesetId }, tour.settings)
        ruleForm = f
        return f
    }

    func editing(_ id: String) -> Bool {
        let f = formFor(rulesTour())
        return id.isEmpty ? f.source == "own" : f.baseId == id
    }

    func usedByOthers(_ f: RuleForm) -> Int {
        guard f.source == "set" else { return 0 }
        let cur = current()
        return list.filter { $0.rulesetId == f.baseId && $0 !== cur }.count
    }

    /// Cargar un set ("" = las reglas propias del torneo) en el formulario, sin tocar el torneo.
    func loadForm(_ id: String?) {
        defer { changed() }
        guard let id else { ruleForm = nil; openRule = nil; return }
        let set = id.isEmpty ? nil : rulesets().first { $0.id == id }
        precondition(id.isEmpty || set != nil, "unknown ruleset \(id)")
        ruleForm = formFrom(set, set?.settings ?? rulesTour().settings)
        openRule = nil
    }

    private func copyName(_ base: String) -> String {
        func taken(_ n: String) -> Bool { rulesets().contains { $0.name.lowercased() == n.lowercased() } }
        var name = t("rulesetCopyName", ["name": base])
        var n = 2
        while taken(name) { name = t("rulesetCopyNameN", ["name": base, "n": n]); n += 1 }
        return name
    }

    private func nameProblem(_ name: String, _ exceptId: String?) -> String? {
        if name.isEmpty { return "rulesetNeedsName" }
        return rulesets().contains { $0.id != exceptId && $0.name.lowercased() == name.lowercased() } ? "rulesetNameTaken" : nil
    }

    private func showNameProblem(_ key: String) {
        openRule = "rulesetName"
        toast = t(key)
    }

    private func useRules(_ tour: Tournament, _ settings: Settings, _ rulesetId: String?, _ then: @escaping (Bool) -> Void) {
        guard Engine.canApplyRules(tour, settings) else { return then(false) }
        let go = {
            do { try Engine.applyRules(tour, settings) } catch { preconditionFailure("apply rules: \(error)") }
            tour.rulesetId = rulesetId
            then(true)
        }
        if settings.partners != tour.settings.partners && !tour.rounds.isEmpty {
            ask(t("partnersChangeTitle"), t("partnersChangeText"), t("change"), go)
        } else { go() }
    }

    private func commit(_ tour: Tournament) {
        if tour !== draft && tour !== probe { save(tour) }
        changed()
    }

    func selectRuleset(_ id: String) {
        guard let tour = current() else { return }
        let set = id.isEmpty ? nil : rulesets().first { $0.id == id }
        if let set, set.id != tour.rulesetId { useRules(tour, set.settings, set.id) { _ in self.commit(tour) } } else { commit(tour) }
    }

    func saveRuleset(_ done: @escaping () -> Void) {
        guard let f = ruleForm else { return }
        let tour = current()
        let typed = f.name.trimmingCharacters(in: .whitespaces)
        let name = typed == f.baseName ? copyName(f.baseName) : typed
        if let p = nameProblem(name, nil) { return showNameProblem(p) }
        let set = Ruleset(id: UUID().uuidString.lowercased(), name: name, createdAt: nowMs(), settings: f.settings.copy())
        storeRuleset(set) { ok in
            guard ok else { return }
            self.ruleForm = self.formFrom(set, set.settings)
            self.openRule = nil
            done()
            guard let tour else { self.changed(); self.toast = t("rulesetSavedOnly", ["name": name]); return }
            self.useRules(tour, set.settings, set.id) { chosen in
                self.commit(tour)
                self.toast = t(chosen ? "rulesetSavedChosen" : "rulesetSaved", ["name": name])
            }
        }
    }

    func updateRuleset(_ done: @escaping () -> Void) {
        guard let f = ruleForm else { return }
        let tour = current()
        precondition(f.source != "builtin", "the built-in rules cannot be changed")
        precondition(usedByOthers(f) == 0, "ruleset is used by other tournaments")
        if f.source == "own" {
            guard let t0 = tour else { return }
            guard Engine.canApplyRules(t0, f.settings) else { toast = t("rulesetBlocked"); return }
            return useRules(t0, f.settings, t0.rulesetId) { ok in
                guard ok else { return }
                self.openRule = nil
                done()
                self.commit(t0)
                self.toast = t("rulesetOwnUpdated")
            }
        }
        guard var set = rulesetsSaved.first(where: { $0.id == f.baseId }) else { preconditionFailure("unknown ruleset") }
        let name = f.name.trimmingCharacters(in: .whitespaces)
        if let p = nameProblem(name, set.id) { return showNameProblem(p) }
        set.name = name
        set.settings = f.settings.copy()
        let inUse = tour?.rulesetId == set.id
        if inUse, let tour, !Engine.canApplyRules(tour, set.settings) { toast = t("rulesetBlocked"); return }
        let next = set
        storeRuleset(next) { ok in
            guard ok else { return }
            let finish = {
                self.openRule = nil
                done()
                if let tour { self.commit(tour) } else { self.changed() }
                self.toast = t("rulesetUpdated", ["name": name])
            }
            if inUse, let tour { self.useRules(tour, next.settings, next.id) { _ in finish() } } else { finish() }
        }
    }

    func deleteRuleset(_ id: String) {
        guard let set = rulesetsSaved.first(where: { $0.id == id }) else { preconditionFailure("unknown ruleset \(id)") }
        ask(t("rulesetDeleteTitle"), t("rulesetDeleteText", ["name": set.name]), t("delete"), danger: true) {
            self.io.async { [store = self.store] in
                do {
                    try store.removeMessage(Self.rulesThread, id: id)
                    DispatchQueue.main.async {
                        self.rulesetsSaved.removeAll { $0.id == id }
                        if self.ruleForm?.baseId == id { self.ruleForm = nil }
                        self.changed()
                    }
                } catch {
                    DispatchQueue.main.async { self.fail(error) }
                }
            }
        }
    }

    // Las opciones de las reglas editan el FORMULARIO, nunca el torneo.
    func setRule(_ name: String, _ value: String) {
        let s = formFor(rulesTour()).settings
        switch name {
        case "partners": s.partners = value
        case "pairing": s.pairing = value
        case "courtsMode": s.courtsMode = value
        case "limitType": s.limitType = value
        case "matchEnd": s.matchEnd = value
        default: preconditionFailure("unknown rule \(name)")
        }
        changed()
    }

    func step(_ name: String, _ delta: Int) {
        let s = formFor(rulesTour()).settings
        func clamp(_ v: Int, _ r: ClosedRange<Int>) -> Int { min(r.upperBound, max(r.lowerBound, v)) }
        switch name {
        case "courts": s.courts = clamp(s.courts + delta, Self.ranges["courts"]!)
        case "limitValue": s.limitValue = clamp(s.limitValue + delta, Self.ranges["limitValue"]!)
        case "gamesPerMatch": s.gamesPerMatch = clamp(s.gamesPerMatch + delta, Self.ranges["gamesPerMatch"]!)
        case "matchMinutes": s.matchMinutes = clamp(s.matchMinutes + delta, Self.ranges["matchMinutes"]!)
        default:
            precondition(name.hasPrefix("points-"), "unknown step \(name)")
            let k = s.scoring[String(name.dropFirst("points-".count))]
            k.points = clamp(k.points + delta, Self.ranges["points"]!)
        }
        changed()
    }

    func toggleScoring(_ kind: String) {
        let s = formFor(rulesTour()).settings
        Engine.toggleScoring(s, kind, !s.scoring[kind].on)
        changed()
    }

    // MARK: torneo

    func startDraft() {
        let base = Engine.builtinRulesets()[0]
        draft = Engine.createTournament(name: t("defaultTournamentName", ["date": formatDate(nowMs())]), settings: base.settings, rulesetId: base.id)
        openRule = nil
        ruleForm = nil
        tab = "setup"
        changed()
    }

    func cancelDraft() { draft = nil; changed() }

    func startTournament() {
        guard let tour = draft else { return }
        guard let r = try? Engine.generateRound(tour) else { preconditionFailure("cannot start the tournament") }
        tour.rounds.append(r)
        draft = nil
        save(tour)
        setActive(tour.id)
        tab = "matches"
        changed()
    }

    func deleteTournament(_ tour: Tournament) {
        ask(t("deleteTournamentTitle"), t("deleteTournamentText", ["name": tour.name]), t("delete"), danger: true) {
            self.removeTournament(tour.id)
            self.changed()
        }
    }

    func open(_ id: String) {
        draft = nil
        openRule = nil
        ruleForm = nil
        setActive(id)
        changed()
    }

    func rename(_ name: String) {
        guard let tour = current() else { return }
        tour.name = name
        if tour !== draft { save(tour) }
    }

    func renamePlayer(_ pid: String, _ name: String) {
        guard let tour = current(), !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        tour.players.first { $0.id == pid }?.name = name.trimmingCharacters(in: .whitespaces)
        if tour !== draft { save(tour) }
    }

    func addPlayer(_ name: String) { guard let tour = current() else { return }; Engine.addPlayer(tour, name); commit(tour) }
    func addTeam(_ a: String, _ b: String) { guard let tour = current() else { return }; Engine.addTeam(tour, a, b); commit(tour) }
    func removePlayer(_ id: String) { guard let tour = current() else { return }; Engine.removePlayer(tour, id); commit(tour) }
    func removeTeam(_ id: String) { guard let tour = current() else { return }; Engine.removeTeam(tour, id); commit(tour) }
    func restore(_ id: String) { guard let tour = current() else { return }; Engine.restoreUnit(tour, id); commit(tour) }

    func history() -> [Tournament] {
        let since = Engine.periodStart(historyPeriod) ?? Int64.min
        return list.filter { $0.createdAt >= since }.sorted { $0.createdAt > $1.createdAt }
    }

    // MARK: partidos

    func setScore(_ tour: Tournament, _ matchId: String, _ kind: String, _ a: Int?, _ b: Int?) {
        if kind == "sets" { Engine.setSets(tour, matchId, a, b) } else { Engine.setScore(tour, matchId, a, b) }
        save(tour)
        let index = tour.rounds.firstIndex { $0.matches.contains { $0.id == matchId } } ?? 0
        if index < tour.rounds.count - 1 && correctionNoted.insert(tour.id).inserted { toast = t("correctionNote") }
        changed()
    }

    func nextRound(_ tour: Tournament) {
        guard let r = try? Engine.generateRound(tour) else { preconditionFailure("no round to generate") }
        tour.rounds.append(r)
        commit(tour)
    }

    func redo(_ tour: Tournament) { _ = try? Engine.redoLastRound(tour); commit(tour) }
    func drop(_ tour: Tournament) { try? Engine.removeLastRound(tour); commit(tour) }

    func clock(_ tour: Tournament, _ roundId: String, _ action: String) {
        let now = nowMs()
        switch action {
        case "start": Engine.startClock(tour, roundId, now)
        case "pause": Engine.pauseClock(tour, roundId, now)
        case "resume": Engine.resumeClock(tour, roundId, now)
        case "reset":
            if Engine.clockOf(tour, Engine.findRound(tour, roundId), now).state == "running" {
                return ask(t("clockResetTitle"), t("clockResetText"), t("clockResetOk"), danger: true) {
                    Engine.resetClock(tour, roundId); self.commit(tour)
                }
            }
            Engine.resetClock(tour, roundId)
        default: preconditionFailure("unknown clock action \(action)")
        }
        commit(tour)
    }

    /// Guardar el resultado de un partido jugado en el marcador. false si ya no existe.
    func saveLinkedResult(_ link: Match.Link, games: (Int, Int), sets: (Int, Int)?) -> Bool {
        guard status == "ready" else { toast = t("storeNotReady"); return false }
        guard let tour = list.first(where: { $0.id == link.tournamentId }), Engine.findMatch(tour, link.matchId) != nil else {
            toast = t("linkedGone"); return false
        }
        Engine.setScore(tour, link.matchId, games.0, games.1)
        if let sets { Engine.setSets(tour, link.matchId, sets.0, sets.1) }
        save(tour)
        changed()
        return true
    }

    func clockForLink(_ link: Match.Link, _ now: Int64) -> ClockState? {
        guard status == "ready", let tour = list.first(where: { $0.id == link.tournamentId }),
              let round = tour.rounds.first(where: { $0.id == link.roundId }) else { return nil }
        return Engine.clockOf(tour, round, now)
    }
}
