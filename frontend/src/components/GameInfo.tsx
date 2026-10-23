// 탐색 화면에서 대국을 열었을 때 수순 위에 보이는 대국 정보.
import { platformLabel, type GameDetail } from '../api/client'
import { useI18n } from '../i18n'
import { formatTimeControl } from '../pages/GamesPage'
import { timeClassLabel } from './TimeClassFilter'

interface Props {
  game: GameDetail
  deviated: boolean // 보드에서 다른 수를 둬 대국 수순에서 벗어났는지
  onRestore: () => void
  onClose: () => void
}

export function GameInfo({ game, deviated, onRestore, onClose }: Props) {
  const { t, formatDate } = useI18n()
  const white = game.color === 'white' ? [game.me, game.my_rating] : [game.opponent, game.opponent_rating]
  const black = game.color === 'black' ? [game.me, game.my_rating] : [game.opponent, game.opponent_rating]
  return (
    <section className="panel game-info sec-teal">
      <div className="panel-head">
        <h2>{t('games.thisGame')}</h2>
        <button className="link-btn" onClick={onClose}>
          {t('games.close')}
        </button>
      </div>
      <div className="game-players">
        {[
          ['white', white],
          ['black', black],
        ].map(([side, [name, rating]], i) => (
          <span key={side as string} className={`game-player ${side === game.color ? 'me' : ''}`}>
            {i === 1 && <span className="vs">vs</span>}
            <span className={`piece-dot ${side}`} />
            <span className="name">{name}</span>
            {rating && <span className="muted small">{rating}</span>}
          </span>
        ))}
      </div>
      <div className="game-facts">
        <span className={`outcome ${game.outcome}`}>{t(`games.outcome.${game.outcome}`)}</span>
        <span>{game.result}</span>
        <span className="muted">
          {game.time_class ? timeClassLabel(game.time_class) : ''} {formatTimeControl(game.time_control)}
        </span>
        <span className="muted">{formatDate(game.end_time)}</span>
        {game.url && (
          <a href={game.url} target="_blank" rel="noreferrer noopener">
            {platformLabel(game.platform)} ↗
          </a>
        )}
      </div>
      {game.opening && (
        <div className="game-opening small">
          <span className="eco">{game.opening.eco}</span> {game.opening.name}
        </div>
      )}
      {deviated && (
        <p className="deviated small">
          {t('games.deviated')}{' '}
          <button className="link-btn" onClick={onRestore}>
            {t('games.restore')}
          </button>
        </p>
      )}
    </section>
  )
}
