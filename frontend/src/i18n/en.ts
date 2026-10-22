// English messages. Must define every key in ko.ts (the type check enforces it).
import type { MessageKey, Msg, Params } from './ko'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const en: Record<MessageKey, Msg> = {
  // App
  'app.title': 'Myosu · Chess Review',
  'app.name': 'Myosu',
  'app.subtitle': 'Chess review · move stats by position',
  'app.sound': 'Move sound',
  'app.language': 'Language',

  // Common
  'common.white': 'White',
  'common.black': 'Black',
  'common.games': (p: Params) => `${p.n} ${plural(p.count ?? 0, 'game', 'games')}`,
  'common.lastGame': (p: Params) => `last game ${p.date}`,
  'platform.chesscom': 'Chess.com',
  'platform.lichess': 'Lichess',
  'sound.wood': 'Wooden pieces',
  'sound.sfx': 'Sound effects',
  'sound.off': 'Off',
  'error.requestFailed': 'Request failed ({status})',
  'error.invalidFen': 'Invalid FEN: {detail}',
  'error.invalidPgn': 'Could not read the PGN: {detail}',

  // Sign-in errors (sent as codes by the backend)
  'authError.login_cancelled': 'Sign-in was cancelled.',
  'authError.login_error': 'Something went wrong while signing in.',
  'authError.login_expired': 'The sign-in request expired. Please try again.',
  'authError.login_verify_failed': 'Could not verify the sign-in. Please try again.',
  'authError.account_info_failed': 'Could not load your account.',
  'authError.account_conflict': 'This account is already linked to another user. Sign out and try again.',
  'authError.provider_not_ready': 'Sign-in for this platform is not available yet.',
  'authError.unknown': 'Sign-in failed.',

  // My accounts
  'account.title': 'My accounts',
  'account.logout': 'Sign out',
  'account.noGames': 'No games imported yet',
  'account.updateTitle': 'Fetch games played since your last game',
  'account.importTitle': (p: Params) => `Fetch games from the last ${p.years} ${plural(p.years, 'year', 'years')}`,
  'account.update': '↻ Update',
  'account.import': 'Import',
  'account.unlink': 'Unlink',
  'account.unlinkConfirm': (p: Params) =>
    `Unlink your ${p.platform} account? Games you already imported will be kept.`,
  'account.connect': (p: Params) => `Connect ${p.platform}`,
  'account.pending': 'Sign-in is awaiting approval. Until then, you can import games by username.',
  'account.usernamePlaceholder': (p: Params) => `${p.platform} username`,
  'account.hint': (p: Params) =>
    `Connect an account to import your games automatically: the last ${p.years} ${plural(p.years, 'year', 'years')} first, then only new games.`,
  'account.doneInitial': (p: Params) =>
    `Imported ${p.n} ${plural(p.count ?? 0, 'game', 'games')} from the last ${p.years} ${plural(p.years, 'year', 'years')}.`,
  'account.doneAdded': (p: Params) => `Added ${p.n} new ${plural(p.count ?? 0, 'game', 'games')}.`,
  'account.doneNone': "No new games. You're up to date.",
  'account.others': (p: Params) => `Other players (${p.n})`,
  'account.refresh': 'Fetch new games',
  'account.refreshLabel': (p: Params) => `Fetch new games for ${p.name}`,
  'import.initial': (p: Params) =>
    `${p.name} · importing the last ${p.years} ${plural(p.years, 'year', 'years')} of games`,
  'import.update': (p: Params) => `${p.name} · checking for games since ${p.date}`,
  'import.months': (p: Params) => `${p.done}/${p.total} months`,
  'import.seen': (p: Params) => `${p.n} ${plural(p.count ?? 0, 'game', 'games')} checked`,
  'import.added': (p: Params) => `${p.n} new`,

  // Position input / move list
  'position.title': 'Position',
  'position.placeholder':
    'Paste a FEN or PGN.\ne.g. 1. e4 e5 2. Nf3 Nc6\ne.g. rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  'position.load': 'Load',
  'position.reset': 'Starting position',
  'moves.empty': 'Move a piece on the board or click a move in the table.',
  'nav.first': 'First',
  'nav.prev': 'Previous',
  'nav.next': 'Next',
  'nav.last': 'Last',

  // Board
  'evalbar.label': 'Engine evaluation',
  'evalbar.ahead': (p: Params) => `${p.side} is better by ${p.value}`,
  'help.button': 'What the board shows',
  'help.title': 'Reading the board',
  'help.arrows.title': 'Arrows = moves actually played here',
  'help.arrows.desc':
    'Depending on the tab on the right (My moves / Opponents’ moves), arrows show the moves played next in this position across your saved games.',
  'help.arrows.width': 'Thicker arrows are played more often.',
  'help.arrows.number': 'The number is the share of games (%) with that move. Shown for moves at 8% or more.',
  'help.colors.title': 'Arrow color = engine verdict',
  'help.colors.good': 'Best / good move',
  'help.colors.dubious': 'Inaccuracy / mistake',
  'help.colors.bad': 'Blunder',
  'help.colors.unknown': 'Not analysed yet',
  'help.colors.engine': 'Engine’s best move',
  'help.colors.note': 'Hover an engine line to move the purple dashed arrow to that move.',
  'help.other.title': 'Other marks',
  'help.other.evalbar':
    'Left bar: engine evaluation. More white means White is better; the number is the advantage in pawns (M3 = mate in 3).',
  'help.other.check': 'Red glow on the king: check (darker for checkmate)',
  'help.other.note': 'Hover a move in the table to highlight its arrow; click it to play the move.',

  // Opening
  'opening.title': 'Opening',
  'opening.inBook': 'Book',
  'opening.outOfBook': (p: Params) => `Out of book · ${p.n} ${plural(p.n, 'ply', 'plies')}`,
  'opening.loading': 'Checking…',
  'opening.beforeStart': 'Before the opening',
  'opening.outside': 'Not a known opening position',
  'opening.bookMoves': 'Book moves',

  // Engine
  'engine.title': 'Engine',
  'engine.requesting': 'Requesting analysis…',
  'engine.analyzing': 'Analysing…',
  'engine.depth': (p: Params) => ` · depth ${p.depth}`,
  'engine.clickToPlay': 'Click to play this move',

  // Next-move stats
  'stats.title': 'Next moves',
  'stats.noPlayer': 'Connect an account or pick a player on the left.',
  'stats.mySide': 'My side',
  'stats.filter': 'Filter',
  'stats.applied': 'Active',
  'stats.removeFilter': (p: Params) => `Remove filter ${p.label}`,
  'stats.period': 'Period',
  'stats.timeClass': 'Time control',
  'stats.myMoves': 'My moves',
  'stats.oppMoves': 'Opponents’ moves',
  'stats.notMyTurn': (p: Params) => `It’s ${p.turn} to move, so there are no moves of mine here`,
  'stats.notOppTurn': (p: Params) => `It’s ${p.turn} to move, so your opponents (${p.opp}) have no moves here`,
  'stats.turn': (p: Params) => `${p.turn} to move`,
  'stats.listTitle': (p: Params) => `Games where I played ${p.color}`,
  'stats.listNote': 'My results',
  'stats.emptyFilteredTitle': 'No games match these filters',
  'stats.emptyTitle': 'No games reached this position yet',
  'stats.emptyFilteredDesc': 'Loosen the filters a little to search more of your games.',
  'stats.emptyDesc': 'None of your games have reached this position. Keep playing to fill in your own move data!',
  'stats.resetFilters': 'Reset filters',

  // Stats table
  'table.move': 'Move',
  'table.eval': 'Eval',
  'table.games': 'Games',
  'table.share': 'Share',
  'table.wdl': 'W / D / L',
  'table.clickToPlay': 'Click to play this move',
  'table.bookMove': 'Opening book move',
  'table.wdlTitle': (p: Params) => `Won ${p.w} · Drawn ${p.d} · Lost ${p.l}`,
  'table.lossVsBest': (p: Params) => ` · -${p.loss} vs best`,
  'cls.best': 'Best',
  'cls.good': 'Good',
  'cls.inaccuracy': 'Inaccuracy',
  'cls.mistake': 'Mistake',
  'cls.blunder': 'Blunder',

  // Filter options
  'tc.all': 'All',
  'tc.bullet': 'Bullet',
  'tc.blitz': 'Blitz',
  'tc.rapid': 'Rapid',
  'tc.classical': 'Classical',
  'tc.daily': 'Daily',
  'period.all': 'All time',
  'period.last1m': 'Last month',
  'period.last3m': 'Last 3 months',
  'period.last1y': 'Last year',
  'period.last3y': 'Last 3 years',
  'period.from': 'Start date',
  'period.to': 'End date',
}
