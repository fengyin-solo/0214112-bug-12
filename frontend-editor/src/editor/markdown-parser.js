/**
 * Markdown parser utilities.
 * Parses raw markdown text and identifies syntax regions for decoration.
 *
 * Each region has: { type, from, to, contentFrom, contentTo, meta }
 * - from/to: full range including syntax markers
 * - contentFrom/contentTo: range of the actual content (excluding markers)
 * - meta: additional info (heading level, language, url, marker ranges…)
 *
 * Inline parsing follows a two-phase design:
 *   1. A single-pass scanner recognises opaque constructs (backslash
 *      escapes, inline code spans, links/images with recursive link text)
 *      and collects emphasis delimiter characters (`*`, `_`, `~`).
 *   2. A cmark/markdown-it "balance pairs" pass (jump table + rule-of-three
 *      lower bounds) resolves bold/italic/strikethrough nesting exactly like
 *      the reference renderer.
 *
 * Because matching is structural rather than a collection of independent
 * regexes, mixed/overlapping/nested formatting and inline code next to
 * Chinese punctuation always resolve to correct, non-overlapping ranges.
 */

/**
 * @typedef {Object} MarkdownRegion
 * @property {string} type
 * @property {number} from
 * @property {number} to
 * @property {number} contentFrom
 * @property {number} contentTo
 * @property {Object} [meta]
 */

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'

function isEscapable(ch) {
  return ch !== undefined && ESCAPABLE.includes(ch)
}

function isWhitespace(ch) {
  return ch === undefined || /\s/u.test(ch)
}

// CommonMark ASCII punctuation set
const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'

function isPunctuation(ch) {
  if (ch === undefined) return false
  // CommonMark punctuation = specific ASCII punctuation OR a character in
  // Unicode categories Pc/Pd/Ps/Pe/Pi/Pf/Po. The second group covers
  // full-width Chinese punctuation (，。！？：；、…—""''（）【】 etc.).
  // Note: symbols not in the ASCII set (e.g. §, ¶, ©) are excluded.
  return ASCII_PUNCT.includes(ch) || /\p{P}/u.test(ch)
}

/**
 * Parse a document string and return all markdown regions.
 * @param {string} doc - The full document text
 * @returns {MarkdownRegion[]}
 */
export function parseMarkdownRegions(doc) {
  const regions = []
  const lines = doc.split('\n')
  let pos = 0
  let inCodeBlock = false
  let codeBlockStart = -1
  let codeBlockLang = ''
  let codeBlockMarkerLen = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = pos
    const lineEnd = pos + line.length

    // Code block fences
    const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockStart = lineStart
        codeBlockLang = fenceMatch[2].trim()
        codeBlockMarkerLen = fenceMatch[1].length
        pos = lineEnd + 1
        continue
      } else if (fenceMatch[1].length >= codeBlockMarkerLen && fenceMatch[1][0] === (lines[findCodeBlockStartLine(lines, codeBlockStart, pos)]?.match(/^(`{3,}|~{3,})/)?.[1]?.[0] || '`')) {
        regions.push({
          type: 'code-block',
          from: codeBlockStart,
          to: lineEnd,
          contentFrom: codeBlockStart,
          contentTo: lineEnd,
          meta: { language: codeBlockLang }
        })
        inCodeBlock = false
        codeBlockStart = -1
        codeBlockLang = ''
        pos = lineEnd + 1
        continue
      }
    }

    if (inCodeBlock) {
      pos = lineEnd + 1
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const markEnd = lineStart + level
      regions.push({
        type: 'heading',
        from: lineStart,
        to: lineEnd,
        contentFrom: markEnd + 1,
        contentTo: lineEnd,
        meta: { level, markFrom: lineStart, markTo: markEnd + 1 }
      })
      // Inline formatting inside headings is live-rendered too
      parseInlineRegions(line, lineStart, regions, level + 1, line.length)
      pos = lineEnd + 1
      continue
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      regions.push({
        type: 'hr',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart,
        contentTo: lineEnd,
        meta: {}
      })
      pos = lineEnd + 1
      continue
    }

    // Blockquote
    const bqMatch = line.match(/^(>\s?)(.*)$/)
    if (bqMatch) {
      regions.push({
        type: 'blockquote',
        from: lineStart,
        to: lineEnd,
        contentFrom: lineStart + bqMatch[1].length,
        contentTo: lineEnd,
        meta: { markFrom: lineStart, markTo: lineStart + bqMatch[1].length }
      })
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s(.+)$/)
    if (ulMatch) {
      const indent = ulMatch[1].length
      const markerStart = lineStart + indent
      regions.push({
        type: 'list-bullet',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerStart + 2,
        contentTo: lineEnd,
        meta: { marker: ulMatch[2], markerFrom: markerStart, markerTo: markerStart + 1, indent }
      })
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s(.+)$/)
    if (olMatch) {
      const indent = olMatch[1].length
      const markerStart = lineStart + indent
      const markerEnd = markerStart + olMatch[2].length + 1
      regions.push({
        type: 'list-ordered',
        from: lineStart,
        to: lineEnd,
        contentFrom: markerEnd + 1,
        contentTo: lineEnd,
        meta: { number: olMatch[2], markerFrom: markerStart, markerTo: markerEnd, indent }
      })
    }

    // Task list
    const taskMatch = line.match(/^(\s*[-*+]\s)\[([xX ])\]\s(.+)$/)
    if (taskMatch) {
      const checkStart = lineStart + taskMatch[1].length
      regions.push({
        type: 'task-list',
        from: lineStart,
        to: lineEnd,
        contentFrom: checkStart + 4,
        contentTo: lineEnd,
        meta: {
          checked: taskMatch[2].toLowerCase() === 'x',
          checkFrom: checkStart,
          checkTo: checkStart + 3
        }
      })
    }

    // Inline patterns on this line
    parseInlineRegions(line, lineStart, regions, 0, line.length)

    pos = lineEnd + 1
  }

  return regions
}

