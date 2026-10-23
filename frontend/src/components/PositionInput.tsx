import { useState } from 'react'
import { useI18n } from '../i18n'
import { parsePositionInput, type Line } from '../lib/line'

interface Props {
  onLoad: (line: Line) => void
  open: boolean
  onToggle: () => void
}

export function PositionInput({ onLoad, open, onToggle }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load() {
    try {
      onLoad(parsePositionInput(text))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className={`panel sec-amber ${open ? '' : 'collapsed'}`}>
      <div className="panel-head">
        <button className="panel-toggle" onClick={onToggle} aria-expanded={open}>
          <h2>{t('position.title')}</h2>
          <span className="chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </button>
      </div>
      {open && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={t('position.placeholder')}
            spellCheck={false}
          />
          <div className="row">
            <button onClick={load}>{t('position.load')}</button>
            <button
              className="secondary"
              onClick={() => {
                setText('')
                setError(null)
                onLoad(parsePositionInput(''))
              }}
            >
              {t('position.reset')}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  )
}
