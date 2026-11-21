/**
 * dsh-workflow-lite — 选轮询、监听用哪个 shell：列「默认」、本机找得到的几个（名字下面一行完整路径），
 * 最后一项「选择其他 shell…」打开选文件的对话框自己挑一个程序。
 *
 * 两种外形，同一份选项（{@link useShellChoices}）：
 * - {@link ShellSelect}：设置页「触发」组里的下拉（`default`：空着是「系统默认」）；
 * - {@link ShellButton}：「触发方式」对话框命令工作台顶上一条里的小按钮，点开是同样的菜单
 *   （`card`：空着是「跟随默认」，指的是设置里的默认）。
 *
 * 自己挑的程序先交给宿主认一遍，认不出（不是 cmd、PowerShell、sh 一类，或者找不到）就不换，经 `onProblem` 说原因。
 * 选文件从挑过的那个程序所在的目录开始；没挑过从主目录开始（不进 System32 这种几千个文件的目录）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ShellSelect
 */

import { useEffect, useRef, useState } from 'react'
import type { ShellChoice, TriggerShellsResponse } from '../../../shared/wire/trigger.ts'
import { programDir, programName, type ShellAccess } from '../../app/shells.ts'
import type { T } from '../../i18n.ts'
import { Popover } from '../kit/Popover.tsx'
import {
  type MenuPlace,
  menuPlace,
  Select,
  type SelectOption,
  TWO_LINE_HEIGHT,
} from '../kit/Select.tsx'
import { SelectMenu } from '../kit/SelectMenu.tsx'
import { HostPicker } from '../resources/HostPicker.tsx'

/** 「选择其他」那一项的值（完整路径不会以冒号开头，不会和真的选项撞上）。 */
const PICK = ':pick'

interface ShellProps {
  t: T
  access: ShellAccess
  /** 选的程序的完整路径；空串 = 默认。 */
  value: string
  /** `card`：空着跟随设置里的默认；`default`：设置页本身，空着是系统的。 */
  mode: 'card' | 'default'
  testId: string
  onChange(path: string): void
  /** 自己挑的程序用不了时的原因；挑好了、或换了别的时是 `null`。 */
  onProblem?(problem: string | null): void
}

