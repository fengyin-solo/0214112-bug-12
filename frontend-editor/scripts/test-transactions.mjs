/**
 * Drive buildDecorationsForView through realistic transaction sequences
 * (fast character-by-character typing, mid-marker edits, undo-like
 * reversal, reload from saved text, unknown/pathological combinations)
 * without a DOM. After each transaction the decoration set must rebuild
 * without throwing and all ranges stay within the document.
 */
import { EditorState } from '@codemirror/state'
import { history, historyKeymap } from '@codemirror/commands'
import { keymap } from '@codemirror/view'
import { buildDecorationsForView } from '../src/editor/decoration-plugin.js'

function build(state) {
  return buildDecorationsForView({ state })
}
function count(set, len) {
  let n = 0
  set.between(0, len, (from, to) => {
    if (from < 0 || to > len || from > to) throw new Error(`bad range ${from}-${to} (len ${len})`)
    n += 1
  })
  return n
}
function makeState(doc, anchor) {
  return EditorState.create({
    doc,
    selection: anchor === undefined ? undefined : { anchor },
    extensions: [history(), keymap.of(historyKeymap)]
  })
}

let failures = 0
const ok = (c, m) => { if (!c) { failures += 1; console.log('FAIL:', m) } }

// 1. Fast character-by-character typing of a mixed line
let state = makeState('')
let text = ''
const sequence = '这是**粗体**，*斜体*、~~删除~~、`代码`与[链接](https://x.com)，结尾'
for (const ch of sequence) {
  text += ch
  state = state.update({
    changes: { from: state.doc.length, insert: ch },
    selection: { anchor: state.doc.length + 1 }
  }).state
  try {
    const n = count(build(state), text.length)
    ok(n >= 0, `ranges in bounds mid-typing at "${text.slice(-6)}"`)
  } catch (e) {
    ok(false, `build threw mid-typing at "${text.slice(-6)}": ${e.message}`)
  }
}
ok(state.doc.toString() === sequence, 'final text matches')
const finalCount = count(build(state), text.length)
ok(finalCount >= 10, `final doc renders many inline ranges (got ${finalCount})`)

// 2. Typing inside/around markers must never throw or exceed bounds
for (const pos of [0, 2, 3, 4, text.indexOf('粗'), text.indexOf('代码')]) {
  if (pos < 0 || pos > text.length) continue
  const s2 = state.update({
    changes: { from: pos, insert: '*' },
    selection: { anchor: pos + 1 }
  }).state
  count(build(s2), s2.doc.length)
}

// 3. Undo-like reversal: tracked append then revert -> same decorations
const before = text
let s = state.update({ changes: { from: before.length, insert: '**x**' } }).state
ok(s.doc.toString() === before + '**x**', 'tracked append applied')
count(build(s), s.doc.length)
s = s.update({ changes: { from: before.length, to: before.length + 5, insert: '' } }).state
ok(s.doc.toString() === before, 'reverted')
const revertedCount = count(build(s), s.doc.length)
ok(revertedCount === finalCount, `decorations identical after revert (${revertedCount} vs ${finalCount})`)

// 4. Reload: fresh state from the saved document must match
const reloaded = makeState(before)
ok(count(build(reloaded), before.length) === finalCount, 'reload decorations match in-memory')

// 5. Edit-state (cursor on line) vs preview-state (cursor elsewhere):
// same content-style ranges, marker visibility flips but never disappears
const preview = build(makeState(before, 0))
const inContent = makeState(before, before.indexOf('粗') + 1)
const editing = build(inContent)
let pn = 0, en = 0
preview.between(0, before.length, () => { pn += 1 })
editing.between(0, before.length, () => { en += 1 })
ok(pn > 0 && en > 0, `both modes produce decorations (preview ${pn}, edit ${en})`)
// Moving cursor within the doc rebuilds for every line without throwing
for (let p = 0; p <= before.length; p += 7) {
  count(build(makeState(before, p)), before.length)
}

// 6. Unknown / pathological combinations
const weird = [
  '', '*****', '~~~~~~', '`', '``', '***', '___',
  '[[[[[', '](', '![', '\\\\\\',
  '*'.repeat(50), '`'.repeat(50), '~'.repeat(50), '_'.repeat(50),
  '**[**', '`**`**`**', '~~[~~](~~)',
  '混合 ** 未闭合 * 与 ~~ 和 ` 半行',
  '`a`'.repeat(40),
  '**x**'.repeat(40),
]
for (const w of weird) {
  try {
    const st = makeState(w)
    count(build(st), w.length)
  } catch (e) {
    failures += 1
    console.log('THREW for', JSON.stringify(w), '-', e.message)
  }
}

// 7. Multi-line document with blocks and inline on every line
const multi = [
  '# H1 **粗**',
      '',
      '段落 *斜* ~~删~~ `c` [l](u)。',
      '- 列表 **b**',
      '1. 有序 *i*',
      '> 引用 `q`',
      '```',
      '**not**',
      '```',
      '![i](https://x.com/a.png)'
].join('\n')
const ms = makeState(multi)
ok(count(build(ms), multi.length) > 10, 'multi-line doc renders')
for (let line = 1; line <= ms.doc.lines; line++) {
  const ln = ms.doc.line(line)
  count(build(makeState(multi, ln.from + 1)), multi.length)
}

console.log(`\nTRANSACTION/DECO TESTS: ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`)
process.exit(failures ? 1 : 0)
