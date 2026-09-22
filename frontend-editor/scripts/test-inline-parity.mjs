/**
 * Visual parity test: for every visible character of the source, the set of
 * active inline styles (bold/italic/strike/code/link) implied by our regions
 * must match what markdown-it renders. Marker characters hidden in preview
 * mode (`**`, `*`, `~~`, backticks, link syntax, escaping backslashes) are
 * excluded from the visible sequence on both sides.
 */
import MarkdownIt from 'markdown-it'
import { parseMarkdownRegions } from '../src/editor/markdown-parser.js'

const md = new MarkdownIt()

const TAG_STYLE = { strong: 'B', em: 'I', s: 'S', code: 'C', a: 'L' }

/** Walk markdown-it inline HTML -> one entry per visible source char */
function referenceCoverage(text) {
  const html = md.renderInline(text)
  const out = []
  const stack = []
  let i = 0
  const pushText = (s) => {
    for (const ch of s) out.push({ ch, styles: new Set(stack) })
  }
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      const tag = html.slice(i + 1, end)
      i = end + 1
      const selfClose = tag.endsWith('/')
      const name = tag.replace(/^\/+/, '').split(/\s/)[0]
      if (TAG_STYLE[name]) {
        if (tag.startsWith('/')) stack.splice(stack.lastIndexOf(TAG_STYLE[name]), 1)
        else stack.push(TAG_STYLE[name])
      }
      if (name === 'img' && !selfClose) {
        const closeEnd = html.indexOf('>', html.indexOf('</img', i))
        i = closeEnd + 1
      }
    } else {
      let ch = html[i]
      let len = 1
      for (const [ent, decoded] of Object.entries(entities)) {
        if (html.startsWith(ent, i)) { ch = decoded; len = ent.length; break }
      }
      pushText(ch)
      i += len
    }
  }
  return out
}

const STYLE_OF = {
  bold: 'B',
  italic: 'I',
  strikethrough: 'S',
  'inline-code': 'C',
  link: 'L'
}

/** Coverage from our regions: one entry per source character */
function regionCoverage(text) {
  const regions = parseMarkdownRegions(text)
  const out = []
  for (let p = 0; p < text.length; p++) out.push({ ch: text[p], styles: new Set(), hidden: false, img: false })

  for (const r of regions) {
    if (r.type === 'image') {
      for (let p = r.from; p < r.to; p++) out[p].img = true
      continue
    }
    const style = STYLE_OF[r.type]
    if (!style) continue
    if (r.type === 'inline-code') {
      for (const [a, b] of r.meta.markerRanges)
        for (let p = a; p < b; p++) out[p].hidden = true
      for (let p = r.contentFrom; p < r.contentTo; p++) out[p].styles.add(style)
      continue
    }
    if (r.type === 'link') {
      for (let p = r.from; p < r.contentFrom; p++) out[p].hidden = true
      for (let p = r.contentTo; p < r.to; p++) out[p].hidden = true
      for (let p = r.contentFrom; p < r.contentTo; p++) out[p].styles.add(style)
      continue
    }
    for (const [a, b] of r.meta.markerRanges)
      for (let p = a; p < b; p++) out[p].hidden = true
    for (let p = r.contentFrom; p < r.contentTo; p++) {
      if (!out[p].hidden) out[p].styles.add(style)
    }
  }

  // Backslash escapes: backslash itself is hidden, following char literal
  for (let p = 0; p < text.length - 1; p++) {
    if (text[p] === '\\' && '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.includes(text[p + 1])) {
      out[p].hidden = true
      p += 1
    }
  }
  return out
}

const key = (s) => [...s].sort().join('')