function findCodeBlockStartLine(lines, codeBlockStart) {
  let p = 0
  for (let i = 0; i < lines.length; i++) {
    if (p === codeBlockStart) return i
    p += lines[i].length + 1
  }
  return 0
}

// ---------------------------------------------------------------------------
// Inline scanning — phase 1
// ---------------------------------------------------------------------------

/**
 * Parse inline markdown within [scanFrom, scanTo) of one line.
 */
function parseInlineRegions(line, lineStart, regions, scanFrom = 0, scanTo = line.length) {
  /** @type {Delimiter[]} one entry per emphasis marker character */
  const delimiters = []
  /** @type {StrikeDelimiter[]} one entry per `~~` pair inside a run */
  const strikeDelimiters = []

  let i = scanFrom
  while (i < scanTo) {
    const ch = line[i]

    // Backslash escape — the next ASCII-punctuation character is literal
    if (ch === '\\' && i + 1 < scanTo && isEscapable(line[i + 1])) {
      i += 2
      continue
    }

    // Inline code span — content is fully opaque
    if (ch === '`') {
      const run = runLength(line, i, '`')
      const close = findCodeSpanClose(line, i + run, scanTo, run)
      if (close >= 0) {
        const contentFrom = i + run
        const contentTo = close
        // CommonMark: strip one leading/trailing space when space-padded
        const innerLen = contentTo - contentFrom
        let trimFrom = contentFrom
        let trimTo = contentTo
        const hiddenRanges = [
          [lineStart + i, lineStart + i + run],
          [lineStart + close, lineStart + close + run]
        ]
        if (
          innerLen > 1 &&
          line.charCodeAt(contentFrom) === 32 &&
          line.charCodeAt(contentTo - 1) === 32
        ) {
          trimFrom += 1
          trimTo -= 1
          hiddenRanges.push(
            [lineStart + contentFrom, lineStart + contentFrom + 1],
            [lineStart + contentTo - 1, lineStart + contentTo]
          )
        }
        regions.push({
          type: 'inline-code',
          from: lineStart + i,
          to: lineStart + close + run,
          contentFrom: lineStart + trimFrom,
          contentTo: lineStart + trimTo,
          meta: { markerLen: run, markerRanges: hiddenRanges }
        })
        i = close + run
        continue
      }
      // Unmatched backticks are plain text
      i += run
      continue
    }

    // Image: ![alt](url)
    if (ch === '!' && line[i + 1] === '[') {
      const link = scanLink(line, i + 1, scanTo)
      if (link) {
        const { textFrom, textTo, fullTo, url, alt } = link
        regions.push({
          type: 'image',
          from: lineStart + i,
          to: lineStart + fullTo,
          contentFrom: lineStart + textFrom,
          contentTo: lineStart + textTo,
          meta: { alt, url }
        })
        i = fullTo
        continue
      }
    }

    // Link: [text](url) — recurse into the text for nested inline
    if (ch === '[') {
      const link = scanLink(line, i, scanTo)
      if (link) {
        const { textFrom, textTo, fullTo, url } = link
        regions.push({
          type: 'link',
          from: lineStart + i,
          to: lineStart + fullTo,
          contentFrom: lineStart + textFrom,
          contentTo: lineStart + textTo,
          meta: { text: line.slice(textFrom, textTo), url }
        })
        if (textTo > textFrom) {
          parseInlineRegions(line, lineStart, regions, textFrom, textTo)
        }
        i = fullTo
        continue
      }
    }

    // Emphasis / strong marker characters
    if (ch === '*' || ch === '_') {
      const run = runLength(line, i, ch)
      const flank = computeFlanking(line, i, run, scanFrom, scanTo)
      if (flank.canOpen || flank.canClose) {
        for (let n = 0; n < run; n++) {
          delimiters.push({
            pos: i + n,
            char: ch,
            runLen: run,
            open: flank.canOpen,
            close: flank.canClose,
            end: -1
          })
        }
      }
      i += run
      continue
    }

    // GFM strikethrough: a run contributes floor(len/2) `~~` delimiters;
    // an odd-length run leaves one leading literal `~`. Each pair opens or
    // closes per the run's flanking and is matched independently (GFM does
    // not apply the emphasis rule-of-three).
    if (ch === '~') {
      const run = runLength(line, i, '~')
      if (run >= 2) {
        const flank = computeFlanking(line, i, run, scanFrom, scanTo)
        const pairCount = Math.floor(run / 2)
        const offset = run % 2 === 1 ? 1 : 0
        for (let n = 0; n < pairCount; n++) {
          strikeDelimiters.push({
            pos: i + offset + n * 2,
            open: flank.canOpen,
            close: flank.canClose,
            end: -1
          })
        }
      }
      i += run
      continue
    }

    i += 1
  }

  // Phase 2: resolve bold / italic and strikethrough pairs
  resolveEmphasis(line, lineStart, regions, delimiters)
  resolveStrikethrough(line, lineStart, regions, strikeDelimiters)
}

