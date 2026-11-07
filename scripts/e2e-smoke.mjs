#!/usr/bin/env node
/**
 * E2E 冒烟测试：用无头 Chrome（CDP）驱动真实页面，验证
 *   1. 页面无 JS 异常
 *   2. 地图 canvas 已绘制（像素采样：底图色 + 5A 金色散点 + 4A 青色散点）
 *   3. 性能：全国视图空闲时画布静止（无持续动画重绘）
 *   4. 点击省份坐标 → 下钻省份视图（面包屑变化）
 *   5. Esc → 返回全国
 *   6. 搜索「故宫」→ 点击结果 → 详情抽屉打开
 *   7. 关闭抽屉
 *   8. 主题切换（浅色 ↔ 深色）生效
 *
 * 前置：npm run build && npm run preview（默认 http://localhost:4173）
 * 用法：node scripts/e2e-smoke.mjs [url]
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.argv[2] ?? 'http://localhost:4173/'
const OUT = join(tmpdir(), 'scenic-e2e')
const PORT = 9333

/* ---------------- CDP 客户端 ---------------- */

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.consoleErrors = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg)
        this.pending.delete(msg.id)
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(msg.params.exceptionDetails.text)
      } else {
        this.events.push(msg)
      }
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
        else resolve(msg.result)
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poll)
        reject(new Error(`等待事件 ${method} 超时`))
      }, timeoutMs)
      const poll = setInterval(() => {
        const idx = this.events.findIndex((e) => e.method === method)
        if (idx >= 0) {
          clearTimeout(timer)
          clearInterval(poll)
          resolve(this.events.splice(idx, 1)[0].params)
        }
      }, 50)
    })
  }

  async evaluate(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    })
    if (r.exceptionDetails) {
      throw new Error(
        `页面执行出错: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      )
    }
    return r.result?.value
  }

  async screenshot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    await mkdir(OUT, { recursive: true })
    await writeFile(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'))
    console.log(`  📸 ${join(OUT, `${name}.png`)}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/* ---------------- 主流程 ---------------- */

async function main() {
  console.log(`启动 Chrome … ${URL}`)
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + join(tmpdir(), 'scenic-e2e-profile'),
    'about:blank',
  ])
  chrome.on('error', (e) => {
    console.error(`无法启动 Chrome（路径: ${CHROME}）: ${e.message}`)
    console.error('可通过环境变量 CHROME_PATH 指定浏览器路径。')
    process.exit(1)
  })

  // 等待 DevTools 端口就绪（慢 CI 机器上 Chrome 启动可能超过 2s）
  let ready = false
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      ready = r.ok
    } catch {
      await sleep(150)
    }
  }
  if (!ready) {
    console.error('Chrome DevTools 端口 15 秒内未就绪')
    chrome.kill('SIGKILL')
    process.exit(1)
  }

  try {
    const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, {
      method: 'PUT',
    }).then((r) => r.json())
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1680,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false,
    })

    await cdp.send('Page.navigate', { url: URL })
    await cdp.waitFor('Page.loadEventFired')

    // 等待应用挂载完成（KPI 数字渲染）
    const mounted = await cdp.evaluate(`(async () => {
      for (let i = 0; i < 100; i++) {
        const kpi = document.querySelector('.kpi-value')
        if (kpi && Number(kpi.textContent) > 0) return true
        await new Promise(r => setTimeout(r, 100))
      }
      return false
    })()`)
    check('应用挂载且数据加载', mounted)

    // 默认仅显示 5A：初始 KPI 的 4A 应为 0，验证默认状态
    const fourAOff = await cdp.evaluate(
      `Number(document.querySelector('.kpi.cyan .kpi-value')?.textContent ?? -1) === 0`,
    )
    check('默认仅显示 5A', fourAOff)
    check(
      '首屏不请求 4A 数据',
      await cdp.evaluate(
        `!performance.getEntriesByType('resource').some(r => r.name.includes('/data/spots-4a.json'))`,
      ),
    )

    // 开启 4A（运行时异步加载 public/data/spots-4a.json），等待其完成
    await cdp.evaluate(`document.querySelector('.level-filter .chip.l4')?.click()`)
    const fourALoaded = await cdp.evaluate(`(async () => {
      for (let i = 0; i < 100; i++) {
        const kpi4a = document.querySelector('.kpi.cyan .kpi-value')
        if (kpi4a && Number(kpi4a.textContent) > 900) return true
        await new Promise(r => setTimeout(r, 100))
      }
      return false
    })()`)
    check('开启 4A 后全量数据异步加载', fourALoaded)
    await sleep(1200) // 等待入场动画结束、渲染稳定

    /* --- 1. 控制台错误 --- */
    check(
      '无 JS 控制台错误',
      cdp.consoleErrors.length === 0,
      cdp.consoleErrors.slice(0, 3).join(' | '),
    )

    /* --- 2. canvas 像素采样（zlevel 不同会拆分多个 canvas） --- */
    const pixels = await cdp.evaluate(`(() => {
      const cvs = document.querySelectorAll('.map-panel .chart canvas')
      if (!cvs.length) return { error: 'canvas 不存在' }
      let blue = 0, gold = 0, cyan = 0, total = 0, w = 0, h = 0
      for (const cv of cvs) {
        w = Math.max(w, cv.width); h = Math.max(h, cv.height)
        const ctx = cv.getContext('2d')
        for (let y = 0; y < cv.height; y += 10) {
          for (let x = 0; x < cv.width; x += 10) {
            const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
            total++
            if (b > 110 && b > r + 30 && g > 60) blue++        // 地图区域/边界蓝色系
            if (r > 200 && g > 120 && b < 160) gold++          // 5A 金色散点
            if (r < 120 && g > 140 && b > 120) cyan++          // 4A 青色散点
          }
        }
      }
      return { w, h, total, blue, gold, cyan, blueRatio: blue / total, goldCount: gold, cyanCount: cyan }
    })()`)
    if (pixels.error) {
      check('地图 canvas 存在', false, pixels.error)
    } else {
      check(
        '地图区域已绘制',
        pixels.blueRatio > 0.02,
        `蓝色像素占比 ${(pixels.blueRatio * 100).toFixed(1)}%`,
      )
      check('5A 散点已绘制', pixels.goldCount >= 20, `金色采样点 ${pixels.goldCount}`)
      check('4A 散点已绘制', pixels.cyanCount >= 10, `青色采样点 ${pixels.cyanCount}`)
    }

    /* --- 3. 性能：空闲时画布应静止（涟漪仅悬停触发） --- */
    const idleStatic = await cdp.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 300))
      const snap = () => Array.from(document.querySelectorAll('.map-panel .chart canvas'), c => c.toDataURL()).join('')
      const a = snap()
      await new Promise(r => setTimeout(r, 1200))
      const b = snap()
      return a === b
    })()`)
    check('全国视图空闲时画布静止（性能）', idleStatic, idleStatic ? '' : '画布持续重绘中')

    await cdp.screenshot('01-national')
    await cdp.evaluate(`window.__scenicChart.setOption({geo: [{zoom: 1.35}]})`)
    await sleep(500)

    /* --- 3b. 投影方向断言（防投影符号错误：北在上、东在右） ---
       底图为预投影平面坐标，convertToPixel 前需先做 Lambert 投影 */
    const proj = await cdp.evaluate(`(() => {
      const chart = window.__scenicChart
      if (!chart) return { error: 'no chart' }
      const D = Math.PI / 180
      const P1 = 25 * D, P2 = 47 * D, L0 = 105 * D
      const n = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(Math.tan(Math.PI / 4 + P2 / 2) / Math.tan(Math.PI / 4 + P1 / 2))
      const F = (Math.cos(P1) * Math.pow(Math.tan(Math.PI / 4 + P1 / 2), n)) / n
      const rho0 = F / Math.pow(Math.tan(Math.PI / 4 + 36 * D / 2), n)
      const proj = (lng, lat) => {
        const p = lat * D
        const rho = F / Math.pow(Math.tan(Math.PI / 4 + p / 2), n)
        const th = n * (lng * D - L0)
        return [rho * Math.sin(th), rho0 - rho * Math.cos(th)]
      }
      const px = (lng, lat) => chart.convertToPixel({ geoIndex: 0 }, proj(lng, lat))
      const bj = px(116.4, 39.9), sy = px(109.5, 18.2), sh = px(121.5, 31.2), ls = px(91.1, 29.7)
      return {
        northUp: bj[1] < sy[1] - 50,
        eastRight: sh[0] > ls[0] + 150,
        spread: Math.abs(sh[0] - ls[0]) + Math.abs(bj[1] - sy[1]),
      }
    })()`)
    if (proj.error) {
      check('投影方向', false, proj.error)
    } else {
      check('投影方向（北在上）', proj.northUp)
      check('投影方向（东在右）', proj.eastRight, `跨度 ${Math.round(proj.spread)}px`)
    }

    /* --- 4. 点击省份（川西无景区坐标，避免点中散点）→ 下钻 --- */
    const clickPos = await cdp.evaluate(`(() => {
      const chart = window.__scenicChart
      if (!chart) return { error: 'chart 实例未暴露' }
      const D = Math.PI / 180
      const P1 = 25 * D, P2 = 47 * D, L0 = 105 * D
      const n = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(Math.tan(Math.PI / 4 + P2 / 2) / Math.tan(Math.PI / 4 + P1 / 2))
      const F = (Math.cos(P1) * Math.pow(Math.tan(Math.PI / 4 + P1 / 2), n)) / n
      const rho0 = F / Math.pow(Math.tan(Math.PI / 4 + 36 * D / 2), n)
      const p = 32.0 * D
      const rho = F / Math.pow(Math.tan(Math.PI / 4 + p / 2), n)
      const th = n * (102.5 * D - L0)
      const [x, y] = chart.convertToPixel({ geoIndex: 0 }, [rho * Math.sin(th), rho0 - rho * Math.cos(th)])
      const rect = document.querySelector('.map-panel .chart').getBoundingClientRect()
      return { x: rect.x + x, y: rect.y + y }
    })()`)
    if (clickPos.error) {
      check('chart 实例暴露', false, clickPos.error)
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: clickPos.x,
        y: clickPos.y,
        button: 'left',
        clickCount: 1,
      })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: clickPos.x,
        y: clickPos.y,
        button: 'left',
        clickCount: 1,
      })
      await sleep(1500) // 等待懒加载 + 渲染
      // 防御：若不巧点中散点打开了详情抽屉，先关闭再检查
      await cdp.evaluate(
        `document.querySelector('.drawer .close-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
      )
      await sleep(300)
      const breadcrumb = await cdp.evaluate(
        `document.querySelector('.breadcrumb button.province')?.textContent ?? ''`,
      )
      check('点击区域后聚焦', breadcrumb.includes('四川'), `面包屑: ${breadcrumb.trim()}`)

      // 聚焦视图断言：切换到省级地图 + 双 geo（邻省淡化背景层）
      const focusState = await cdp.evaluate(`(() => {
        const geos = window.__scenicChart?.getOption()?.geo ?? []
        return {
          geoCount: geos.length,
          bgMap: geos[0]?.map ?? '',
          fgMap: geos[1]?.map ?? '',
          fgZoom: geos[1]?.zoom ?? 0,
        }
      })()`)
      check('聚焦切换到省级地图', focusState.fgMap === '510000', `前景 map: ${focusState.fgMap}`)
      check('邻省淡化背景层（双 geo）', focusState.geoCount === 2 && focusState.bgMap === 'cn')
      await cdp.screenshot('02-focus-sichuan')

      // 聚焦视图下当前区域散点应仍存在
      const pixels2 = await cdp.evaluate(`(() => {
        let gold = 0, total = 0
        for (const cv of document.querySelectorAll('.map-panel .chart canvas')) {
          const ctx = cv.getContext('2d')
          for (let y = 0; y < cv.height; y += 8) {
            for (let x = 0; x < cv.width; x += 8) {
              const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
              total++
              if (r > 200 && g > 120 && b < 160) gold++
            }
          }
        }
        return { gold, total }
      })()`)
      check('聚焦视图散点绘制', pixels2.gold >= 5, `金色采样点 ${pixels2.gold}`)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
      await sleep(500)
      const idleFrames = await cdp.evaluate(`(async () => {
        let frames = 0
        const zr = window.__scenicChart.getZr()
        const count = () => frames++
        zr.on('rendered', count)
        await new Promise(r => setTimeout(r, 1000))
        zr.off('rendered', count)
        return frames
      })()`)
      check('省份空闲一秒零重绘', idleFrames === 0, idleFrames + ' 帧')

      check(
        '省份 KPI 与地图点数一致',
        await cdp.evaluate(`(() => {
        const series = window.__scenicChart.getOption().series
        const count = series.filter(s => ['5A景区', '4A景区'].includes(s.name))
          .reduce((sum, s) => sum + s.data.length, 0)
        return Number(document.querySelector('.kpi-value').textContent) === count
      })()`),
      )
      await cdp.evaluate(`window.__scenicChart.setOption({geo: [{}, {zoom: 2.2}]})`)
      await cdp.evaluate(`document.querySelector('.level-filter .chip.l4').click()`)
      await sleep(600)
      check(
        '省份筛选保留缩放',
        await cdp.evaluate(`Math.abs(window.__scenicChart.getOption().geo[1].zoom - 2.2) < 0.001`),
      )
      await cdp.evaluate(`document.querySelector('.level-filter .chip.l4').click()`)
      await sleep(600)

      /* --- 5. Esc 返回全国 --- */
      await cdp.evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      )
      await sleep(800)
      const backNational = await cdp.evaluate(
        `!document.querySelector('.breadcrumb button.province')`,
      )
      check('Esc 返回全国视图', backNational)
      check(
        '返回全国恢复之前视角',
        await cdp.evaluate(`Math.abs(window.__scenicChart.getOption().geo[0].zoom - 1.35) < 0.001`),
      )
    }

    /* --- 6. 搜索故宫 → 打开详情 --- */
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '故宫')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.dispatchEvent(new FocusEvent('focus'))
    })()`)
    await sleep(400)
    const firstResult = await cdp.evaluate(
      `document.querySelector('.search-results button')?.textContent ?? ''`,
    )
    check('搜索结果出现', firstResult.includes('故宫'), `首条: ${firstResult.trim().slice(0, 30)}`)
    // 搜索结果监听 mousedown（避免 input blur 先触发收起列表）
    await cdp.evaluate(`document.querySelector('.search-results button')?.click()`)
    await sleep(600)
    const drawerName = await cdp.evaluate(
      `document.querySelector('.drawer .spot-name')?.textContent ?? ''`,
    )
    check('详情抽屉打开', drawerName.includes('故宫'), `抽屉标题: ${drawerName}`)
    check(
      '封面加载时保留插画占位',
      await cdp.evaluate(`Boolean(document.querySelector('.cover .art'))`),
    )
    await cdp.screenshot('03-spot-detail')

    /* --- 7. 关闭抽屉 --- */
    await cdp.evaluate(`document.querySelector('.drawer .close-btn')?.click()`)
    await sleep(400)
    const drawerClosed = await cdp.evaluate(`!document.querySelector('.drawer')`)
    check('抽屉关闭', drawerClosed)

    /* --- 7b. 搜索：无结果提示 + 键盘导航（↓ + Enter） --- */
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'zzz不存在的景区')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.dispatchEvent(new FocusEvent('focus'))
    })()`)
    await sleep(300)
    const emptyShown = await cdp.evaluate(`Boolean(document.querySelector('.search-empty'))`)
    check('搜索无结果提示', emptyShown)

    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '黄山')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      input.dispatchEvent(new FocusEvent('focus'))
    })()`)
    await sleep(400)
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })()`)
    await sleep(600)
    const drawerName2 = await cdp.evaluate(
      `document.querySelector('.drawer .spot-name')?.textContent ?? ''`,
    )
    check('搜索键盘导航（↓ + Enter）', drawerName2.includes('黄山'), `抽屉标题: ${drawerName2}`)
    await cdp.evaluate(`document.querySelector('.drawer .close-btn')?.click()`)
    await sleep(300)
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(300)

    /* --- 8. 主题切换 --- */
    // 切到地形模式验证（晕渲层 + 河流 + 标注）——先关抽屉 + 返回全国视图
    await cdp.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    await sleep(400)
    await cdp.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    await sleep(800)
    await cdp.evaluate(`document.querySelectorAll('.mode-toggle .mode-btn')[1]?.click()`)
    await sleep(3000)
    const terrainOk = await cdp.evaluate(`(() => {
      const cv = document.querySelector('.terrain-layer')
      if (!cv) return { error: 'no canvas' }
      const ctx = cv.getContext('2d')
      let painted = 0, total = 0
      for (let y = 0; y < cv.height; y += 24) for (let x = 0; x < cv.width; x += 24) {
        const d = ctx.getImageData(x, y, 1, 1).data
        total++
        if (d[3] > 0) painted++
      }
      return { painted: (painted / total * 100).toFixed(1), series: window.__scenicChart.getOption().series.map(s => s.name) }
    })()`)
    const hasRiver = (terrainOk.series ?? []).includes('河流')
    const hasLabels = (terrainOk.series ?? []).includes('地理标注')
    check('地形模式晕渲层绘制', Number(terrainOk.painted) > 5, `覆盖 ${terrainOk.painted}%`)
    check('地形模式河流系列', hasRiver)
    check('地形模式地理标注', hasLabels)
    // 地形模式下点击省份聚焦 + 市级边界叠加
    const posT = await cdp.evaluate(`(() => {
      const chart = window.__scenicChart
      const D = Math.PI / 180, P1 = 25*D, P2 = 47*D, L0 = 105*D
      const N = Math.log(Math.cos(P1)/Math.cos(P2))/Math.log(Math.tan(Math.PI/4+P2/2)/Math.tan(Math.PI/4+P1/2))
      const F = (Math.cos(P1)*Math.pow(Math.tan(Math.PI/4+P1/2),N))/N
      const rho0 = F/Math.pow(Math.tan(Math.PI/4+36*D/2),N)
      const p = 32.0 * D
      const rho = F/Math.pow(Math.tan(Math.PI/4+p/2),N)
      const th = N*(102.5*D - L0)
      const [x, y] = [rho*Math.sin(th), rho0 - rho*Math.cos(th)]
      const [px, py] = chart.convertToPixel({ geoIndex: 0 }, [x, y])
      const rect = document.querySelector('.map-panel .chart').getBoundingClientRect()
      return { x: rect.x + px, y: rect.y + py }
    })()`)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: posT.x,
      y: posT.y,
      button: 'left',
      clickCount: 1,
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: posT.x,
      y: posT.y,
      button: 'left',
      clickCount: 1,
    })
    await sleep(3000)
    const bcT = await cdp.evaluate(
      `document.querySelector('.breadcrumb button.province')?.textContent ?? ''`,
    )
    check('地形模式点击聚焦', bcT.includes('四川'), `面包屑: ${bcT.trim()}`)
    const provMapT = await cdp.evaluate(`window.__scenicChart.getOption().geo?.[1]?.map ?? ''`)
    check('地形模式聚焦后省图', provMapT === '510000', `map: ${provMapT}`)
    check(
      '重访省份保留之前缩放',
      await cdp.evaluate(`Math.abs(window.__scenicChart.getOption().geo[1].zoom - 2.2) < 0.001`),
    )
    await cdp.screenshot('05-terrain')
    // 返回全国
    await cdp.evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    await sleep(800)
    // 切回统计模式（后续断言不受影响）
    await cdp.evaluate(`document.querySelectorAll('.mode-toggle .mode-btn')[0]?.click()`)
    await sleep(1200)

    check(
      '统计模式无残留地形系列',
      await cdp.evaluate(
        `!window.__scenicChart.getOption().series.some(s => ['河流', '地理标注'].includes(s.name))`,
      ),
    )
    check(
      '统计模式清除地形区域配色',
      await cdp.evaluate(
        `window.__scenicChart.getOption().geo[0].regions.every(r => !r.itemStyle?.areaColor)`,
      ),
    )
    const geoRequestsBefore = await cdp.evaluate(
      `performance.getEntriesByType('resource').filter(r => r.name.includes('/geo/')).length`,
    )
    await cdp.evaluate(`window.__scenicChart.setOption({ geo: [{ zoom: 1.8 }] })`)
    const before = await cdp.evaluate(`document.documentElement.dataset.theme`)
    await cdp.evaluate(`document.querySelector('[title*=\"切换到\"]')?.click()`)
    await sleep(800)
    const after = await cdp.evaluate(`document.documentElement.dataset.theme`)
    check(
      '主题切换生效',
      before !== after && (after === 'dark' || after === 'light'),
      `${before} → ${after}`,
    )
    // 深色下金色散点仍应可见
    const goldDark = await cdp.evaluate(`(() => {
      let gold = 0
      for (const cv of document.querySelectorAll('.map-panel .chart canvas')) {
        const ctx = cv.getContext('2d')
        for (let y = 0; y < cv.height; y += 10) {
          for (let x = 0; x < cv.width; x += 10) {
            const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
            if (r > 200 && g > 120 && b < 160) gold++
          }
        }
      }
      return gold
    })()`)
    check('切换后地图重绘（散点可见）', goldDark >= 20, `金色采样点 ${goldDark}`)
    await cdp.screenshot('04-theme-toggled')
    // 切回原主题，避免影响后续断言
    await cdp.evaluate(`document.querySelector('[title*=\"切换到\"]')?.click()`)
    await sleep(500)

    /* --- 9. 4A 等级筛选开关 --- */
    await cdp.evaluate(`document.querySelectorAll('.level-filter .chip.l4')[0]?.click()`)
    await sleep(600)
    await cdp.evaluate(`document.querySelectorAll('.level-filter .chip.l4')[0]?.click()`)
    await sleep(600)
    check('等级筛选切换无异常', cdp.consoleErrors.length === 0)
    check(
      '筛选和主题切换保留缩放',
      await cdp.evaluate(`Math.abs(window.__scenicChart.getOption().geo[0].zoom - 1.8) < 0.001`),
    )
    const geoRequestsAfter = await cdp.evaluate(
      `performance.getEntriesByType('resource').filter(r => r.name.includes('/geo/')).length`,
    )
    check('筛选和主题切换复用地图缓存', geoRequestsAfter === geoRequestsBefore)

    // 筛选恢复、未知年份、分类切换和搜索定位。
    await cdp.evaluate(`document.querySelector('.reset-filters').click()`)
    await sleep(650)
    await cdp.evaluate(`document.querySelector('.level-filter .l4').click()`)
    await sleep(650)
    const allCount = await cdp.evaluate(`Number(document.querySelector('.kpi-value').textContent)`)
    await cdp.evaluate(`document.querySelector('.filter-help input').click()`)
    await sleep(650)
    check(
      '排除未知年份减少展示数量',
      (await cdp.evaluate(`Number(document.querySelector('.kpi-value').textContent)`)) < allCount,
    )
    await cdp.evaluate(`document.querySelector('.reset-filters').click()`)
    await sleep(650)
    const categoryCounts = await cdp.evaluate(
      `Array.from(document.querySelectorAll('.bar-row[aria-pressed] .bar-value')).map(e => e.textContent).join(',')`,
    )
    await cdp.evaluate(`document.querySelector('.bar-row[aria-pressed]').click()`)
    await sleep(650)
    check(
      '选中类别后仍可比较其他类别',
      categoryCounts ===
        (await cdp.evaluate(
          `Array.from(document.querySelectorAll('.bar-row[aria-pressed] .bar-value')).map(e => e.textContent).join(',')`,
        )),
    )
    await cdp.evaluate(`document.querySelector('.level-filter .l5').click()`)
    await sleep(650)
    check(
      '空筛选显示恢复入口',
      await cdp.evaluate(`Boolean(document.querySelector('.card.empty button'))`),
    )
    await cdp.evaluate(`(() => {
      const input = document.querySelector('.search input')
      input.value = '故宫'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
    })()`)
    await sleep(400)
    await cdp.evaluate(`document.querySelector('.search-results button').click()`)
    await sleep(700)
    check(
      '搜索自动恢复目标等级并定位地图',
      await cdp.evaluate(
        `window.__scenicChart.getOption().series.some(s => s.name === '5A景区' && s.data.some(d => d.spot.name.includes('故宫')))`,
      ),
    )
    check(
      '详情打开后焦点进入抽屉且背景不可操作',
      await cdp.evaluate(
        `document.querySelector('.drawer').contains(document.activeElement) && document.querySelector('.app').inert && document.body.style.overflow === 'hidden'`,
      ),
    )
    await cdp.evaluate(`document.querySelector('.drawer .close-btn').focus()`)
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      modifiers: 8,
    })
    check(
      'Shift Tab 焦点不逃出详情',
      await cdp.evaluate(`document.querySelector('.drawer').contains(document.activeElement)`),
    )
    await cdp.evaluate(`document.querySelector('.drawer .close-btn').click()`)
    await sleep(350)
    check(
      '关闭详情解除背景锁定',
      await cdp.evaluate(
        `!document.querySelector('.app').inert && document.body.style.overflow !== 'hidden'`,
      ),
    )
    await cdp.evaluate(
      `document.querySelector('.breadcrumb button').click(); document.querySelector('.reset-filters').click()`,
    )
    await sleep(650)
    await cdp.evaluate(
      `window.__scenicChart.setOption({geo: [{zoom: 3}]}); document.querySelector('.reset-view').click()`,
    )
    await sleep(650)
    check(
      '恢复视角重置缩放',
      await cdp.evaluate(`window.__scenicChart.getOption().geo[0].zoom < 1.5`),
    )

    for (const width of [390, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      })
      await sleep(800)
      check(
        `手机 ${width}px 无横向溢出且操作按钮不重叠`,
        await cdp.evaluate(`(() => {
        const [a, b] = [...document.querySelectorAll('.quick-actions button')].map(e => e.getBoundingClientRect())
        const map = document.querySelector('.chart').getBoundingClientRect()
        return document.documentElement.scrollWidth <= innerWidth && a.right <= b.left && map.height >= 300 && map.width > 200
      })()`),
      )
      await cdp.screenshot('mobile-' + width)
      await cdp.evaluate(`document.querySelector('[title="随机探索一家 5A 景区"]').click()`)
      await sleep(650)
      check(
        `手机 ${width}px 详情底部展开且不越界`,
        await cdp.evaluate(`(() => {
        const rect = document.querySelector('.drawer').getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth + 1 && Math.abs(rect.bottom - innerHeight) < 2 && rect.height <= innerHeight * 0.91
      })()`),
      )
      if (width === 390) await cdp.screenshot('mobile-detail')
      await cdp.evaluate(`document.querySelector('.drawer .close-btn').click()`)
      await sleep(300)
      await cdp.evaluate(`document.querySelector('.breadcrumb button').click()`)
      await sleep(350)
    }

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await cdp.evaluate(`document.querySelector('.reset-view').click()`)
    await sleep(200)
    check(
      '减少动态效果关闭图表与切换动画',
      await cdp.evaluate(
        `!window.__scenicChart.getOption().animation && document.querySelector('.transition-layer').getAnimations().length === 0`,
      ),
    )
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    for (let i = 0; i < 4; i++) {
      await cdp.evaluate(`document.querySelectorAll('.stats-panel .bar-row')[${i}].click()`)
      await sleep(30)
    }
    await cdp.evaluate(`document.querySelector('.breadcrumb button').click()`)
    await sleep(700)
    check(
      '快速切换后只保留最终全国视图',
      await cdp.evaluate(
        `window.__scenicChart.getOption().geo.length === 1 && window.__scenicChart.getOption().geo[0].map === 'cn' && document.querySelector('.transition-layer').getAnimations().length === 0`,
      ),
    )

    // 探索工具：快捷切换、打卡筛选及真实 CSV 下载。
    await cdp.evaluate(`document.querySelector('.reset-filters').click()`)
    await cdp.evaluate(`(() => {
      const select = document.querySelector('[aria-label="快速切换区域"]')
      select.value = '北京'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(700)
    check(
      '区域选择器定位北京',
      await cdp.evaluate(`window.__scenicChart.getOption().geo[1].map === '110000'`),
    )
    await cdp.evaluate(`document.querySelector('.spot-row').click()`)
    await sleep(400)
    const selectedName = await cdp.evaluate(
      `document.querySelector('.drawer .spot-name').textContent`,
    )
    const wasVisited = await cdp.evaluate(
      `document.querySelector('.visit-btn').classList.contains('been')`,
    )
    if (!wasVisited) await cdp.evaluate(`document.querySelector('.visit-btn').click()`)
    await cdp.evaluate(`document.querySelector('.drawer .close-btn').click()`)
    await sleep(300)
    await cdp.evaluate(`(() => {
      const select = document.querySelector('[aria-label="打卡状态筛选"]')
      select.value = 'visited'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(650)
    check(
      '只看已打卡与地图一致',
      await cdp.evaluate(`(() => {
      const names = new Set(JSON.parse(localStorage.getItem('scenic-visited') || '[]'))
      const data = window.__scenicChart.getOption().series.filter(s => ['5A景区','4A景区'].includes(s.name)).flatMap(s => s.data)
      return data.length > 0 && data.every(d => names.has(d.spot.name))
    })()`),
    )
    const downloadDir = join(OUT, 'downloads-' + Date.now())
    await mkdir(downloadDir, { recursive: true })
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir })
    await cdp.evaluate(`document.querySelector('.export-list').click()`)
    const csvPath = join(
      downloadDir,
      '景区清单-北京-' + new Date().toISOString().slice(0, 10) + '.csv',
    )
    let downloaded = ''
    for (let i = 0; i < 30 && !downloaded; i++) {
      downloaded = await readFile(csvPath, 'utf8').catch(() => '')
      if (!downloaded) await sleep(100)
    }
    check(
      '导出实际生成含当前景区的 CSV 文件',
      downloaded.startsWith('\uFEFF') &&
        downloaded.includes(selectedName) &&
        downloaded.includes('"是"'),
    )
    if (!wasVisited) {
      await cdp.evaluate(`document.querySelector('.spot-row').click()`)
      await sleep(300)
      await cdp.evaluate(
        `document.querySelector('.visit-btn').click(); document.querySelector('.drawer .close-btn').click()`,
      )
      await sleep(300)
    }
    await cdp.evaluate(
      `document.querySelector('.reset-filters').click(); document.querySelector('.breadcrumb button').click(); document.activeElement.blur()`,
    )
    await sleep(400)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash' })
    check(
      '斜杠快捷键聚焦搜索',
      await cdp.evaluate(`document.activeElement === document.querySelector('.search input')`),
    )

    // 模拟数据请求失败，检查显式重试能恢复。
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.setBlockedURLs', { urls: ['*spots-4a.json*'] })
    await cdp.send('Page.reload', { ignoreCache: true })
    await cdp.waitFor('Page.loadEventFired')
    await sleep(700)
    await cdp.evaluate(`document.querySelector('.level-filter .l4').click()`)
    await sleep(650)
    check(
      '4A 请求失败可见且可重试',
      await cdp.evaluate(
        `Array.from(document.querySelectorAll('.toolbar button')).some(b => b.textContent.includes('加载失败'))`,
      ),
    )
    await cdp.send('Network.setBlockedURLs', { urls: [] })
    await cdp.evaluate(
      `Array.from(document.querySelectorAll('.toolbar button')).find(b => b.textContent.includes('加载失败')).click()`,
    )
    await sleep(900)
    check(
      '4A 重试成功恢复数据',
      await cdp.evaluate(
        `Number(document.querySelector('.kpi.cyan .kpi-value').textContent) > 900`,
      ),
    )
    check('完整流程无 JS 异常', cdp.consoleErrors.length === 0, cdp.consoleErrors.join('; '))

    console.log(failures === 0 ? '\n全部通过 ✅' : `\n存在失败项 ❌ (${failures} 个)`)
  } finally {
    chrome.kill('SIGKILL')
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
