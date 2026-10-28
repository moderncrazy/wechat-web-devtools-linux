#!/usr/bin/env node
/**
 * app.asar 等长补丁 — IDE 服务端口启动门修复（DEPLOY.md §4.3 #4）
 *
 * 背景：settings 未 REHYDRATE 时，服务端口启动门表达式抛错短路，
 *       服务端口永不开启 → automator 握手失败（连上但 App.* 全超时）。
 *       等长替换（短内容补空格）不改字节偏移，asar 索引不受影响。
 *
 * 4 处替换（DEPLOY.md §4.3 原文）：
 *   p1  security:{enableServicePort:!1 → !0     默认值放开            【必须命中，否则退出码 1】
 *   p2  CLI_enableServicePort getter → return!0 恒真兜底              【未命中仅警告】
 *   p3  (settings.enableServicePort||CLI_enableServicePort)&& → !0&&
 *                                             启动门无条件放行        【必须命中，否则退出码 1】
 *   p4  门内 updateSetting 前置守卫 → !1&&      跳过再次触碰 settings   【未命中仅警告】
 *
 * 用法：
 *   node patch-asar.js <app.asar>            # 打补丁（幂等，可重复执行）
 *   node patch-asar.js <app.asar> --inspect  # 只打印锚点上下文，不修改（版本漂移时校准用）
 */
'use strict'
const fs = require('fs')

const INSPECT = process.argv.includes('--inspect')
const asarPath = process.argv.filter(a => !a.startsWith('--'))[2]
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('usage: node patch-asar.js <app.asar> [--inspect]')
  process.exit(2)
}

const buf = fs.readFileSync(asarPath)
// latin1 与字节 1:1 对应：整个补丁过程字符串长度不变，写回即无偏移
const original = buf.toString('latin1')
let text = original

const padTo = (s, len) => {
  if (s.length > len) throw new Error(`替换内容(${s.length})长于原片段(${len}): ${s}`)
  return s + ' '.repeat(len - s.length)
}
const replaceAll = (find, buildRepl) => {
  let count = 0
  let idx = text.indexOf(find)
  while (idx >= 0) {
    const repl = buildRepl(find.length)
    text = text.slice(0, idx) + repl + text.slice(idx + find.length)
    count++
    idx = text.indexOf(find, idx + repl.length)
  }
  return count
}
const replaceAllRegex = (re, buildRepl) => {
  let count = 0
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    const repl = buildRepl(m[0].length)
    text = text.slice(0, m.index) + repl + text.slice(m.index + m[0].length)
    count++
    re.lastIndex = m.index + repl.length
  }
  return count
}
const contextOf = (anchor, nth = 0, span = 100) => {
  let idx = -1
  for (let i = 0; i <= nth; i++) idx = text.indexOf(anchor, idx + 1)
  return idx < 0 ? null : text.slice(Math.max(0, idx - span), idx + anchor.length + span)
}

// --inspect：打印原始（未打补丁）锚点上下文后退出，用于版本漂移时校准锚点
if (INSPECT) {
  for (const anchor of ['enableServicePort', 'CLI_enableServicePort', 'updateSetting']) {
    for (let n = 0; n < 3; n++) {
      const ctx = contextOf(anchor, n)
      if (!ctx) break
      console.log(`[inspect] ${anchor}#${n}: ...${ctx}...`)
    }
  }
  console.log('[inspect] 未修改文件')
  process.exit(0)
}

// p1 默认值：单字符翻转 !1 → !0（天然等长）
let p1 = replaceAll('security:{enableServicePort:!1',
  () => 'security:{enableServicePort:!0')

// p2 getter 恒真：定位 getter 体 {...}，整段换成 return!0 + 空格填充
//    （幂等：打过的体是 "return!0   ..."，重跑跳过）
let p2 = 0
let p2Done = 0
try {
  const anchor = 'CLI_enableServicePort(){'
  let idx = text.indexOf(anchor)
  while (idx >= 0) {
    const bodyStart = idx + anchor.length
    let depth = 1
    let i = bodyStart
    while (i < text.length && depth > 0) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    if (depth !== 0) throw new Error('getter 花括号不配对')
    const bodyEnd = i - 1
    const body = text.slice(bodyStart, bodyEnd)
    if (body.replace(/ /g, '') === 'return!0') {
      p2Done++
    } else {
      const repl = padTo('return!0', body.length)
      text = text.slice(0, bodyStart) + repl + text.slice(bodyEnd)
      p2++
    }
    idx = text.indexOf(anchor, i)
  }
} catch (e) {
  console.warn(`⚠ p2 getter 替换跳过: ${e.message}`)
}