/** 两种外形共用：菜单里列什么、现在是哪一项、选了之后怎么办、选文件的对话框。 */
function useShellChoices(props: ShellProps): {
  options: SelectOption<string>[]
  /** 现在选的那一项（值按清单里的写法）。 */
  current: SelectOption<string> | undefined
  pick(value: string): void
  /** 选文件的对话框（没在选时是 `null`）。 */
  picker: React.ReactNode
} {
  const { t, access } = props
  const [catalog, setCatalog] = useState<TriggerShellsResponse | null>(null)
  /** 这次挑进来的程序（还不在清单里的），给它一个好看的名字。 */
  const [picked, setPicked] = useState<ShellChoice | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let live = true
    void access.catalog().then(
      (result) => {
        if (live) setCatalog(result)
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [access])

  const base = props.mode === 'card' ? catalog?.fallback : catalog?.system
  const options: SelectOption<string>[] = [
    {
      value: '',
      label: t(props.mode === 'card' ? 'trigger.shell.follow' : 'trigger.shell.system').replace(
        '{name}',
        base?.name ?? '…',
      ),
      ...(base === undefined ? {} : { desc: base.path }),
    },
  ]
  const seen = new Set([''])
  const add = (choice: ShellChoice): void => {
    const key = choice.path.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    options.push({ value: choice.path, label: choice.name, desc: choice.path })
  }
  for (const shell of catalog?.shells ?? []) {
    // 设置页里系统的那个就是「系统默认」，不再列一遍。
    if (props.mode === 'default' && shell.path === catalog?.system.path) continue
    add(shell)
  }
  const detected = seen.has(props.value.toLowerCase())
  if (props.value !== '' && !detected) {
    add(
      picked?.path === props.value
        ? picked
        : { path: props.value, name: programName(props.value), family: 'posix' },
    )
  }
  options.push({ value: PICK, label: t('trigger.shell.pick') })

  // Windows 上路径不分大小写：存着的和清单里的写法不一样也算同一项。
  const current = options.find((option) => option.value.toLowerCase() === props.value.toLowerCase())
  // 从自己挑过的那个程序的目录开始翻；本机找到的那几个（cmd 在 System32 里）不从它们那儿开始。
  const start = props.value !== '' && !detected ? programDir(props.value) : undefined

  const pick = (value: string): void => {
    if (value === PICK) {
      setPicking(true)
      return
    }
    props.onProblem?.(null)
    props.onChange(value)
  }

  const picker = picking && (
    <HostPicker
      t={t}
      host={access.host}
      mode="file"
      single
      {...(start === undefined ? {} : { start })}
      onPick={(paths) => {
        setPicking(false)
        const path = paths[0]
        if (path === undefined) return
        void access.check(path).then((result) => {
          if (typeof result === 'string') {
            props.onProblem?.(result)
            return
          }
          setPicked(result)
          props.onProblem?.(null)
          props.onChange(result.path)
        })
      }}
      onClose={() => setPicking(false)}
    />
  )
  return { options, current, pick, picker }
}

/** 设置页的下拉；`disabled` 时只写着现在是哪个。 */
export function ShellSelect(
  props: ShellProps & { disabled?: boolean; className?: string },
): React.JSX.Element {
  const { t } = props
  const { options, current, pick, picker } = useShellChoices(props)
  return (
    <>
      {props.disabled === true ? (
        <span className={props.className}>{current?.label ?? props.value}</span>
      ) : (
        <Select<string>
          t={t}
          search
          className={props.className}
          label={t('trigger.shell')}
          value={current?.value ?? props.value}
          options={options}
          testId={props.testId}
          onChange={pick}
        />
      )}
      {picker}
    </>
  )
}

/**
 * 工作台顶上一条里的小按钮：终端图标 + 现在用的 shell 的名字，点开是同样的菜单（带完整路径）。
 * 提示里写完整路径；`changed`（和存着的不一样）时按钮标出来。
 */
export function ShellButton(
  props: ShellProps & {
    className: string
    menuClassName: string
    changed: boolean
    /** 按钮里面画什么（拿到的是按钮上写的名字）：工作台顶栏给能跟着字滑宽的那种。 */
    face(name: string): React.ReactNode
  },
): React.JSX.Element {
  const { t } = props
  const { options, current, pick, picker } = useShellChoices(props)
  const [menu, setMenu] = useState<MenuPlace | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = (): void => {
    setMenu(null)
    button.current?.focus()
  }
  // 按钮上只写名字：「跟随默认（cmd）」写成「cmd」，跟着默认的在提示里说。
  const name =
    props.value === ''
      ? current?.desc === undefined
        ? '…'
        : programName(current.desc)
      : (current?.label ?? programName(props.value))
  return (
    <>
      <Popover
        open={menu !== null}
        onClose={close}
        label={t('trigger.shell')}
        align="end"
        up={menu?.up === true}
        className={props.menuClassName}
        trigger={
          <button
            ref={button}
            type="button"
            className={props.className}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            aria-label={`${t('trigger.shell')}：${current?.label ?? name}`}
            data-changed={props.changed || undefined}
            data-tip={current?.label}
            data-testid={props.testId}
            onClick={() =>
              setMenu(
                menu === null
                  ? menuPlace(button.current, options.length, true, TWO_LINE_HEIGHT)
                  : null,
              )
            }
          >
            {props.face(name)}
          </button>
        }
      >
        <SelectMenu<string>
          open={menu !== null}
          label={t('trigger.shell')}
          options={options}
          value={current?.value ?? props.value}
          searchable
          t={t}
          testId={props.testId}
          listMax={menu?.list ?? 320}
          onPick={(value) => {
            close()
            pick(value)
          }}
        />
      </Popover>
      {picker}
    </>
  )
}
