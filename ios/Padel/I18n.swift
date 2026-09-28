import DotrinoNativeUI
import Foundation

/// Los textos de la app: los MISMOS de la PWA (src/i18n.js), que `scripts/native-i18n.mjs`
/// copia a i18n.json. `t` y `tn` funcionan como allí: `{name}` se sustituye, y una variable o
/// una clave que falta es un error, no un hueco en pantalla. El idioma es el de la barra.
enum I18n {
    static let dict: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "i18n", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let d = try? JSONDecoder().decode([String: [String: String]].self, from: data)
        else { preconditionFailure("i18n.json is missing or broken in the app bundle") }
        return d
    }()
}

func t(_ key: String, _ vars: [String: Any] = [:]) -> String {
    let lang = DotrinoLang.shared.code
    guard let s = I18n.dict[lang]?[key] else { preconditionFailure("missing i18n key: \(key) (\(lang))") }
    if vars.isEmpty { return s }
    var out = ""
    var rest = Substring(s)
    while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
        out += rest[..<open]
        let name = String(rest[rest.index(after: open)..<close])
        guard let v = vars[name] else { preconditionFailure("missing i18n var \"\(name)\" for \(key)") }
        out += "\(v)"
        rest = rest[rest.index(after: close)...]
    }
    return out + rest
}

/// Con cantidad: `<key>_one` cuando n es 1 («1 ronda», no «1 rondas»).
func tn(_ key: String, _ n: Int, _ vars: [String: Any]? = nil) -> String {
    t(n == 1 ? key + "_one" : key, vars ?? ["n": n])
}
