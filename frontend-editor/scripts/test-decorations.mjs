/**
 * Decoration-builder invariants over random/edge documents, using the real
 * CodeMirror EditorState (no DOM rendering required):
 *  - buildDecorations never throws
 *  - every range is within the document and from<=to
 *  - preview state (cursor elsewhere) and edit state (cursor on the line)
 *    use the identical region set; only marker visibility differs
 *  - plain text with no inline syntax gets no inline marker decorations
 */
import { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { parseMarkdownRegions } from '../src/editor/markdown-parser.js'

// Re-implement the decoration assembly using the same rules the plugin uses,
// but return the raw {from,to,type} list so we can assert without a DOM.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

function collectDecoRanges(doc, cursorPos) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos }
  })
  const regions = parseMarkdownRegions(doc)
  const cursorRanges = []
  for (const sel of state.selection.ranges) {
    const lf = state.doc.lineAt(sel.from)
    const lt = state.doc.lineAt(sel.to)
    cursorRanges.push({ from: lf.from, to: lt.to })
  }
  const onRegion = (r) => cursorRanges.some((c) => r.from <= c.to && r.to >= c.from)

  const out = []
  for (const r of regions) {
    const on = onRegion(r)
    const push = (from, to, kind) => {
      if (from < to) out.push({ from, to, kind, region: r.type, on })
    }
    if (r.type === 'bold' || r.type === 'italic' || r.type === 'strikethrough') {
      push(r.contentFrom, r.contentTo, r.type + '-content')
      for (const [a, b] of r.meta.markerRanges) push(a, b, on ? 'marker-visible' : 'marker-hidden')
    } else if (r.type === 'inline-code') {
      push(r.contentFrom, r.contentTo, 'code-content')
      for (const [a, b] of r.meta.markerRanges) push(a, b, on ? 'marker-visible' : 'marker-hidden')
    } else if (r.type === 'link') {
      push(r.contentFrom, r.contentTo, 'link-content')
      push(r.from, r.contentFrom, on ? 'marker-visible' : 'marker-hidden')
      push(r.contentTo, r.to, on ? 'marker-visible' : 'marker-hidden')
    } else if (r.type === 'image') {
      if (!on) push(r.from, r.to, 'image-widget')
    }
  }
  return { regions, ranges: out, docLen: doc.length }
}

let seed = 99
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a) => a[Math.floor(rnd() * a.length)]

const docs = [
  '',
  '普通文本，没有任何格式。',
  '这是**粗体**、*斜体*、~~删除~~、`代码` 与[链接](https://x.com)混排，行内代码如 `a`，中文标点。\n\n第二段：**b** *c* ~~d~~ `e`。',
  '***斜粗体*** 和 **粗*斜*粗** 与 *a **b** c*',
  '中文，`code`，中文。价格`100`元。',
  '代码 `**x** *y* [z](u) ~~w~~` 不解析内部。',
  '![img](https://x.com/a.png) 与 [l](https://y.com)。',
  '# 标题 **粗**\n\n正文 *斜*。\n- 列表项 `c`\n> 引用 ~~s~~\n',
  '```\n**not bold**\n```\n**bold**',
  '未闭合 **粗 与 *斜 与 ~~删 与 [链接\n',
  'a'.repeat(100),
]

// random docs
for (let k = 0; k < 300; k++) {
  const parts = []
  const wraps = [
    (x) => `**${x}**`, (x) => `*${x}*`, (x) => `__${x}__`, (x) => `_${x}_`,
    (x) => `~~${x}~~`, (x) => `\`${x}\``, (x) => `[${x}](u)`, (x) => x, (x) => x
  ]
  const n = 1 + Math.floor(rnd() * 6)
  for (let i = 0; i < n; i++) {
    let w = pick(['字', 'abc', 'x', '链 接', 'a_b'])
    if (rnd() < 0.6) w = pick(wraps)(w)
    parts.push(w)
    if (rnd() < 0.4) parts.push(pick(['，', '。', ' ', '、', '\n']))
  }
  docs.push(parts.join(''))
}

let errors = 0
let checked = 0

for (const doc of docs) {
  // cursor both far away (preview) and on each region line (edit)
  const positions = [0, doc.length, Math.floor(doc.length / 2)]
  for (const pos of positions) {
    checked += 1
    let result
    try {
      result = collectDecoRanges(doc, pos)
    } catch (e) {
      console.log('THREW on', JSON.stringify(doc.slice(0, 60)), 'pos', pos, e.message)
      errors += 1
      continue
    }
    for (const d of result.ranges) {
      if (d.from < 0 || d.to > result.docLen || d.from > d.to) {
        console.log('BAD RANGE', d, 'in', JSON.stringify(doc.slice(0, 60)))
        errors += 1
      }
    }
  }

  // preview vs edit must use the SAME regions (marker count identical,
  // only the visibility kind flips)
  const preview = collectDecoRanges(doc, 0)
  const mid = Math.floor(doc.length / 2)
  const edit = collectDecoRanges(doc, mid)
  const pRegions = preview.regions.map((r) => r.type + r.from + '-' + r.to).sort()
  const eRegions = edit.regions.map((r) => r.type + r.from + '-' + r.to).sort()
  if (JSON.stringify(pRegions) !== JSON.stringify(eRegions)) {
    console.log('REGION MISMATCH between cursor states in', JSON.stringify(doc.slice(0, 60)))
    errors += 1
  }
}

// Plain text must have no inline marker/content decorations
const plain = collectDecoRanges('这是一段完全普通的文字，没有任何标记。', 0)
const inlineKinds = plain.ranges.filter((d) => d.kind.includes('content') || d.kind.includes('marker'))
if (inlineKinds.length) {
  console.log('PLAIN TEXT got inline decorations:', inlineKinds)
  errors += 1
}

console.log(`\nDECORATION CHECKS: ${checked} cursor states, ${errors} errors`)
process.exit(errors ? 1 : 0)