/**
 * @typedef {Object} Delimiter
 * @property {number} pos      Character index in the line
 * @property {string} char     '*' | '_' | '~'
 * @property {number} runLen   Length of the run this marker belongs to
 * @property {boolean} open    Run can open emphasis
 * @property {boolean} close   Run can close emphasis
 * @property {number} end      Index of matched closer (-1 when unmatched)
 */

function runLength(line, i, ch) {
  let j = i + 1
  while (j < line.length && line[j] === ch) j += 1
  return j - i
}

function findCodeSpanClose(line, from, to, markerLen) {
  let j = from
  while (j < to) {
    if (line[j] === '`') {
      const run = runLength(line, j, '`')
      if (run === markerLen) return j
      j += run
    } else {
      j += 1
    }
  }
  return -1
}

/**
 * CommonMark flanking rules for a delimiter run [index, index+runLen).
 * Underscores additionally forbid intraword emphasis (which also covers
 * Chinese characters adjacent to `_`).
 */
function computeFlanking(line, index, runLen, scanFrom, scanTo) {
  const before = index > scanFrom ? line[index - 1] : undefined
  const afterChar = index + runLen < scanTo ? line[index + runLen] : undefined
  const leftFlanking =
    !isWhitespace(afterChar) &&
    (!isPunctuation(afterChar) || isWhitespace(before) || isPunctuation(before))
  const rightFlanking =
    !isWhitespace(before) &&
    (!isPunctuation(before) || isWhitespace(afterChar) || isPunctuation(afterChar))

  const ch = line[index]
  let canOpen = leftFlanking
  let canClose = rightFlanking
  if (ch === '_') {
    canOpen = leftFlanking && (!rightFlanking || isPunctuation(before))
    canClose = rightFlanking && (!leftFlanking || isPunctuation(afterChar))
  }
  return { canOpen, canClose }
}

// ---------------------------------------------------------------------------
// Inline scanning — phase 2: emphasis balance (cmark / markdown-it model)
// ---------------------------------------------------------------------------

/**
 * Pair opener/closer marker characters and emit bold/italic/strikethrough
 * regions. Uses the jump-table + six-slot lower-bound algorithm so the work
 * stays linear and "rule of three" nesting (including `***x***` and
 * `**粗*斜粗*粗**`) resolves identically to markdown-it.
 */
