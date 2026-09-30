/**
 * dsh-workflow-lite — 「新建节点模板」对话框。
 *
 * 为什么是**模态框**而不是行内输入：「自定义 node」末尾那枚「＋」要建的是一个模板，
 * 它有四个字段（模板名 / 显示名 / 提示词 / 产出）。塞进 28px 高的一行里没法用，
 * 而模板是要落成磁盘文件的（`templates/nodes/<名>.json`），名字该让人看清再按确认。
 *
 * 三个细节是有意的：
 *  1. **遮罩用 `color-mix` 从 `--wl-canvas` 兑出来**，不写裸色值、也不新增令牌
 *     （本视图的令牌表是冻结的）。它在浅色下是一层浅纱、深色下是一层深纱，
 *     两个主题下都让面板与背后的画布拉开层次。
 *  2. `Esc` **停在这一层**（`stopPropagation`）：画布根节点把 Esc 当"取消选中"，
 *     对话框开着时那一下不该同时改画布的选中态。
 *  3. 名字用 `checkName` 就地校验（与图名、模板名同一套规则），撞名由 host 回
 *     `conflict`，红字就地显示，不关框——人输了半天的正文不该因为名字重了白输。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/NodeTemplateDialog
 */

import { useEffect, useId, useRef, useState } from 'react'
import { checkName } from '../../shared/naming.ts'
import type { NodeData } from '../../shared/types.ts'
import css from './NodeTemplateDialog.module.css'
import type { Translate } from './Palette.tsx'
import ui from './ui.module.css'

/** 对话框的 props。 */
export interface NodeTemplateDialogProps {
  t: Translate
  /** 真正落盘的那一步（画布传的是那次 RPC 调用）。抛出的错误会被就地显示。 */
  create: (name: string, data: NodeData) => Promise<void>
  /** 建成之后：关框 + 重拉目录。 */
  onCreated: () => void
  /** 取消（按钮 / Esc / 点遮罩）。 */
  onCancel: () => void
}

/** 把未知错误转成一句能看的红字。 */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

/** 新建节点模板。 */
export function NodeTemplateDialog(props: NodeTemplateDialogProps): React.JSX.Element {
  const { t } = props
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const titleId = useId()

  // 打开就把焦点放进第一个字段：模态框的第一件事是让人能直接开始打字。
  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  /*
   * Esc 关框。挂在 **document 的捕获阶段**，而不是这个容器上：
   *
   * 画布根节点把 Esc 当"取消选中"，而那一层挂在 React 的根容器上（冒泡阶段）。
   * 在捕获里先停住它，关框这一下就不会顺手动画布上的选中态；反过来若挂在容器上，
   * 两者都是冒泡，顺序就取决于谁先注册了。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      props.onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [props.onCancel])

  const submit = (): void => {
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setError(t('template.name'))
      return
    }
    const problem = checkName(trimmed)
    if (problem !== null) {
      setError(problem.message)
      return
    }
    const data: NodeData = { prompt }
    if (label.trim() !== '') data.label = label.trim()
    if (output.trim() !== '') data.output = output.trim()
    setBusy(true)
    void props.create(trimmed, data).then(
      () => {
        setBusy(false)
        props.onCreated()
      },
      (failure: unknown) => {
        setBusy(false)
        setError(messageOf(failure))
      },
    )
  }

  return (
    <div className={css.scrim} data-testid="wl-template-dialog">
      {/*
        遮罩本身可点关闭。用**真按钮**而不是带 onClick 的 div：`tabIndex={-1}` 把它排除出
        键盘路径（键盘用户有 Esc 与「取消」两条路），但它仍是一个货真价实的控件，
        biome 的"可点元素必须有键盘路径"那条规则也就不需要 ignore 了。
      */}
      <button
        type="button"
        className={css.backdrop}
        data-testid="wl-template-backdrop"
        aria-label={t('template.cancel')}
        tabIndex={-1}
        onClick={props.onCancel}
      />
      <div
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="wl-template-panel"
      >
        <div className={css.head}>
          <span id={titleId} className={css.headTitle}>
            {t('template.title')}
          </span>
          <button
            type="button"
            className={[ui.iconButton, css.close].join(' ')}
            data-testid="wl-template-cancel-x"
            aria-label={t('template.cancel')}
            title={t('template.cancel')}
            onClick={props.onCancel}
          >
            ×
          </button>
        </div>

        <div className={css.body}>
          <label className={ui.field}>
            <span>{t('template.name')}</span>
            <input
              ref={nameRef}
              type="text"
              className={[ui.input, css.mono].join(' ')}
              data-testid="wl-template-name"
              value={name}
              placeholder={t('template.namePlaceholder')}
              aria-invalid={error !== null}
              onChange={(event) => {
                setName(event.target.value)
                if (error !== null) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                submit()
              }}
            />
          </label>
          <p className={css.hint}>{t('template.fileHint')}</p>

          <label className={ui.field}>
            <span>{t('template.label')}</span>
            <input
              type="text"
              className={ui.input}
              data-testid="wl-template-label"
              value={label}
              placeholder={t('template.labelPlaceholder')}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>

          <label className={ui.field}>
            <span>{t('template.prompt')}</span>
            <textarea
              className={[ui.textarea, css.prompt, css.mono].join(' ')}
              data-testid="wl-template-prompt"
              value={prompt}
              placeholder={t('template.promptPlaceholder')}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <label className={ui.field}>
            <span>{t('template.output')}</span>
            <input
              type="text"
              className={[ui.input, css.mono].join(' ')}
              data-testid="wl-template-output"
              value={output}
              placeholder={t('template.outputPlaceholder')}
              onChange={(event) => setOutput(event.target.value)}
            />
          </label>

          {error !== null && (
            <p className={[ui.problem, css.error].join(' ')} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className={css.foot}>
          <button
            type="button"
            className={ui.button}
            data-testid="wl-template-cancel"
            onClick={props.onCancel}
          >
            {t('template.cancel')}
          </button>
          <button
            type="button"
            className={[ui.button, ui.buttonPrimary].join(' ')}
            data-testid="wl-template-create"
            disabled={busy}
            onClick={submit}
          >
            {t('template.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
