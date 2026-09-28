import DotrinoNative
import Foundation

/// Dónde vive cada cosa, igual que en la PWA (CONVENCIONES §4):
///  - el partido en curso y las opciones del marcador son progreso volátil del aparato →
///    `UserDefaults` (lo que en la web es localStorage);
///  - los resultados son del usuario → el almacén (`DotrinoStore`), hilo `padel.results`, el
///    mismo documento que guarda la PWA.
final class Repo {
    static let results = "padel.results"
    private let defaults = UserDefaults.standard
    private let store: DotrinoStore

    init() throws {
        store = try DotrinoStore(app: "padel")
    }

    // Un valor corrupto de las preferencias se descarta y se dice en el log: es progreso
    // volátil, y quedarse sin abrir la app por él sería peor. Lo del almacén, en cambio, lanza.
    private func read<T: Decodable>(_ key: String, as type: T.Type) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            NSLog("padel: discarding corrupt %@: %@", key, String(describing: error))
            defaults.removeObject(forKey: key)
            return nil
        }
    }

    private func write<T: Encodable>(_ key: String, _ value: T) {
        do {
            defaults.set(try JSONEncoder().encode(value), forKey: key)
        } catch {
            preconditionFailure("padel: could not encode \(key): \(error)")
        }
    }

    func loadMatch() -> Match { read("padel.live", as: Match.self) ?? Match() }
    func saveMatch(_ m: Match) { write("padel.live", m) }
    func loadConfig() -> Config { read("padel.config", as: Config.self) ?? Config() }
    func saveConfig(_ c: Config) { write("padel.config", c) }

    func loadResults() throws -> [MatchResult] { try store.listDocs(Self.results, as: MatchResult.self) }
    func saveResult(_ r: MatchResult) throws { try store.putDoc(Self.results, id: r.id, r) }
    func deleteResult(_ id: String) throws { try store.removeMessage(Self.results, id: id) }
}