function resolveEmphasis(line, lineStart, regions, delimiters) {
  const max = delimiters.length
  if (max === 0) return

  const bottoms = {}
  const jumps = new Array(max).fill(0)
  let headerIdx = 0
  let lastPos = -2

  for (let ci = 0; ci < max; ci++) {
    const closer = delimiters[ci]

    // Markers belong to the same run when adjacent and same character
    if (delimiters[headerIdx].char !== closer.char || lastPos !== closer.pos - 1) {
      headerIdx = ci
    }
    lastPos = closer.pos
    if (!closer.close) continue

    if (!bottoms[closer.char]) bottoms[closer.char] = [-1, -1, -1, -1, -1, -1]
    const slots = bottoms[closer.char]
    const minIdx = slots[(closer.open ? 3 : 0) + (closer.runLen % 3)]

    let oi = headerIdx - jumps[headerIdx] - 1
    let newMinIdx = oi

    for (; oi > minIdx; ) {
      const opener = delimiters[oi]
      // Save the jump before this iteration can overwrite jumps[oi]
      const step = jumps[oi] + 1
      if (opener.char === closer.char && opener.open && opener.end < 0) {
        let odd = false
        if (opener.close || closer.open) {
          const sum = opener.runLen + closer.runLen
          if (sum % 3 === 0 && (opener.runLen % 3 !== 0 || closer.runLen % 3 !== 0)) {
            odd = true
          }
        }
        if (!odd) {
          const lastJump = oi > 0 && !delimiters[oi - 1].open ? jumps[oi - 1] + 1 : 0
          jumps[ci] = ci - oi + lastJump
          jumps[oi] = lastJump
          closer.open = false
          opener.end = ci
          opener.close = false
          newMinIdx = -1
          lastPos = -2
          break
        }
      }
      oi -= step
    }

    if (newMinIdx !== -1) {
      slots[(closer.open ? 3 : 0) + (closer.runLen % 3)] = newMinIdx
    }
  }

  // Emit regions from paired markers. Iterate right-to-left so that when two
  // adjacent markers merged into strong/strikethrough are encountered, the
  // outer (leftmost of the two) opener is handled first and the inner
  // single-marker emphasis pair is skipped (mirrors markdown-it's
  // postProcess, which walks the opener list backwards).
  for (let i = max - 1; i >= 0; i--) {
    const opener = delimiters[i]
    if (opener.end < 0) continue
    const closer = delimiters[opener.end]

    const firstOpener = delimiters[i - 1]
    const firstCloser = delimiters[opener.end + 1]
    const isPair =
      i > 0 &&
      firstOpener.char === opener.char &&
      firstOpener.end === opener.end + 1 &&
      firstOpener.pos === opener.pos - 1 &&
      firstCloser &&
      firstCloser.pos === closer.pos + 1

    if (isPair) {
      const leftFrom = lineStart + firstOpener.pos
      const rightTo = lineStart + closer.pos + 2
      regions.push({
        type: 'bold',
        from: leftFrom,
        to: rightTo,
        contentFrom: leftFrom + 2,
        contentTo: lineStart + closer.pos,
        meta: {
          marker: opener.char + opener.char,
          markerLen: 2,
          markerRanges: [
            [leftFrom, leftFrom + 2],
            [lineStart + closer.pos, rightTo]
          ]
        }
      })
      i -= 1
      continue
    }

    const leftFrom = lineStart + opener.pos
    const rightTo = lineStart + closer.pos + 1
    regions.push({
      type: 'italic',
      from: leftFrom,
      to: rightTo,
      contentFrom: leftFrom + 1,
      contentTo: lineStart + closer.pos,
      meta: {
        marker: opener.char,
        markerLen: 1,
        markerRanges: [
          [leftFrom, leftFrom + 1],
          [lineStart + closer.pos, rightTo]
        ]
      }
    })
  }
}

/**
 * @typedef {Object} StrikeDelimiter
 * @property {number} pos    Start of the `~~` pair in the line
 * @property {boolean} open  Run can open strikethrough
 * @property {boolean} close Run can close strikethrough
 * @property {number} end    Matched closer index (-1 when unmatched)
 */

/**
 * Pair GFM strikethrough `~~` delimiters using the same balance model but
 * without rule-of-three restrictions (GFM). Adjacent unmatched pairs inside
 * multi-tilde runs are handled by the run splitting done during scanning.
 */
