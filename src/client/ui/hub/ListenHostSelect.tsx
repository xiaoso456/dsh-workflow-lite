/**
 * dsh-workflow-lite — 设置页「HTTP 触发监听地址」：仅本机、所有网卡、本机各块网卡的地址里选一个。
 *
 * 选了不是本机的地址时先浮出一张小卡说清风险（明文 HTTP，令牌能被同一网络里的人看到），点「允许」才改草稿；
 * 改回仅本机不用问。网卡列表由宿主每次读设置时现查；设置里的地址不在本机了（换了网），照样列出来并注明。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/ListenHostSelect
 */

import { useState } from 'react'
import { ANY_HOST, isLoopbackHost, LOCAL_HOST } from '../../../shared/triggerHttp.ts'
import type { ListenInterface } from '../../../shared/wire/config.ts'
import type { T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { Select } from '../kit/Select.tsx'
import css from './hubSettings.module.css'

export function hostOptions(
  t: T,
  value: string,
  interfaces: readonly ListenInterface[],
): { value: string; label: string }[] {
  const options = [
    { value: LOCAL_HOST, label: t('cfg.host.local') },
    { value: ANY_HOST, label: t('cfg.host.any') },
    ...interfaces.map((item) => ({
      value: item.address,
      label: `${item.address}（${item.name}）`,
    })),
  ]
  if (!options.some((option) => option.value === value)) {
    options.push({ value, label: t('cfg.host.missing').replace('{address}', value) })
  }
  return options
}

export function ListenHostSelect(props: {
  t: T
  value: string
  interfaces: readonly ListenInterface[]
  locked: boolean
  onChange(value: string): void
}): React.JSX.Element {
  const { t } = props
  const confirm = useConfirm<HTMLSpanElement>()
  const [pending, setPending] = useState<string | null>(null)
  const pick = (value: string): void => {
    if (isLoopbackHost(value)) {
      props.onChange(value)
      return
    }
    setPending(value)
    confirm.show()
  }
  return (
    <span ref={confirm.anchorRef} className={css.host}>
      {props.locked ? (
        <span className={css.hostLocked}>
          {hostOptions(t, props.value, props.interfaces).find((o) => o.value === props.value)
            ?.label ?? props.value}
        </span>
      ) : (
        <Select
          t={t}
          label={t('cfg.triggerHost')}
          value={props.value}
          options={hostOptions(t, props.value, props.interfaces)}
          testId="wl-cfg-triggerHost"
          onChange={pick}
        />
      )}
      {confirm.render({
        t,
        title: t('cfg.host.confirm'),
        desc: t('cfg.host.confirmDesc'),
        confirmText: t('cfg.host.confirmOk'),
        danger: false,
        testId: 'wl-cfg-triggerHost-confirm',
        onConfirm: () => {
          if (pending !== null) props.onChange(pending)
          setPending(null)
        },
      })}
    </span>
  )
}
