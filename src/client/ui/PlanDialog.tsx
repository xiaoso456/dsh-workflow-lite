/**
 * dsh-workflow-lite — 「预览计划」对话框：把当前工作流编译成派发计划给人看。
 *
 * 两个版本：「给模型」就是执行时模型拿到的那份（提示词以任务描述路径引用，工作区按本会话的写）；
 * 「给人看」把提示词内联，适合通读与存档。实例 id 执行时才有，计划里先留着 `{instance}`。
 * 打开前会先把没落盘的改动写下去——编译读的是磁盘。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/PlanDialog
 */

import { useEffect, useRef, useState } from 'react'
import type { PlanBuildResponse } from '../../shared/wire.ts'
import type { T } from '../i18n.ts'
import { errorMessage } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import css from './overlay.module.css'
import { copyText, cx, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

type Version = 'model' | 'human'
type View = 'rendered' | 'source'

export function PlanDialog(props: {
  t: T
  name: string
  build(full: boolean): Promise<PlanBuildResponse>
  onLocate(nodeId: string): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [version, setVersion] = useState<Version>('model')
  /** 排版看（默认）还是看源码——复制与下载永远是源码。 */
  const [view, setView] = useState<View>('rendered')
  const [result, setResult] = useState<PlanBuildResponse | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const build = useRef(props.build)
  build.current = props.build

  useEffect(() => {
    let alive = true
    setResult(null)
    setFailure(null)
    build
      .current(version === 'human')
      .then((value) => {
        if (alive) setResult(value)
      })
      .catch((error: unknown) => {
        if (alive) setFailure(errorMessage(error))
      })
    return () => {
      alive = false
    }
  }, [version])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const blocked = result !== null && result.problems.length > 0
  const text = result === null || blocked ? '' : result.plan

  const download = (): void => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${props.name}${version === 'human' ? '.full' : ''}.plan.md`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 点遮罩关闭；键盘走对话框自己的 Esc
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className={cx(css.scrim, ui.fade)}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={cx(ui.panel, css.dialog)}
        role="dialog"
        aria-modal="true"
        aria-label={t('plan.title')}
        tabIndex={-1}
        data-testid="wl-plan"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          props.onClose()
        }}
      >
        <header className={css.dialogHead}>
          <div className={css.dialogTitle}>
            <span>{t('plan.title')}</span>
          </div>
          <div className={css.versions}>
            <Segmented<Version>
              label={t('plan.title')}
              value={version}
              onChange={setVersion}
              options={[
                { value: 'model', label: t('plan.forModel') },
                { value: 'human', label: t('plan.forHuman') },
              ]}
            />
          </div>
          <div className={css.views}>
            <Segmented<View>
              label={t('plan.rendered')}
              value={view}
              onChange={setView}
              options={[
                { value: 'rendered', label: t('plan.rendered') },
                { value: 'source', label: t('plan.source') },
              ]}
            />
          </div>
          <span className={ui.grow} />
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            disabled={text === ''}
            onClick={() => {
              void copyText(text).then((ok) => {
                if (!ok) return
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              })
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            disabled={text === ''}
            onClick={download}
          >
            <Icon name="download" size={14} />
            {t('plan.download')}
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <p className={css.dialogHint}>
          {version === 'model' ? t('plan.forModelHint') : t('plan.forHumanHint')}
        </p>

        <div className={css.dialogBody}>
          {failure !== null ? (
            <p className={css.failure}>{failure}</p>
          ) : result === null ? (
            <div className={css.loading}>
              <span className={css.spinner} />
              {t('plan.loading')}
            </div>
          ) : blocked ? (
            <div className={css.blocked}>
              <p className={css.blockedTitle}>
                <Icon name="alert" size={16} />
                {t('plan.blocked')}
              </p>
              {result.problems.map((problem) => (
                <button
                  key={`${problem.code}:${problem.node ?? ''}:${problem.message}`}
                  type="button"
                  className={css.blockedItem}
                  disabled={problem.node === undefined}
                  onClick={() => {
                    if (problem.node === undefined) return
                    props.onClose()
                    props.onLocate(problem.node)
                  }}
                >
                  {problem.message}
                  {problem.node !== undefined && <Icon name="arrowRight" size={13} />}
                </button>
              ))}
            </div>
          ) : (
            <div className={cx(css.planScroll, ui.fade)} data-testid="wl-plan-text" key={view}>
              {view === 'rendered' ? (
                <Markdown text={result.plan} className={css.planDoc} />
              ) : (
                <pre className={css.plan}>{result.plan}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