function resolveStrikethrough(line, lineStart, regions, dels) {
  const max = dels.length
  if (max === 0) return

  const jumps = new Array(max).fill(0)
  let headerIdx = 0
  let lastPos = -2

  for (let ci = 0; ci < max; ci++) {
    const closer = dels[ci]
    // Same run when adjacent `~~` pairs (positions differ by 2)
    if (lastPos !== closer.pos - 2) headerIdx = ci
    lastPos = closer.pos
    if (!closer.close) continue

    let oi = headerIdx - jumps[headerIdx] - 1
    for (; oi >= 0; ) {
      const opener = dels[oi]
      const step = jumps[oi] + 1
      if (opener.open && opener.end < 0) {
        const lastJump = oi > 0 && !dels[oi - 1].open ? jumps[oi - 1] + 1 : 0
        jumps[ci] = ci - oi + lastJump
        jumps[oi] = lastJump
        closer.open = false
        opener.end = ci
        opener.close = false
        lastPos = -2
        break
      }
      oi -= step
    }
  }

  for (const opener of dels) {
    if (opener.end < 0) continue
    const closer = dels[opener.end]
    const leftFrom = lineStart + opener.pos
    const rightTo = lineStart + closer.pos + 2
    regions.push({
      type: 'strikethrough',
      from: leftFrom,
      to: rightTo,
      contentFrom: leftFrom + 2,
      contentTo: lineStart + closer.pos,
      meta: {
        marker: '~~',
        markerLen: 2,
        markerRanges: [
          [leftFrom, leftFrom + 2],
          [lineStart + closer.pos, rightTo]
        ]
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Links / images
// ---------------------------------------------------------------------------

/**
 * Scan a link/image starting with the `[` at `bracketFrom`.
 * Returns { textFrom, textTo, fullTo, url, alt } or null.
 */
function scanLink(line, bracketFrom, scanTo) {
  let depth = 1
  let j = bracketFrom + 1
  const textFrom = j
  while (j < scanTo) {
    const ch = line[j]
    if (ch === '\\' && isEscapable(line[j + 1])) {
      j += 2
      continue
    }
    if (ch === '`') {
      const run = runLength(line, j, '`')
      const close = findCodeSpanClose(line, j + run, scanTo, run)
      if (close >= 0) {
        j = close + run
        continue
      }
      j += run
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) break
    }
    j += 1
  }
  if (depth !== 0 || line[j] !== ']' || j + 1 >= scanTo || line[j + 1] !== '(') return null

  const textTo = j
  const target = scanLinkTarget(line, j + 1, scanTo)
  if (!target) return null

  return {
    textFrom,
    textTo,
    fullTo: target.end,
    url: target.url,
    alt: line.slice(textFrom, textTo)
  }
}

/**
 * Parse the `(destination ["title"])` part beginning at `(`. Supports
 * balanced parentheses inside the destination.
 */
function scanLinkTarget(line, parenFrom, scanTo) {
  let j = parenFrom + 1
  while (j < scanTo && (line[j] === ' ' || line[j] === '\t')) j += 1

  let url = ''
  if (line[j] === '<') {
    const end = line.indexOf('>', j + 1)
    if (end < 0 || end >= scanTo) return null
    url = line.slice(j + 1, end)
    j = end + 1
  } else {
    const start = j
    let depth = 0
    while (j < scanTo) {
      const ch = line[j]
      if (ch === '\\' && isEscapable(line[j + 1])) {
        j += 2
        continue
      }
      if (ch === '(') depth += 1
      else if (ch === ')') {
        if (depth === 0) break
        depth -= 1
      } else if (ch === ' ' || ch === '\t') {
        break
      }
      j += 1
    }
    url = line.slice(start, j)
  }

  if (!url) return null

  let k = j
  let sawSpace = false
  while (k < scanTo && (line[k] === ' ' || line[k] === '\t')) { k += 1; sawSpace = true }
  if (sawSpace && k < scanTo && line[k] !== ')') {
    const quote = line[k]
    if (quote === '"' || quote === "'") {
      const titleEnd = line.indexOf(quote, k + 1)
      if (titleEnd < 0 || titleEnd >= scanTo) return null
      k = titleEnd + 1
      while (k < scanTo && (line[k] === ' ' || line[k] === '\t')) k += 1
    } else {
      return null
    }
  }

  if (k >= scanTo || line[k] !== ')') return null
  return { url, end: k + 1 }
}

/**
 * Check if a position falls within any region.
 * @param {MarkdownRegion[]} regions
 * @param {number} pos
 * @returns {MarkdownRegion|null}
 */
export function regionAtPos(regions, pos) {
  return regions.find(r => pos >= r.from && pos <= r.to) || null
}

/**
 * Check if a cursor line overlaps with a region.
 * @param {MarkdownRegion} region
 * @param {number} lineFrom
 * @param {number} lineTo
 * @returns {boolean}
 */
export function cursorOnRegion(region, lineFrom, lineTo) {
  return region.from <= lineTo && region.to >= lineFrom
}
