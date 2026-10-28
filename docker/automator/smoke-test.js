#!/usr/bin/env node
/**
 * 冒烟测试：automator.connect 后抽查核心 API（DEPLOY.md §4 runtime/smoke-test.js 复原）
 *
 * 用法（容器内，需已扫码登录 + entrypoint 打出 ✔ auto）：
 *   docker exec wxdt-dist /usr/bin/node /opt/smoke/smoke-test.js
 *   docker exec -e PROJECT=/projects/dist wxdt-dist /usr/bin/node /opt/smoke/smoke-test.js
 *   （必须用系统 /usr/bin/node：裸 node 解析到工具 bin/node 包装脚本会段错误）
 */
'use strict'
const automator = require('miniprogram-automator')

const PORT = process.env.AUTO_PORT || 9420
const wsEndpoint = `ws://127.0.0.1:${PORT}`
const ok = (name, extra) => console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`)

;(async () => {
  console.log(`[smoke] connecting ${wsEndpoint}`)
  const mp = await automator.connect({ wsEndpoint })
  ok('connect')

  const sys = await mp.systemInfo()
  ok('systemInfo', `${sys.platform} SDK ${sys.SDKVersion || '?'}`)

  const page = await mp.currentPage()
  if (!page) throw new Error('currentPage 为空（模拟器未起？）')
  ok('currentPage', page.path)

  const el = await page.$('#hello')
  if (!el) throw new Error('#hello 元素未找到（testapp 未编译？）')
  ok('page.$', await el.text())

  await (await page.$('#btn')).tap()
  await new Promise(r => setTimeout(r, 500))
  const state = await (await page.$('#tapped')).text()
  if (!/TAPPED/.test(state)) throw new Error(`tap 未生效: ${state}`)
  ok('element.tap → setData', state.trim())

  await mp.screenshot({ path: '/tmp/smoke-screenshot.png' })
  ok('screenshot', '/tmp/smoke-screenshot.png')

  const viaEvaluate = await mp.evaluate(() => (getApp() ? 'has-app' : 'no-app'))
  ok('evaluate', String(viaEvaluate))

  await mp.disconnect()
  ok('disconnect')
  console.log('[smoke] ALL PASS')
  process.exit(0)
})().catch(err => {
  console.error('[smoke] FAIL:', (err && err.message) || err)
  process.exit(1)
})
