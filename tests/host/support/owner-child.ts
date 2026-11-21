/**
 * `triggerOwner.spec.ts` 用的子进程：一个独立的「DSH 进程」，打开同一个数据库，到约定的时刻报到一次，
 * 打出结论（一行 JSON），然后一直挂着，直到标准输入关掉（测试结束）或被杀掉（模拟崩溃）。
 *
 * usage: node --experimental-strip-types owner-child.ts <数据库文件> <开始报到的时刻（毫秒）>
 */

import { PluginDatabase } from '../../../src/host/store/database.ts'
import { OwnerLock } from '../../../src/host/triggers/owner.ts'

const [file, startAt] = process.argv.slice(2)
if (file === undefined || startAt === undefined) throw new Error('要给数据库文件和开始时刻')
const lock = new OwnerLock({ database: new PluginDatabase(() => file) })
const wait = Number(startAt) - Date.now()
if (wait > 0) await new Promise((done) => setTimeout(done, wait))
console.log(JSON.stringify({ pid: process.pid, mine: await lock.beat() }))
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
