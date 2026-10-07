/**
 * dsh-workflow-lite — 工作流中心「设置」页的「外观」：亮色、暗色各挑一套配色主题。
 *
 * 点一下马上换，不进下面的保存条（只是看起来的样子，记在浏览器里，见 app/theme.ts）。
 * 每张小卡是那套主题的缩略：画布底、一条侧栏、两张卡和连着它们的线、选中的那张描强调色。
 * 亮、暗两行里，此刻正用着的那一行标「正在用」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ThemePicker
 */

import { setThemeChoice, useColorScheme, useThemeChoice } from '../app/theme.ts'
import type { LocaleKey, T } from '../i18n.ts'
import {
  DARK_THEME_IDS,
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  LIGHT_THEME_IDS,
  THEMES,
  type ThemeId,
  type ThemeMode,
} from '../model/themes.ts'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import css from './themePicker.module.css'

const NAME: Record<ThemeId, LocaleKey> = {
  paper: 'theme.paper',
  white: 'theme.white',
  mist: 'theme.mist',
  sage: 'theme.sage',
  slate: 'theme.slate',
  ink: 'theme.ink',
  ocean: 'theme.ocean',
  umber: 'theme.umber',
}

const DESC: Record<ThemeId, LocaleKey> = {
  paper: 'theme.paperDesc',
  white: 'theme.whiteDesc',
  mist: 'theme.mistDesc',
  sage: 'theme.sageDesc',
  slate: 'theme.slateDesc',
  ink: 'theme.inkDesc',
  ocean: 'theme.oceanDesc',
  umber: 'theme.umberDesc',
}

export function ThemePicker(props: { t: T }): React.JSX.Element {
  const { t } = props
  const choice = useThemeChoice()
  const scheme = useColorScheme()
  return (
    <section className={hub.section} data-testid="wl-theme">
      <h3 className={hub.sectionTitle}>{t('theme.group')}</h3>
      <div className={css.box}>
        <p className={css.lead}>{t('theme.lead')}</p>
        <Row
          t={t}
          mode="light"
          ids={LIGHT_THEME_IDS}
          picked={choice.light}
          fallback={DEFAULT_LIGHT}
          inUse={scheme === 'light'}
          onPick={(id) => setThemeChoice({ light: id as typeof choice.light })}
        />
        <Row
          t={t}
          mode="dark"
          ids={DARK_THEME_IDS}
          picked={choice.dark}
          fallback={DEFAULT_DARK}
          inUse={scheme === 'dark'}
          onPick={(id) => setThemeChoice({ dark: id as typeof choice.dark })}
        />
      </div>
    </section>
  )
}

function Row(props: {
  t: T
  mode: ThemeMode
  ids: readonly ThemeId[]
  picked: ThemeId
  fallback: ThemeId
  inUse: boolean
  onPick(id: ThemeId): void
}): React.JSX.Element {
  const { t } = props
  const label = t(props.mode === 'light' ? 'theme.light' : 'theme.dark')
  return (
    <div className={css.row}>
      <span className={css.rowHead}>
        <Icon name={props.mode === 'light' ? 'sun' : 'moon'} size={14} />
        {label}
        {props.inUse && <span className={css.inUse}>{t('theme.inUse')}</span>}
      </span>
      <div className={css.grid} role="radiogroup" aria-label={label}>
        {props.ids.map((id) => (
          <Swatch
            key={id}
            t={t}
            id={id}
            picked={id === props.picked}
            isDefault={id === props.fallback}
            onPick={() => props.onPick(id)}
          />
        ))}
      </div>
    </div>
  )
}

function Swatch(props: {
  t: T
  id: ThemeId
  picked: boolean
  isDefault: boolean
  onPick(): void
}): React.JSX.Element {
  const { t, id } = props
  const p = THEMES[id]
  const edge = `rgb(${p.ink} / ${p.lineStrongAlpha}%)`
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.picked}
      className={css.swatch}
      data-tip={t(DESC[id])}
      data-testid="wl-theme-option"
      data-theme={id}
      onClick={props.onPick}
    >
      <span className={css.preview} style={{ background: p.canvas }} aria-hidden="true">
        <span className={css.side} style={{ background: p.panel, borderColor: edge }}>
          <i style={{ background: p.text3 }} />
          <i style={{ background: p.text3 }} />
          <i style={{ background: p.text3 }} />
        </span>
        <span className={css.card} style={{ background: p.panel, borderColor: edge }}>
          <b style={{ background: p.cGreen }} />
          <i style={{ background: p.text }} />
        </span>
        <span className={css.link} style={{ background: p.always }} />
        <span
          className={css.card}
          data-second=""
          style={{ background: p.panel, borderColor: p.accent }}
        >
          <b style={{ background: p.cBlue }} />
          <i style={{ background: p.text }} />
        </span>
        <span className={css.read} style={{ borderColor: p.read }} />
        <span className={css.file} style={{ background: p.fileSurface, borderColor: edge }}>
          <i style={{ background: p.text3 }} />
        </span>
      </span>
      <span className={css.name}>
        {t(NAME[id])}
        {props.isDefault && <span className={css.default}>{t('theme.default')}</span>}
        {props.picked && <Icon name="check" size={13} />}
      </span>
    </button>
  )
}
