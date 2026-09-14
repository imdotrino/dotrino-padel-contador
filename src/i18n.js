// Textos es/en (§9). La fuente de verdad del idioma es <dotrino-topbar>: lo resuelve al
// registrarse, lo deja en <html lang> y avisa de cada cambio con 'dotrino-lang'.
// GAME/SET/TIE-BREAK se usan igual en los dos idiomas.

const DICT = {
  en: {
    results: '📋 Results', optionsTitle: 'Scoreboard options', editName: 'Edit name',
    undo: '↶ Undo', serveBtn: '⇄ Serve', newMatch: '+ New', saveResult: '✓ Save',
    resultsH: 'Results', optionsH: 'Options', close: 'Close', cancel: 'Cancel',
    matchSets: 'Match sets', scoringMode: 'Scoring mode',
    advantage: 'Advantage', doubleAdv: 'Double advantage', golden: 'Golden point',
    desc_advantage: 'You must win the game by two points — at 40-40 it stays deuce until someone leads by two.',
    desc_star: '<b>Star Point</b> (FIP 2026): at 40-40 you play an advantage; if it goes back to deuce, a second advantage; on a third deuce a <b>golden point</b> decides the game.',
    desc_golden: 'At 40-40 the next point decides the game (sudden death).',
    desc_sets1: 'Endless count: games add up with no set to close and no tie-break. The set counter is hidden.',
    desc_sets3: 'Best of 3: the score reads x/3.',
    desc_sets5: 'Best of 5: the score reads x/5.',
    serve: 'SERVE', point: 'point', teamA: 'Team A', teamB: 'Team B',
    newMatchTitle: 'New match', confirmNew: 'The current score will be saved to your results.',
    newMatchOk: 'Start new match', noResults: 'No saved results.', delete: 'Delete', loading: 'Loading…',
    resultsLoadFailed: 'Could not read your results: {reason}',
    resultDeleteFailed: 'Could not delete the result: {reason}',
    resultSaveFailed: 'Could not save the result: {reason}',
    saveResultTitle: 'Save the result to the tournament?', save: 'Save', keepPlaying: 'Keep playing',
    leaveLinked: 'Stop playing this tournament match', leaveLinkedTitle: 'Leave this tournament match?',
    leaveLinkedText: 'The scoreboard resets and nothing is saved to the tournament.', leave: 'Leave',
    replaceMatchTitle: 'Replace the current match?',
    replaceMatchText: 'The scoreboard has a match in progress. It will be discarded.', replace: 'Replace',
    linkedLabel: '{name} · Round {round} · Court {court}', toGames: 'to {n} games', freeGames: 'no game limit',

    tabsAria: 'Sections', tabScore: 'Score', tabMatches: 'Matches', tabTable: 'Table', tabSetup: 'Tournament',

    storeLoading: 'Opening your storage…', storeFailed: 'Could not open your storage: {reason}',
    storeNotReady: 'Your storage is not ready yet. Try again in a moment.', retry: 'Try again',
    saveFailed: 'Could not save: {reason}', unexpectedError: 'Something went wrong: {reason}',

    noTournament: 'No tournament yet.', newTournament: '+ New tournament', newTournamentH: 'New tournament',
    tournamentH: 'Tournament', defaultTournamentName: 'Tournament {date}', name: 'Name',
    partners: 'Partners', partnersRotating: 'Rotate', partnersFixed: 'Fixed',
    partnersLocked: 'There are results already: partners can no longer change.',
    info_partners: 'Rotate: you play each match with someone different and the table is per player. Fixed: you always play with the same partner and the table is per pair.',
    partnersChangeTitle: 'Change partners?', partnersChangeText: 'Rounds without results are drawn again.', change: 'Change',
    pairing: 'Matchups', pairingRandom: 'Random', pairingRanked: 'By score',
    info_pairing: 'Random: partners do not repeat while possible, and opponents repeat as little as possible. By score: from round 2, players with similar scores play each other; on each court 1st and 4th face 2nd and 3rd.',
    players: 'Players ({n})', teams: 'Pairs ({n})', playerPlaceholder: 'Name', add: 'Add', remove: 'Remove',
    retired: 'Out', restore: 'Bring back',
    courts: 'Courts', limit: 'Length', limitPerPlayer: 'Per player', limitRounds: 'Rounds', limitMatches: 'Total matches',
    unit_perPlayer: 'matches each', unit_rounds: 'rounds', unit_matches: 'matches',
    info_limit: 'When there are not enough courts for everyone, players rest in turns so everyone plays the same number of matches.',
    estimate: '≈ {matches} matches · {rounds} rounds', estimateExact: '{matches} matches · {rounds} rounds',
    scoring: 'Points', scoringGames: 'Per game won', scoringMatch: 'Per match won',
    info_scoring: 'Per game: you get a point for every game your side wins. Per match: 3 points for a win, 1 for a draw.',
    gamesPerMatch: 'Games per match', free: 'No limit',
    info_games: 'When a side reaches this number on the scoreboard, it offers to save the result.',
    start: 'Start tournament', needPlayers: 'You need at least {n} players.', needTeams: 'You need at least {n} pairs.',
    deleteTournament: 'Delete tournament', deleteTournamentTitle: 'Delete the tournament?',
    deleteTournamentText: '“{name}”, its rounds and its results will be deleted.',
    myTournaments: 'My tournaments', playersCount: '{n} players', teamsCount: '{n} pairs',
    stateFinished: 'finished', stateRound: 'round {n}', stateNotStarted: 'not started', infoAria: 'What is this',

    round: 'Round {n}', court: 'Court {n}', play: '▶ Play', inScoreboard: 'On the scoreboard',
    gamesOf: 'Games for {name}', resting: 'Resting: {names}', nextRound: 'Create round {n}',
    redo: '↻ Redo', dropRound: 'Remove',
    rankedPending: 'The table does not have every result of round {n} yet.',
    progress: '{scored} of {total} matches played', progressApprox: '{scored} of ≈{total} matches played',
    finished: 'Tournament finished', seeTable: 'See table', goSetup: 'Go to settings',
    linkedGone: 'That match is no longer in the tournament.',

    colPlayer: 'Player', colTeam: 'Pair', colPlayed: 'P', colPlayedTitle: 'Matches played',
    colWon: 'W', colWonTitle: 'Matches won', colDiff: '+/−', colDiffTitle: 'Game difference',
    colPoints: 'Pts', colPointsTitle: 'Points'
  },
  es: {
    results: '📋 Resultados', optionsTitle: 'Opciones del marcador', editName: 'Editar nombre',
    undo: '↶ Deshacer', serveBtn: '⇄ Saque', newMatch: '+ Nuevo', saveResult: '✓ Guardar',
    resultsH: 'Resultados', optionsH: 'Opciones', close: 'Cerrar', cancel: 'Cancelar',
    matchSets: 'Sets del partido', scoringMode: 'Modo de puntuación',
    advantage: 'Ventaja', doubleAdv: 'Doble ventaja', golden: 'Punto de oro',
    desc_advantage: 'Hay que ganar el juego por dos puntos: en 40-40 sigue en iguales hasta que alguien saca dos de diferencia.',
    desc_star: '<b>Star Point</b> (FIP 2026): en 40-40 se juega una ventaja; si vuelve a iguales, una segunda ventaja; a la tercera igualdad un <b>punto de oro</b> define el juego.',
    desc_golden: 'En 40-40 el siguiente punto define el juego (muerte súbita).',
    desc_sets1: 'Cuenta sin fin: los juegos se acumulan, no se cierra ningún set y no hay tie-break. El contador de sets no se muestra.',
    desc_sets3: 'Al mejor de 3: el marcador se lee x/3.',
    desc_sets5: 'Al mejor de 5: el marcador se lee x/5.',
    serve: 'SAQUE', point: 'punto', teamA: 'Pareja A', teamB: 'Pareja B',
    newMatchTitle: 'Partido nuevo', confirmNew: 'El marcador actual se guarda en tus resultados.',
    newMatchOk: 'Empezar partido nuevo', noResults: 'No hay resultados guardados.', delete: 'Borrar', loading: 'Cargando…',
    resultsLoadFailed: 'No se pudieron leer tus resultados: {reason}',
    resultDeleteFailed: 'No se pudo borrar el resultado: {reason}',
    resultSaveFailed: 'No se pudo guardar el resultado: {reason}',
    saveResultTitle: '¿Guardar el resultado en el torneo?', save: 'Guardar', keepPlaying: 'Seguir jugando',
    leaveLinked: 'Dejar de jugar este partido del torneo', leaveLinkedTitle: '¿Salir de este partido del torneo?',
    leaveLinkedText: 'El marcador se reinicia y no se guarda nada en el torneo.', leave: 'Salir',
    replaceMatchTitle: '¿Reemplazar el partido en curso?',
    replaceMatchText: 'El marcador tiene un partido a medias. Se descarta.', replace: 'Reemplazar',
    linkedLabel: '{name} · Ronda {round} · Cancha {court}', toGames: 'a {n} juegos', freeGames: 'sin límite de juegos',

    tabsAria: 'Secciones', tabScore: 'Marcador', tabMatches: 'Partidos', tabTable: 'Tabla', tabSetup: 'Torneo',

    storeLoading: 'Abriendo tu almacén…', storeFailed: 'No se pudo abrir tu almacén: {reason}',
    storeNotReady: 'Tu almacén todavía no está listo. Inténtalo de nuevo en un momento.', retry: 'Reintentar',
    saveFailed: 'No se pudo guardar: {reason}', unexpectedError: 'Algo falló: {reason}',

    noTournament: 'Todavía no hay torneo.', newTournament: '+ Nuevo torneo', newTournamentH: 'Nuevo torneo',
    tournamentH: 'Torneo', defaultTournamentName: 'Torneo {date}', name: 'Nombre',
    partners: 'Parejas', partnersRotating: 'Rotan', partnersFixed: 'Fijas',
    partnersLocked: 'Ya hay resultados: el tipo de parejas ya no se puede cambiar.',
    info_partners: 'Rotan: cada partido juegas con alguien distinto y la tabla es por jugador. Fijas: juegas siempre con la misma pareja y la tabla es por pareja.',
    partnersChangeTitle: '¿Cambiar el tipo de parejas?', partnersChangeText: 'Las rondas sin resultados se vuelven a sortear.', change: 'Cambiar',
    pairing: 'Cómo se arman', pairingRandom: 'Al azar', pairingRanked: 'Por puntaje',
    info_pairing: 'Al azar: no se repite pareja mientras se pueda, y los rivales se repiten lo menos posible. Por puntaje: desde la ronda 2 juegan entre sí los de puntaje parecido; en cada cancha, 1.º y 4.º contra 2.º y 3.º.',
    players: 'Jugadores ({n})', teams: 'Parejas ({n})', playerPlaceholder: 'Nombre', add: 'Añadir', remove: 'Quitar',
    retired: 'Fuera', restore: 'Reincorporar',
    courts: 'Canchas', limit: 'Duración', limitPerPlayer: 'Por jugador', limitRounds: 'Rondas', limitMatches: 'Partidos totales',
    unit_perPlayer: 'partidos cada uno', unit_rounds: 'rondas', unit_matches: 'partidos',
    info_limit: 'Si no hay cancha para todos, se descansa por turnos para que todos jueguen los mismos partidos.',
    estimate: '≈ {matches} partidos · {rounds} rondas', estimateExact: '{matches} partidos · {rounds} rondas',
    scoring: 'Puntos', scoringGames: 'Por juego ganado', scoringMatch: 'Por partido ganado',
    info_scoring: 'Por juego: sumas un punto por cada juego que gana tu lado. Por partido: 3 puntos por ganar y 1 por empatar.',
    gamesPerMatch: 'Juegos por partido', free: 'Libre',
    info_games: 'Cuando un lado llega a esa cifra en el marcador, te propone guardar el resultado.',
    start: 'Empezar torneo', needPlayers: 'Hacen falta al menos {n} jugadores.', needTeams: 'Hacen falta al menos {n} parejas.',
    deleteTournament: 'Borrar torneo', deleteTournamentTitle: '¿Borrar el torneo?',
    deleteTournamentText: 'Se borran «{name}», sus rondas y sus resultados.',
    myTournaments: 'Mis torneos', playersCount: '{n} jugadores', teamsCount: '{n} parejas',
    stateFinished: 'terminado', stateRound: 'ronda {n}', stateNotStarted: 'sin empezar', infoAria: 'Qué es esto',

    round: 'Ronda {n}', court: 'Cancha {n}', play: '▶ Jugar', inScoreboard: 'En el marcador',
    gamesOf: 'Juegos de {name}', resting: 'Descansan: {names}', nextRound: 'Armar ronda {n}',
    redo: '↻ Rehacer', dropRound: 'Quitar',
    rankedPending: 'La tabla todavía no tiene todos los resultados de la ronda {n}.',
    progress: '{scored} de {total} partidos jugados', progressApprox: '{scored} de ≈{total} partidos jugados',
    finished: 'Torneo terminado', seeTable: 'Ver tabla', goSetup: 'Ir a la configuración',
    linkedGone: 'Ese partido ya no está en el torneo.',

    colPlayer: 'Jugador', colTeam: 'Pareja', colPlayed: 'PJ', colPlayedTitle: 'Partidos jugados',
    colWon: 'PG', colWonTitle: 'Partidos ganados', colDiff: '+/−', colDiffTitle: 'Diferencia de juegos',
    colPoints: 'Pts', colPointsTitle: 'Puntos'
  }
}

let lang = null

export function initLang () {
  const l = document.documentElement.lang
  lang = l === 'es' || l === 'en'
    ? l
    : ((navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en')
}

export function getLang () {
  if (!lang) throw new Error('i18n used before initLang()')
  return lang
}

export function setLang (l) {
  if (l !== 'es' && l !== 'en') throw new Error(`unsupported lang: ${l}`)
  lang = l
}

export function t (key, vars) {
  const s = DICT[getLang()][key]
  if (s === undefined) throw new Error(`missing i18n key: ${key} (${lang})`)
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`missing i18n var "${k}" for ${key}`)
    return String(vars[k])
  })
}

export function applyStatic (root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria))
}