const cases = [
  '这是**粗体**、*斜体*、~~删除~~与[链接](https://x.com)混排',
  '行内代码紧邻中文标点：`code`，以及`code`。还有`code`：结束',
  '中文，`code`，中文',
  '**粗体[链接](https://x.com)粗体**',
  '***斜粗体***',
  '[**粗体链接**](https://x.com)',
  'a `x = 1` 和 `y = 2`。',
  '**粗体**与*斜体*和~~删除~~',
  '价格是`100`元，重量`2`kg。',
  '链接[Google](https://google.com)紧接**粗体**',
  '未闭合的**粗体与*斜体*混排',
  '*a **b** c*',
  '代码里有星号 `**not bold**` 的行',
  'foo_bar_baz 普通文本',
  '中文_斜体_中文',
  '中文__粗__中文',
  '代码里藏图片 `![a](u)`',
  '代码里藏链接 `[a](u)`',
  '`a`**b**`c`',
  '链接含括号 [wiki](https://en.wikipedia.org/wiki/Foo_(bar))',
  '带标题 [t](https://x.com "标题")',
  '* 列表项里 **粗** 与 *斜*',
  '~~a~~**b~~c**',
  '*斜1* 与 *斜2* 与 *斜3*',
  '双反引号 ``a ` b`` 结束',
  '**粗*斜粗*粗**',
  '*[a](u)*',
  '前~~删除~~后',
  '~单波浪~',
  '**粗*',
  '*斜**粗**x*',
  'a***b***c',
  '*a**b**c*',
  '**a*b*c**',
  '***',
  '**',
  '*',
  '`',
  '`` ` ``',
  '* a * b * c *',
  'a* b*',
  '*b *c',
  '*b * c*',
  '1*2*3',
  '1**2**3',
  'foo___bar___baz',
  '___x___',
  '__粗 *斜* 粗__',
  '**粗 __粗__ 粗**',
  '~~删除 [链接](u) ~~',
  '~~a **b** c~~',
  '> **引用粗体** 与 *斜*',
  '**[a](u)** 与 ~~[c](w)~~',
  '中文~~删除~~中文',
  'a`b`c`d`e',
  '\\*not italic\\* \\**not bold\\**',
  '**未闭合粗体',
  '*未闭合斜体',
  '~~未闭合删除',
  '*x_ y*',
  '*****',
  '******',
  '** *x* **',
  '(*x*)',
  '（*中文斜体*）',
  '中文**粗体**中文',
  'a~~b~~c',
  '~~a~b~~',
  '` 空格padding `',
  'a ` b ` c',
  'a `` ` `` b',
  'a *b* c',
  'a _b_ c',
  '*b*',
  '_b_',
  'a** b **c',
  'a**b **c',
  '\\`not code\\`',
  '[a `b` c](u)',
]

let passed = 0
const failures = []

for (const text of cases) {
  const ref = referenceCoverage(text).map((c) => ({ ch: c.ch, styles: key(c.styles) }))
  const mine = regionCoverage(text)
    .filter((c) => !c.hidden && !c.img)
    .map((c) => ({ ch: c.ch, styles: key(c.styles) }))

  if (ref.length !== mine.length) {
    failures.push({ text, why: `length ref=${ref.length} mine=${mine.length}`, ref, mine })
    continue
  }
  let ok = true
  for (let k2 = 0; k2 < ref.length; k2++) {
    if (ref[k2].ch !== mine[k2].ch || ref[k2].styles !== mine[k2].styles) {
      ok = false
      failures.push({ text, why: `at ${k2}`, refAt: ref[k2], mineAt: mine[k2], refSeq: ref, mineSeq: mine })
      break
    }
  }
  if (ok) passed += 1
}

console.log(`PASS ${passed}/${cases.length}`)
for (const f of failures.slice(0, 12)) {
  console.log('\nFAIL', JSON.stringify(f.text), '-', f.why)
  if (f.refAt) console.log('  ref :', JSON.stringify(f.refAt))
  if (f.mineAt) console.log('  mine:', JSON.stringify(f.mineAt))
  if (f.refSeq) console.log('  ref seq :', f.refSeq.map((c) => `${c.ch}:${c.styles}`).join(' '))
  if (f.mineSeq) console.log('  mine seq:', f.mineSeq.map((c) => `${c.ch}:${c.styles}`).join(' '))
}
process.exit(failures.length ? 1 : 0)
