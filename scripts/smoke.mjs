/**
 * 冒烟测试：通过 MCP stdio client 驱动 server，
 * 加载 examples/nomad.wire.json → 导出 SVG → 现场增量绘制 → 再导出。
 * 全程无浏览器，验证 MCP→spec→SVG 链路。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const transport = new StdioClientTransport({
  command: path.join(root, 'node_modules', '.bin', 'tsx'),
  args: [path.join(root, 'server', 'mcp.ts')],
  cwd: root,
})

const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(transport)

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args })
  const text = res.content?.map((c) => c.text ?? '').join('\n') ?? ''
  console.log(`-- ${name}: ${text}`)
  return text
}

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

// 1. 加载参考线稿
await call('wf_load', { path: path.join(root, 'examples', 'nomad.wire.json') })
const listing = await call('wf_list')
if (!listing.includes('屏')) fail('wf_list 未返回屏幕概览')

// 2. 无头导出 SVG
const svgPath = path.join(root, 'exports', 'nomad.svg')
await call('wf_export_svg', { path: svgPath })
const svg = fs.readFileSync(svgPath, 'utf8')
for (const needle of ['鼓浪屿', '厦门', '日光岩', '9:41', 'marker-end']) {
  if (!svg.includes(needle)) fail(`SVG 缺少关键词 ${needle}`)
}
console.log(`PASS: SVG 导出成功（${svg.length} 字节），关键词齐全 → ${svgPath}`)

// 3. MCP 现场增量绘制 + 连线（证明动态作画，不只是加载文件）
await call('wf_draw', {
  items: [
    { id: 's8', kind: 'screen', x: 1500, y: 60, w: 320, h: 640, label: '新增·行程编辑（冒烟）' },
    { id: 's8-nav', kind: 'navbar', x: 1524, y: 92, w: 272, h: 40, label: '行程编辑', screen: 's8' },
    { id: 's8-input', kind: 'input', x: 1524, y: 160, w: 272, h: 40, label: '添加地点或粘贴链接', screen: 's8' },
    { id: 's8-btn', kind: 'button', x: 1524, y: 620, w: 272, h: 44, label: '保存行程', screen: 's8' },
  ],
})
await call('wf_connect', { from: 's4-search', to: 's8-input', label: '粘贴导入' })
const svg2Path = path.join(root, 'exports', 'nomad-v2.svg')
await call('wf_export_svg', { path: svg2Path })
const svg2 = fs.readFileSync(svg2Path, 'utf8')
if (!svg2.includes('保存行程') || !svg2.includes('新增·行程编辑')) fail('增量绘制未生效')
console.log(`PASS: 增量绘制 + 连线生效 → ${svg2Path}`)

// 4. 持久化往返
await call('wf_save', { path: path.join(root, 'exports', 'nomad-v2.wire.json') })
const saved = JSON.parse(fs.readFileSync(path.join(root, 'exports', 'nomad-v2.wire.json'), 'utf8'))
if (saved.version !== 1 || !Array.isArray(saved.items)) fail('保存的 JSON 不合法')
console.log('PASS: spec 持久化往返成功')

await client.close()
console.log('\nSMOKE OK — MCP→spec→SVG 全链路通过')
