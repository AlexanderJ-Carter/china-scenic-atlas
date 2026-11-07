import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadModule(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { searchSpots, normalizeQuery } = await loadModule('search')
const { buildSpotsCsv } = await loadModule('exportCsv')
const spot = (name, extra = {}) => ({
  name,
  level: '5A',
  province: '北京',
  city: '北京',
  year: null,
  category: '',
  ...extra,
})

test('搜索名称精确命中优先于前缀、包含和简介', () => {
  const rows = [spot('其他', { desc: '故宫' }), spot('沈阳故宫'), spot('故宫博物院'), spot('故宫')]
  assert.deepEqual(
    searchSpots(rows, '故宫').map((s) => s.name),
    ['故宫', '故宫博物院', '沈阳故宫', '其他'],
  )
})
test('搜索统一全半角和空格，空查询不返回结果', () => {
  assert.equal(normalizeQuery(' ＡＢＣ  '), 'abc')
  assert.equal(searchSpots([spot('故宫博物院')], ' 故宫 博物院 ').length, 1)
  assert.deepEqual(searchSpots([spot('故宫')], '  '), [])
  assert.equal(searchSpots([spot('故宫'), spot('故宫博物院')], '故宫', 1).length, 1)
})
test('CSV 保留中文、未知值和打卡状态，并转义逗号、双引号及换行', () => {
  const csv = buildSpotsCsv([spot('景区,"甲"\n乙')], new Set(['景区,"甲"\n乙']))
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"景区,""甲""\n乙"'))
  assert.ok(csv.includes('"未知","未分类","是"'))
})
test('CSV 不将不可信文本当作公式，空清单仍保留表头', () => {
  for (const name of ['=SUM(1,2)', '+1', '-1', '@cmd', '  =1', '\t=1']) {
    assert.ok(buildSpotsCsv([spot(name)], new Set()).includes('"\'' + name))
  }
  assert.equal(buildSpotsCsv([], new Set()).split('\r\n').length, 1)
})

const { parse4ASpots } = await loadModule('parseSpots')
test('4A 解析兼容未知类别，拒绝损坏字段与重复条目', () => {
  const row = spot('测试', { level: '4A', category: null, lng: 116, lat: 39, official: true })
  assert.equal(parse4ASpots([row])[0].category, '')
  for (const invalid of [
    null,
    {},
    [],
    [row, row],
    [{ ...row, lng: Infinity }],
    [{ ...row, city: {} }],
    [{ ...row, year: '2024' }],
  ]) {
    assert.throws(() => parse4ASpots(invalid))
  }
})
test('仓库全部 4A 条目满足运行时契约', async () => {
  const rows = JSON.parse(
    await readFile(new URL('../public/data/spots-4a.json', import.meta.url), 'utf8'),
  )
  assert.equal(parse4ASpots(rows).length, rows.length)
})