// p3 启动门 → !0&& + 空格填充（无条件放行；先于 p4：p4 锚定在 p3 打过的标记上）
// 锚点用正则并容忍两侧对象前缀：实测 v2.02.2608080 的 getter 挂在对象上（p2 命中
// get X(){...}），门表达式按成员表达式访问（如 this.CLI_enableServicePort / e.xxx）
const GATE_RE = /\(?\s*[\w$.]+\.enableServicePort\s*\|\|\s*[\w$.]*CLI_enableServicePort\s*\)?\s*&&/g
let p3 = replaceAllRegex(GATE_RE, len => padTo('!0&&', len))

// p4 门内 updateSetting 守卫 → !1&&（跳过再次触碰 settings）
//    锚点：p3 替换后留下的 '!0&&'+空格 标记；守卫字符集排除 ,;{}() ——
//    保证只匹配紧邻 updateSetting 的单个条件表达式，不吞门内其他调用
let p4 = 0
try {
  const mGate = /!0&& {10,}/.exec(text)
  if (mGate) {
    const from = mGate.index + mGate[0].length
    const win = text.slice(from, from + 800)
    const m = /([^,;{}()]{1,80}?)&&([A-Za-z0-9_$.]{0,40}updateSetting\()/.exec(win)
    if (m) {
      const guardStart = from + m.index
      const guard = m[1]
      // 守卫可能只有 1 个字符（压缩变量）：!1 塞不下，用等长的 0（同为 falsy）
      const falsy = guard.length >= 2 ? padTo('!1', guard.length) : '0'
      text = text.slice(0, guardStart) + falsy + text.slice(guardStart + guard.length)
      p4 = 1
    }
  }
} catch (e) {
  console.warn(`⚠ p4 updateSetting 守卫替换跳过: ${e.message}`)
}

// ---- 汇总与校验 ----
// p3 未命中时把现场上下文打进日志：调用方直接回传日志即可校准锚点，无需再来取 asar
const dumpGateContext = () => {
  console.error('--- p3 现场上下文（用于校准锚点，直接回传本段日志）---')
  for (const anchor of ['CLI_enableServicePort', 'enableServicePort']) {
    let idx = -1
    for (let n = 0; n < 5; n++) {
      idx = text.indexOf(anchor, idx + 1)
      if (idx < 0) break
      console.error(`[ctx] ${anchor}#${n}: ...${text.slice(Math.max(0, idx - 120), idx + anchor.length + 120)}...`)
    }
  }
}
let fatal = 0
if (p1 > 0) console.log('✔ p1 默认值 enableServicePort:!1→!0')
else if (text.includes('security:{enableServicePort:!0')) console.log('✔ p1 已是打过状态')
else { console.error('✖ p1 未命中'); fatal++ }
if (p2 > 0) console.log(`✔ p2 getter 恒真 替换 ${p2} 处`)
else if (p2Done > 0) console.log('✔ p2 已是打过状态')
else console.warn('⚠ p2 getter 未命中（非致命，p3 已短路其读取）')
if (p3 > 0) console.log(`✔ p3 启动门放行 替换 ${p3} 处`)
else if (/!0&& {10,}/.test(text)) console.log('✔ p3 已是打过状态')
else { console.error('✖ p3 未命中'); dumpGateContext(); fatal++ }
if (p4 > 0) console.log('✔ p4 updateSetting 守卫跳过')
else console.warn('⚠ p4 updateSetting 守卫未命中（非致命）')

if (text.length !== original.length) {
  console.error(`✖ 等长校验失败：${original.length} → ${text.length}，放弃写入`)
  process.exit(1)
}
if (text !== original) {
  buf.write(text, 0, 'latin1')
  fs.writeFileSync(asarPath, buf)
  console.log(`patched: ${asarPath}（大小不变 ${buf.length} 字节）`)
} else {
  console.log('no changes')
}
process.exit(fatal ? 1 : 0)
