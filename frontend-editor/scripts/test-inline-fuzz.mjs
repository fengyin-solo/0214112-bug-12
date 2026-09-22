/**
 * Fuzz + block-level parity: random inline mixtures and multi-line docs
 * must agree with markdown-it on per-visible-character styling and must
 * never produce invalid region ranges.
 */
import MarkdownIt from 'markdown-it'
import { createRequire } from 'module'
import { parseMarkdownRegions } from '../src/editor/markdown-parser.js'

// Enable markdown-it's GFM strikethrough so `~~` is parsed like our editor
const require = createRequire(import.meta.url)
const strikeRule = require('markdown-it/lib/rules_inline/strikethrough.mjs').default
const md = new MarkdownIt().use(function plugin(md2) {
  md2.inline.ruler.before('emphasis', 'strikethrough', strikeRule.tokenize)
  md2.inline.ruler2.before('emphasis', 'strikethrough', strikeRule.postProcess)
})

const STYLE_OF = { bold: 'B', italic: 'I', strikethrough: 'S', 'inline-code': 'C', link: 'L' }

function regionLineCoverage(text) {
  const regions = parseMarkdownRegions(text)
  const out = []
  for (let p = 0; p < text.length; p++) out.push({ ch: text[p], styles: new Set(), hidden: false, img: false })
  for (const r of regions) {
    // guard: all regions within line and well-formed
    if (r.from < 0 || r.to > text.length || r.from >= r.to) throw new Error('bad range ' + r.type)
    if (r.contentFrom < r.from || r.contentTo > r.to || r.contentFrom > r.contentTo) throw new Error('bad content range')
    if (r.type === 'image') { for (let p = r.from; p < r.to; p++) out[p].img = true; continue }
    const style = STYLE_OF[r.type]
    if (!style) continue
    if (r.type === 'inline-code') {
      for (const [a, b] of r.meta.markerRanges) for (let p = a; p < b; p++) out[p].hidden = true
      for (let p = r.contentFrom; p < r.contentTo; p++) out[p].styles.add(style)
    } else if (r.type === 'link') {
      for (let p = r.from; p < r.contentFrom; p++) out[p].hidden = true
      for (let p = r.contentTo; p < r.to; p++) out[p].hidden = true
      for (let p = r.contentFrom; p < r.contentTo; p++) out[p].styles.add(style)
    } else {
      for (const [a, b] of r.meta.markerRanges) for (let p = a; p < b; p++) out[p].hidden = true
      for (let p = r.contentFrom; p < r.contentTo; p++) if (!out[p].hidden) out[p].styles.add(style)
    }
  }
  for (let p = 0; p < text.length - 1; p++) {
    if (text[p] === '\\' && '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.includes(text[p + 1])) { out[p].hidden = true; p += 1 }
  }
  return out
}

const TAG = { strong: 'B', em: 'I', s: 'S', code: 'C', a: 'L' }
function refCoverage(text) {
  const html = md.renderInline(text)
  const out = []
  const stack = []
  let i = 0
  const ent = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
  while (i < html.length) {
    if (html[i] === '<') {
      const e = html.indexOf('>', i)
      const tag = html.slice(i + 1, e)
      i = e + 1
      const name = tag.replace(/^\/+/, '').split(/\s/)[0]
      if (TAG[name]) {
        if (tag.startsWith('/')) stack.splice(stack.lastIndexOf(TAG[name]), 1)
        else stack.push(TAG[name])
      }
      if (name === 'img') {
        if (!tag.endsWith('/')) i = html.indexOf('>', html.indexOf('</img', i)) + 1
      }
    } else {
      let ch = html[i], len = 1
      for (const [k, v] of Object.entries(ent)) if (html.startsWith(k, i)) { ch = v; len = k.length; break }
      out.push({ ch, styles: new Set(stack) })
      i += len
    }
  }
  return out
}

const key = (s) => [...s].sort().join('')

// Deterministic pseudo-random generator
let seed = 1234567
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)] }

const atoms = ['a', 'b', '中', '文', ' ', '，', '。', 'x', '_', '*', '~', '`', '[', ']', '(', ')', '/', '1', '2']
void atoms
const words = ['粗', '斜', 'abc', '链接', 'code', 'x y', 'foo_bar', '删除']

function randomLine() {
  let s = ''
  const wraps = [
    (x) => `**${x}**`, (x) => `*${x}*`, (x) => `__${x}__`, (x) => `_${x}_`,
    (x) => `~~${x}~~`, (x) => `\`${x}\``, (x) => `[${x}](u)`,
    (x) => x, (x) => x, (x) => x
  ]
  const n = 1 + Math.floor(rnd() * 4)
  for (let i = 0; i < n; i++) {
    let part = pick(words)
    if (rnd() < 0.5) part = pick(wraps)(part)
    s += part
    if (rnd() < 0.4) s += pick(['，', '。', ' ', '、'])
  }
  // occasional dangling markers (single, balanced enough not to blow the
  // reference parser)
  if (rnd() < 0.3) s += pick(['*', '**', '~~', '`', '_'])
  return s
}

let fails = 0
let total = 0
function checkLine(text) {
  total += 1
  const ref = refCoverage(text).map((c) => c.ch + ':' + key(c.styles))
  const mine = regionLineCoverage(text).filter((c) => !c.hidden && !c.img).map((c) => c.ch + ':' + key(c.styles))
  if (ref.join('|') !== mine.join('|')) {
    fails += 1
    if (fails <= 10) {
      console.log('FAIL', JSON.stringify(text))
      console.log('  ref :', ref.join(' '))
      console.log('  mine:', mine.join(' '))
    }
  }
}

// fixed tricky pool
const fixed = [
  '**粗体**', '*斜体*', '~~删~~', '`c`', '[a](u)',
  '**a** *b* ~~c~~ `d` [e](f)',
  '中文，**粗**。*斜*！',
  '**x*y**', '*x**y*', '***z***',
  'a_b_c', '中_文_字',
  '~~a~~b~~c~~',
  '`**x**` `*y*` `[z](w)`',
  '**[a](u)**', '*[b](v)*',
  '嵌套 **粗 *斜* 粗** 结束',
]
for (const t of fixed) checkLine(t)

// random fuzz
for (let i = 0; i < 4000; i++) checkLine(randomLine())

// multi-line document sanity: region offsets must map back correctly
const doc = '# 标题 **粗**\n\n正文 *斜* 与 `code`，[链接](u)。\n- 列表 **粗**\n> 引用 ~~删~~\n\n```\n**not**\n```\n'
const regions = parseMarkdownRegions(doc)
for (const r of regions) {
  if (r.from < 0 || r.to > doc.length || r.from > r.to) throw new Error('doc range error')
  if (r.contentFrom < r.from || r.contentTo > r.to) throw new Error('doc content range error')
}

console.log(`\nFUZZ ${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
