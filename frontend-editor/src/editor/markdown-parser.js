import { markdownLanguage } from '@codemirror/lang-markdown'

/**
 * Markdown parser utilities.
 * Parses raw markdown text and identifies syntax regions for decoration.
 *
 * Each region has: { type, from, to, contentFrom, contentTo, meta }
 * - from/to: full range including syntax markers
 * - contentFrom/contentTo: range of the actual content (excluding markers)
 * - meta: additional info (heading level, language, url, etc.)
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

    pos = lineEnd + 1
  }

  parseInlineRegions(doc, regions)
  return regions
}

function findCodeBlockStartLine(lines, codeBlockStart, currentPos) {
  let p = 0
  for (let i = 0; i < lines.length; i++) {
    if (p === codeBlockStart) return i
    p += lines[i].length + 1
  }
  return 0
}

function getDirectChildren(node, name) {
  const result = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) result.push(child)
  }
  return result
}

function getChild(node, name) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child
  }
  return null
}

function addEmphasisRegion(node, doc, regions) {
  const marks = getDirectChildren(node, 'EmphasisMark')
  const opening = marks[0]
  const closing = marks[marks.length - 1]
  if (!opening || !closing) return

  const marker = doc.slice(opening.from, opening.to)[0]
  const isBold = opening.to - opening.from === 2
  regions.push({
    type: isBold ? 'bold' : 'italic',
    from: node.from,
    to: node.to,
    contentFrom: opening.to,
    contentTo: closing.from,
    meta: { marker: marker.repeat(isBold ? 2 : 1) }
  })
}

function addStrikethroughRegion(node, doc, regions) {
  const marks = getDirectChildren(node, 'StrikethroughMark')
  const opening = marks[0]
  const closing = marks[marks.length - 1]
  if (!opening || !closing || opening.to - opening.from !== 2) return

  regions.push({
    type: 'strikethrough',
    from: node.from,
    to: node.to,
    contentFrom: opening.to,
    contentTo: closing.from,
    meta: { marker: doc.slice(opening.from, opening.to) }
  })
}

function addInlineCodeRegion(node, doc, regions) {
  const marks = getDirectChildren(node, 'CodeMark')
  const opening = marks[0]
  const closing = marks[marks.length - 1]
  if (!opening || !closing) return

  const markerLen = opening.to - opening.from
  if (closing.to - closing.from !== markerLen) return

  regions.push({
    type: 'inline-code',
    from: node.from,
    to: node.to,
    contentFrom: opening.to,
    contentTo: closing.from,
    meta: { markerLen }
  })
}

function addLinkLikeRegion(node, doc, regions) {
  const marks = getDirectChildren(node, 'LinkMark')
  if (marks.length < 4) return

  const isImage = node.name === 'Image'
  const openingText = marks[0]
  const closingText = marks[1]
  const openingDestination = marks[2]
  const closingDestination = marks[3]

  const expectedOpening = isImage ? '![' : '['
  if (doc.slice(openingText.from, openingText.to) !== expectedOpening) return
  if (doc.slice(closingText.from, closingText.to) !== ']') return
  if (doc.slice(openingDestination.from, openingDestination.to) !== '(') return
  if (doc.slice(closingDestination.from, closingDestination.to) !== ')') return

  const contentFrom = openingText.to
  const contentTo = closingText.from
  const urlNode = getChild(node, 'URL')
  let url = urlNode ? doc.slice(urlNode.from, urlNode.to) : ''

  // Angle-bracket destinations include their wrapping characters in the URL node.
  if (url.startsWith('<') && url.endsWith('>') && url.length >= 2) {
    url = url.slice(1, -1)
  }

  if (isImage) {
    // Keep the previous requirement for a concrete image destination.
    if (!url.trim()) return
    regions.push({
      type: 'image',
      from: node.from,
      to: node.to,
      contentFrom,
      contentTo,
      meta: { alt: doc.slice(contentFrom, contentTo), url }
    })
    return
  }

  regions.push({
    type: 'link',
    from: node.from,
    to: node.to,
    contentFrom,
    contentTo,
    meta: { text: doc.slice(contentFrom, contentTo), url }
  })
}

/**
 * Parse inline regions from the CommonMark/GFM syntax tree. Unlike independent
 * regular expressions, the tree gives exact marker boundaries for nested
 * emphasis, links, Chinese punctuation, and leaves code content untouched.
 */
function parseInlineRegions(doc, regions) {
  const tree = markdownLanguage.parser.parse(doc)
  const inlineTypes = new Set([
    'StrongEmphasis',
    'Emphasis',
    'Strikethrough',
    'InlineCode',
    'Link',
    'Image'
  ])

  tree.iterate({
    enter(nodeRef) {
      if (!inlineTypes.has(nodeRef.name)) return

      const node = nodeRef.node
      switch (node.name) {
        case 'StrongEmphasis':
        case 'Emphasis':
          addEmphasisRegion(node, doc, regions)
          break
        case 'Strikethrough':
          addStrikethroughRegion(node, doc, regions)
          break
        case 'InlineCode':
          addInlineCodeRegion(node, doc, regions)
          break
        case 'Link':
        case 'Image':
          addLinkLikeRegion(node, doc, regions)
          break
      }
    }
  })

  regions.sort((a, b) => a.from - b.from || b.to - a.to)
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
