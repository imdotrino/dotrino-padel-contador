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
    onTime: 'on time', timeUpSaved: 'Time is up. Saved to the tournament: {result}',
    wakeLockFailed: 'The screen may turn off, and then the time-up alert will not sound. Keep the app in view.',

    tabsAria: 'Sections', tabScore: 'Score', tabMatches: 'Matches', tabTable: 'Table', tabSetup: 'Tournament',

    storeLoading: 'Opening your storage…', storeFailed: 'Could not open your storage: {reason}',
    storeNotReady: 'Your storage is not ready yet. Try again in a moment.', retry: 'Try again',
    saveFailed: 'Could not save: {reason}', unexpectedError: 'Something went wrong: {reason}',

    noTournament: 'No tournament yet.', newTournament: '+ New tournament', newTournamentH: 'New tournament',
    tournamentH: 'Tournament', defaultTournamentName: 'Tournament {date}', name: 'Name',
    partners: 'Partners', partnersRotating: 'Rotate', partnersFixed: 'Fixed',
    info_partners: 'Rotate: you play each match with someone different and the table is per player. Fixed: you always play with the same partner and the table is per pair.',
    partnersChangeTitle: 'Change partners?', partnersChangeText: 'Rounds without results are drawn again.', change: 'Change',
    pairing: 'Matchups', pairingRandom: 'Random', pairingRanked: 'By score',
    info_pairing: 'Random: partners do not repeat while possible, and opponents repeat as little as possible. By score: from round 2, players with similar scores play each other; on each court 1st and 4th face 2nd and 3rd.',
    players: 'Players ({n})', teams: 'Pairs ({n})', playerPlaceholder: 'Name', add: 'Add', remove: 'Remove',
    retired: 'Out', restore: 'Bring back',
    courts: 'Courts', limit: 'Length', limitPerPlayer: 'Per player', limitRounds: 'Rounds', limitMatches: 'Total matches',
    limitEveryone_fixed: 'Everyone vs everyone', limitEveryone_rotating: 'Play with everyone',
    conflictRankedEveryone: '“By score” cannot be combined with “{limit}”: change one of the two.',
    rulesConflictSave: 'Some rules in red do not combine: fix them to save.',
    unit_perPlayer: 'matches each', unit_rounds: 'rounds', unit_matches: 'matches',
    unit_perPlayer_one: 'match each', unit_rounds_one: 'round', unit_matches_one: 'match',
    courtsCount: '{n} courts', courtsCount_one: '1 court',
    courtsModeAuto: 'Auto', courtsModeFixed: 'Fixed', courtsAutoPlayers: 'Auto · players/4', courtsAutoTeams: 'Auto · pairs/2',
    unit_courts: 'courts', unit_courts_one: 'court',
    info_courts: 'Auto: one court for every 4 players (2 pairs if partners are fixed); more players, more courts. Fixed: the courts your club has; if some do not fill up, matches use the ones that do.',
    courtsOverPlayers: 'With {units} players only {n} courts fill up: matches use {n}.',
    courtsOverPlayers_one: 'With {units} players only 1 court fills up: matches use 1.',
    courtsOverTeams: 'With {units} pairs only {n} courts fill up: matches use {n}.',
    courtsOverTeams_one: 'With {units} pairs only 1 court fills up: matches use 1.',
    info_limit: 'When there are not enough courts for everyone, players rest in turns so everyone plays the same number of matches. Everyone vs everyone (fixed pairs): each pair plays every other pair once. Play with everyone (rotating partners): each player partners every other player once. Those two depend on the number of players.',
    estimate: '≈ {matches} matches · {rounds} rounds', estimateExact: '{matches} matches · {rounds} rounds',
    estimateMinutes: '{n} min',
    scoring: 'Points', scoring_games: 'Per game won', scoring_sets: 'Per set won', scoring_match: 'Per match won',
    unit_points: 'pts', pointsPer_games: '{n} per game', pointsPer_sets: '{n} per set', pointsPer_match: '{n} per match won',
    info_scoring: 'Turn on what adds points to the table, each with its own value: they add up. A draw gives no match points. At least one stays on.',
    matchEnd: 'Match ends', matchEndTime: 'On time', matchEndGames: 'On games', free: 'No limit',
    unit_minutes: 'minutes', unit_games: 'games', unit_games_one: 'game',
    matchEndSummaryTime: 'On time · {n} minutes', matchEndSummaryGames: 'On games · to {n} games',
    matchEndSummaryGames_one: 'On games · to 1 game', matchEndSummaryFree: 'On games · no limit',
    info_matchEnd: 'On time: each round has a timer and, when it runs out, the matches end with whatever the score is. On games: a match ends when a side reaches that number of games.',
    start: 'Start tournament', needPlayers: 'You need at least {n} players.', needTeams: 'You need at least {n} pairs.',
    deleteTournament: 'Delete tournament', deleteTournamentTitle: 'Delete the tournament?',
    deleteTournamentText: '“{name}”, its rounds and its results will be deleted.',
    myTournaments: 'My tournaments', playersCount: '{n} players', teamsCount: '{n} pairs',
    stateFinished: 'finished', stateRound: 'round {n}', stateNotStarted: 'not started',
    ruleEdit: '✎ Edit', ruleDone: '✓ Done', ruleEditAria: 'Edit {rule}', ruleDoneAria: 'Close {rule}',
    rulesH: 'Rules', rulesetName: 'Rules name', rulesetCopyName: '{name} (copy)', rulesetCopyNameN: '{name} (copy {n})',
    rulesetOwn: 'This tournament’s rules',
    rulesFormEditH: 'Edit rules', rulesetUpdate: 'Save', rulesetSaveNew: 'Save as new',
    rulesetBuiltinNote: '“Default” is built in: it cannot be changed or deleted. Save it as new to edit it.',
    rulesetOwnUpdated: 'This tournament’s rules updated.',
    rulesetSavedChosen: 'Rules “{name}” saved and chosen for this tournament.',
    rulesetSaved: 'Rules “{name}” saved, but not chosen here: they change the partners and there are results already.',
    rulesetUpdated: 'Rules “{name}” updated.', rulesetNeedsName: 'Give the rules a name.',
    rulesetNameTaken: 'There are already rules with that name.',
    rulesetBlocked: 'Cannot be chosen: it changes the partners and there are results already.',
    rulesetDelete: 'Delete {name}', rulesetDeleteTitle: 'Delete these rules?',
    rulesetDeleteText: '“{name}” is deleted. Tournaments that use them keep their rules.',
    partnersSummary_rotating: 'Rotating partners', partnersSummary_fixed: 'Fixed partners',
    pairingSummary_random: 'Random matchups', pairingSummary_ranked: 'Matchups by score',

    round: 'Round {n}', court: 'Court {n}', play: '▶ Play', inScoreboard: 'On the scoreboard',
    gamesOf: 'Games for {name}', resting: 'Resting: {names}', nextRound: 'Create round {n}',
    setsOf: 'Sets for {name}', setsShort: 'Sets', gamesShort: 'Games',
    clockStart: '▶ Start', clockPause: '❚❚ Pause', clockResume: '▶ Resume', clockReset: '↺ Reset',
    clockDone: 'Time’s up', clockAria: 'Round timer',
    clockResetTitle: 'Reset the timer?', clockResetText: 'The round timer is running. It goes back to the start.', clockResetOk: 'Reset',
    timeUp: 'Time is up in round {n}: the matches end with whatever the score is.',
    redo: '↻ Redo', dropRound: 'Remove',
    correctionNote: 'Corrected. Rounds already created do not change: the correction counts in the table and in the rounds you create next.',
    rankedPending: 'The table does not have every result of round {n} yet.',
    progress: '{scored} of {total} matches played', progressApprox: '{scored} of ≈{total} matches played',
    finished: 'Tournament finished', seeTable: 'See table', goSetup: 'Go to settings',
    linkedGone: 'That match is no longer in the tournament.',

    liveOff: 'Not shared', liveOn: 'Live · {n} watching', liveOn_one: 'Live · 1 watching',
    liveShare: '📡 Share live', liveStop: 'Stop sharing',
    liveStopTitle: 'Stop sharing?', liveStopText: 'The link stops working. Sharing again creates a new link.',
    liveShareHeading: 'Watch the tournament live', liveShareText: 'Follow “{name}” live',
    liveFailed: 'Could not share the tournament: {reason}',
    watchConnecting: 'Connecting to the tournament…', watchLive: 'Read only · live',
    watchWaiting: 'Waiting for the organizer. You see the last update that arrived.',
    watchWaitingEmpty: 'Waiting for the organizer to open the tournament.',
    watchDenied: 'This link no longer works.', watchBadLink: 'This link is incomplete.',
    watchFailed: 'Could not connect: {reason}', watchClosed: 'You stopped watching.', watchLeave: 'Leave',

    colPlayer: 'Player', colTeam: 'Pair', colPlayed: 'P', colPlayedTitle: 'Matches played',
    colWon: 'W', colWonTitle: 'Matches won', colDiff: '+/−', colDiffTitle: 'Game difference',
    colSetDiff: 'S±', colSetDiffTitle: 'Set difference',
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
    onTime: 'por tiempo', timeUpSaved: 'Se acabó el tiempo. Guardado en el torneo: {result}',
    wakeLockFailed: 'La pantalla puede apagarse y entonces el aviso de fin de tiempo no sonará. Mantén la app a la vista.',

    tabsAria: 'Secciones', tabScore: 'Marcador', tabMatches: 'Partidos', tabTable: 'Tabla', tabSetup: 'Torneo',

    storeLoading: 'Abriendo tu almacén…', storeFailed: 'No se pudo abrir tu almacén: {reason}',
    storeNotReady: 'Tu almacén todavía no está listo. Inténtalo de nuevo en un momento.', retry: 'Reintentar',
    saveFailed: 'No se pudo guardar: {reason}', unexpectedError: 'Algo falló: {reason}',

    noTournament: 'Todavía no hay torneo.', newTournament: '+ Nuevo torneo', newTournamentH: 'Nuevo torneo',
    tournamentH: 'Torneo', defaultTournamentName: 'Torneo {date}', name: 'Nombre',
    partners: 'Parejas', partnersRotating: 'Rotan', partnersFixed: 'Fijas',
    info_partners: 'Rotan: cada partido juegas con alguien distinto y la tabla es por jugador. Fijas: juegas siempre con la misma pareja y la tabla es por pareja.',
    partnersChangeTitle: '¿Cambiar el tipo de parejas?', partnersChangeText: 'Las rondas sin resultados se vuelven a sortear.', change: 'Cambiar',
    pairing: 'Cómo se arman', pairingRandom: 'Al azar', pairingRanked: 'Por puntaje',
    info_pairing: 'Al azar: no se repite pareja mientras se pueda, y los rivales se repiten lo menos posible. Por puntaje: desde la ronda 2 juegan entre sí los de puntaje parecido; en cada cancha, 1.º y 4.º contra 2.º y 3.º.',
    players: 'Jugadores ({n})', teams: 'Parejas ({n})', playerPlaceholder: 'Nombre', add: 'Añadir', remove: 'Quitar',
    retired: 'Fuera', restore: 'Reincorporar',
    courts: 'Canchas', limit: 'Duración', limitPerPlayer: 'Por jugador', limitRounds: 'Rondas', limitMatches: 'Partidos totales',
    limitEveryone_fixed: 'Todos contra todos', limitEveryone_rotating: 'Juegan con todos',
    conflictRankedEveryone: '«Por puntaje» no se combina con «{limit}»: cambia una de las dos.',
    rulesConflictSave: 'Hay reglas en rojo que no se combinan: corrígelas para guardar.',
    unit_perPlayer: 'partidos cada uno', unit_rounds: 'rondas', unit_matches: 'partidos',
    unit_perPlayer_one: 'partido cada uno', unit_rounds_one: 'ronda', unit_matches_one: 'partido',
    courtsCount: '{n} canchas', courtsCount_one: '1 cancha',
    courtsModeAuto: 'Auto', courtsModeFixed: 'Fijo', courtsAutoPlayers: 'Auto · jugadores/4', courtsAutoTeams: 'Auto · parejas/2',
    unit_courts: 'canchas', unit_courts_one: 'cancha',
    info_courts: 'Auto: una cancha por cada 4 jugadores (2 parejas si son fijas); con más jugadores, más canchas. Fijo: las canchas que tiene el club; si alguna no se llena, se juega en las que sí.',
    courtsOverPlayers: 'Con {units} jugadores solo se llenan {n} canchas: se juega en {n}.',
    courtsOverPlayers_one: 'Con {units} jugadores solo se llena 1 cancha: se juega en 1.',
    courtsOverTeams: 'Con {units} parejas solo se llenan {n} canchas: se juega en {n}.',
    courtsOverTeams_one: 'Con {units} parejas solo se llena 1 cancha: se juega en 1.',
    info_limit: 'Si no hay cancha para todos, se descansa por turnos para que todos jueguen los mismos partidos. Todos contra todos (parejas fijas): cada pareja juega una vez contra cada otra. Juegan con todos (parejas que rotan): cada jugador hace pareja una vez con cada uno de los demás. Esas dos dependen del número de jugadores.',
    estimate: '≈ {matches} partidos · {rounds} rondas', estimateExact: '{matches} partidos · {rounds} rondas',
    estimateMinutes: '{n} min',
    scoring: 'Puntos', scoring_games: 'Por juego ganado', scoring_sets: 'Por set ganado', scoring_match: 'Por partido ganado',
    unit_points: 'pts', pointsPer_games: '{n} por juego', pointsPer_sets: '{n} por set', pointsPer_match: '{n} por partido ganado',
    info_scoring: 'Enciende lo que suma en la tabla, cada cosa con su valor: se suman entre sí. Un empate no da puntos de partido. Al menos una queda encendida.',
    matchEnd: 'Fin del partido', matchEndTime: 'Por tiempo', matchEndGames: 'Por juegos', free: 'Libre',
    unit_minutes: 'minutos', unit_games: 'juegos', unit_games_one: 'juego',
    matchEndSummaryTime: 'Por tiempo · {n} minutos', matchEndSummaryGames: 'Por juegos · a {n} juegos',
    matchEndSummaryGames_one: 'Por juegos · a 1 juego', matchEndSummaryFree: 'Por juegos · sin límite',
    info_matchEnd: 'Por tiempo: cada ronda tiene un cronómetro y, cuando se acaba, los partidos terminan con el marcador que haya. Por juegos: el partido termina cuando un lado llega a esa cantidad de juegos.',
    start: 'Empezar torneo', needPlayers: 'Hacen falta al menos {n} jugadores.', needTeams: 'Hacen falta al menos {n} parejas.',
    deleteTournament: 'Borrar torneo', deleteTournamentTitle: '¿Borrar el torneo?',
    deleteTournamentText: 'Se borran «{name}», sus rondas y sus resultados.',
    myTournaments: 'Mis torneos', playersCount: '{n} jugadores', teamsCount: '{n} parejas',
    stateFinished: 'terminado', stateRound: 'ronda {n}', stateNotStarted: 'sin empezar',
    ruleEdit: '✎ Editar', ruleDone: '✓ Listo', ruleEditAria: 'Editar {rule}', ruleDoneAria: 'Cerrar {rule}',
    rulesH: 'Reglas', rulesetName: 'Nombre de las reglas', rulesetCopyName: '{name} (copia)', rulesetCopyNameN: '{name} (copia {n})',
    rulesetOwn: 'Reglas de este torneo',
    rulesFormEditH: 'Editar reglas', rulesetUpdate: 'Guardar', rulesetSaveNew: 'Guardar como nueva',
    rulesetBuiltinNote: '«Default» es la regla de fábrica: no se cambia ni se borra. Guárdala como nueva para editarla.',
    rulesetOwnUpdated: 'Reglas de este torneo actualizadas.',
    rulesetSavedChosen: 'Reglas «{name}» guardadas y elegidas para este torneo.',
    rulesetSaved: 'Reglas «{name}» guardadas, pero no elegidas aquí: cambian el tipo de parejas y ya hay resultados.',
    rulesetUpdated: 'Reglas «{name}» actualizadas.', rulesetNeedsName: 'Ponle un nombre a las reglas.',
    rulesetNameTaken: 'Ya hay unas reglas con ese nombre.',
    rulesetBlocked: 'No se puede elegir: cambia el tipo de parejas y ya hay resultados.',
    rulesetDelete: 'Borrar {name}', rulesetDeleteTitle: '¿Borrar estas reglas?',
    rulesetDeleteText: 'Se borra «{name}». Los torneos que las usan conservan sus reglas.',
    partnersSummary_rotating: 'Parejas que rotan', partnersSummary_fixed: 'Parejas fijas',
    pairingSummary_random: 'Cruces al azar', pairingSummary_ranked: 'Cruces por puntaje',

    round: 'Ronda {n}', court: 'Cancha {n}', play: '▶ Jugar', inScoreboard: 'En el marcador',
    gamesOf: 'Juegos de {name}', resting: 'Descansan: {names}', nextRound: 'Armar ronda {n}',
    setsOf: 'Sets de {name}', setsShort: 'Sets', gamesShort: 'Juegos',
    clockStart: '▶ Empezar', clockPause: '❚❚ Pausar', clockResume: '▶ Seguir', clockReset: '↺ Reiniciar',
    clockDone: '¡Tiempo!', clockAria: 'Cronómetro de la ronda',
    clockResetTitle: '¿Reiniciar el cronómetro?', clockResetText: 'El cronómetro de la ronda está corriendo. Vuelve al principio.', clockResetOk: 'Reiniciar',
    timeUp: 'Se acabó el tiempo de la ronda {n}: los partidos terminan con el marcador que haya.',
    redo: '↻ Rehacer', dropRound: 'Quitar',
    correctionNote: 'Corregido. Las rondas ya armadas no cambian: la corrección cuenta en la tabla y en las rondas que armes después.',
    rankedPending: 'La tabla todavía no tiene todos los resultados de la ronda {n}.',
    progress: '{scored} de {total} partidos jugados', progressApprox: '{scored} de ≈{total} partidos jugados',
    finished: 'Torneo terminado', seeTable: 'Ver tabla', goSetup: 'Ir a la configuración',
    linkedGone: 'Ese partido ya no está en el torneo.',

    liveOff: 'No se comparte', liveOn: 'En vivo · {n} mirando', liveOn_one: 'En vivo · 1 mirando',
    liveShare: '📡 Compartir en vivo', liveStop: 'Dejar de compartir',
    liveStopTitle: '¿Dejar de compartir?', liveStopText: 'El enlace deja de funcionar. Si vuelves a compartir, sale un enlace nuevo.',
    liveShareHeading: 'Mirar el torneo en vivo', liveShareText: 'Sigue «{name}» en vivo',
    liveFailed: 'No se pudo compartir el torneo: {reason}',
    watchConnecting: 'Conectando con el torneo…', watchLive: 'Solo lectura · en vivo',
    watchWaiting: 'Esperando al organizador. Ves lo último que llegó.',
    watchWaitingEmpty: 'Esperando a que el organizador abra el torneo.',
    watchDenied: 'Este enlace ya no funciona.', watchBadLink: 'Este enlace está incompleto.',
    watchFailed: 'No se pudo conectar: {reason}', watchClosed: 'Dejaste de mirar.', watchLeave: 'Salir',

    colPlayer: 'Jugador', colTeam: 'Pareja', colPlayed: 'PJ', colPlayedTitle: 'Partidos jugados',
    colWon: 'PG', colWonTitle: 'Partidos ganados', colDiff: '+/−', colDiffTitle: 'Diferencia de juegos',
    colSetDiff: 'S±', colSetDiffTitle: 'Diferencia de sets',
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

// Con cantidad: usa `<key>_one` cuando n es 1 («1 ronda», no «1 rondas»).
export function tn (key, n, vars = { n }) {
  return t(n === 1 ? key + '_one' : key, vars)
}

export function applyStatic (root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria))
}
