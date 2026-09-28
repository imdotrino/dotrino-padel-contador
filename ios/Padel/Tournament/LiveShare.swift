import DotrinoNative
import Foundation

/// VER EL TORNEO EN VIVO desde el teléfono: el puerto de `src/tournament/live.js`, el mismo que
/// `LiveShare.kt`. Quien organiza emite el torneo con la emisión de lobby (`BroadcastHost` de
/// dotrino-native), firmado por SU perfil —el del teléfono, el mismo que en la web— y sellado a
/// cada uno de los que miran, que abren el enlace en el navegador (la PWA). La clave y el
/// secreto se guardan en el torneo (`tour.share`): el enlace sobrevive a cerrar la app.
@MainActor
final class LiveShare: ObservableObject {
    static let url = "wss://proxy.dotrino.com"
    static let gameId = "padel"
    static let watchBase = "https://padel.dotrino.com/"

    private var hosts: [String: BroadcastHost] = [:] // tournament.id → emisión
    private var timers: [String: DispatchWorkItem] = [:]
    @Published private(set) var viewers: [String: Int] = [:]
    var onError: (String) -> Void = { _ in }

    func isSharing(_ tour: Tournament?) -> Bool { tour?.share != nil }

    /// Lo que ven los demás: el torneo tal cual, sin la clave del enlace.
    private func snapshot(_ tour: Tournament) throws -> JSON {
        guard case .object(var o) = try JSON.parse(try JSONEncoder().encode(tour)) else { throw CryptoError("tournament is not an object") }
        o["share"] = nil
        return .object(o)
    }

    /// Por qué no se pudo, en palabras de la app (el código decide, no la frase).
    func reason(_ e: Error) -> String {
        switch (e as? Profile.ProfileError)?.code {
        case "no-profile", "no-profile-keys": return t("liveNeedsProfile")
        case "needs-vault-signer": return t("liveNeedsSigner")
        default: return t("liveFailed", ["reason": String(describing: e)])
        }
    }

    private func host(_ tour: Tournament) async throws -> BroadcastHost {
        if let h = hosts[tour.id] { return h }
        let profile = try Profile.fromPhone()
        let ref = tour.share.map { BroadcastHost.Ref(key: $0.key, secret: $0.secret) }
        let h = BroadcastHost(url: Self.url, gameId: Self.gameId, profile: profile, transport: try Profile.transportKey(app: "padel"), ref: ref)
        let id = tour.id
        h.onViewers = { n in Task { @MainActor in self.viewers[id] = n } }
        h.onWarn = { what, e in NSLog("padel: live %@ failed: %@", what, String(describing: e)) }
        try await h.start()
        hosts[tour.id] = h
        return h
    }

    /// Empieza a compartir, o retoma lo que ya se compartía (el mismo enlace). Si el torneo no
    /// tenía enlace, deja la clave en `tour.share`: quien llama lo guarda. Devuelve el enlace.
    func share(_ tour: Tournament) async throws -> String {
        let snap = try snapshot(tour)
        let h = try await host(tour)
        try await h.publish(snap)
        if tour.share == nil, let r = h.linkRef { tour.share = ShareRef(key: r.key, secret: r.secret) }
        return try h.link(base: Self.watchBase)
    }

    /// Tras abrir la app: si el torneo abierto se compartía, se vuelve a emitir con su enlace.
    func resume(_ tour: Tournament?) {
        guard let tour, tour.share != nil, hosts[tour.id] == nil else { return }
        Task {
            do { _ = try await share(tour) } catch { onError(reason(error)) }
        }
    }

    /// Un cambio del torneo: si se comparte, sale en un momento (se agrupan los seguidos).
    func publishSoon(_ tour: Tournament) {
        guard let h = hosts[tour.id] else { return }
        timers[tour.id]?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self, let snap = try? self.snapshot(tour) else { return }
            Task { do { try await h.publish(snap) } catch { self.onError(self.reason(error)) } }
        }
        timers[tour.id] = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: item)
    }

    /// Dejar de compartir: el enlace deja de servir; quien miraba se queda con lo último.
    func stop(_ tour: Tournament) {
        let h = hosts.removeValue(forKey: tour.id)
        tour.share = nil
        timers.removeValue(forKey: tour.id)?.cancel()
        viewers[tour.id] = nil
        if let h { Task { await h.close() } }
    }
}
