/**
 * dsh-workflow-lite — 触发发进去的会话还在不在忙：上一次没跑完时跳过、排队都按它判断。
 *
 * DSH 报的「运行中」（{@link SessionPort.busy}）在消息刚发进去时还没转过来：发进去之后到它第一次报运行中之前，
 * 最多 {@link WARMUP_MS} 也当它在忙，免得下一次触发趁这个空当又发一个进去。报过一次运行中之后就只看 DSH 的。
 * 只记在内存里：重启之后发进去的那些已经过了这段空当。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/busy
 */

import type { SessionPort } from './sessions.ts'

/** 刚发进去的会话，最多当它忙多久（等 DSH 报出运行中）。 */
export const WARMUP_MS = 30_000

export class SessionBusy {
  private readonly port: Pick<SessionPort, 'busy'>
  private readonly now: () => number
  /** 刚发进去、还没见它报过运行中的会话 → 发进去的时刻。 */
  private readonly warming = new Map<string, number>()

  constructor(port: Pick<SessionPort, 'busy'>, now: () => number) {
    this.port = port
    this.now = now
  }

  /** 刚往这个会话里发了一条触发消息。 */
  sent(session: string): void {
    this.warming.set(session, this.now())
  }

  busy(session: string): boolean {
    if (this.port.busy(session)) {
      this.warming.delete(session)
      return true
    }
    const since = this.warming.get(session)
    if (since === undefined) return false
    if (this.now() - since < WARMUP_MS) return true
    this.warming.delete(session)
    return false
  }
}
