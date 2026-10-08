// The free matcher measurement (root cause R4: a proposal turned down because its words aren't copied exactly). Each
// case is a `find` (or a rewrite's `start`/`end`) as a model plausibly writes it after reading the invented scenes:
// straight quotes for curly ones, spaces squashed or added, wrapped in quotes, cut with an ellipsis, copied from the
// flattened 1,500-character quote "Ask about this" puts in the question, across a line break. Each is run through
// TODAY's acceptance in src/main/ask/agent.ts (EditorAgent.run, called, not copied) and through the page's apply-time
// matcher (findTextRange / findTextRangeAfter in src/renderer/src/features/editor/findText.ts). No model, no cost.

import { SCENES, askAboutQuote, plainText, vigilParagraphs } from './world'
import type { EvalApp } from './harness'

export interface MatchCase {
  id: string
  category: string
  scene: string
  tool: 'propose_edit' | 'propose_rewrite'
  find?: string
  start?: string
  end?: string
  /** The words in the scene (exactly as saved) the case means to point at, or null when it is ambiguous on purpose. */
  meant: string | null
}

const tally = SCENES.find((s) => s.key === 'tally')!.paragraphs
const office = SCENES.find((s) => s.key === 'office')!.paragraphs
const vigil = vigilParagraphs()
/** The quote "Ask about this" sends for S05's selection (five vigil paragraphs, flattened, cut at 1,500). */
const s05 = /“([\s\S]*)”\n\n/.exec(askAboutQuote(vigil.slice(2, 7).join('\n\n'), 'x'))![1]

export const MATCH_CASES: MatchCase[] = [
  // Exact copies (controls).
  { id: 'M01', category: 'exact', scene: 'tally', tool: 'propose_edit', find: 'Her grey shawl slipped from one shoulder', meant: 'Her grey shawl slipped from one shoulder' },
  { id: 'M02', category: 'exact', scene: 'tally', tool: 'propose_edit', find: '“Brom will know,” she said at last.', meant: '“Brom will know,” she said at last.' },
  { id: 'M03', category: 'exact', scene: 'vigil', tool: 'propose_edit', find: 'Quill lit the seventh lamp on the gallery', meant: 'Quill lit the seventh lamp on the gallery' },
  { id: 'M04', category: 'exact', scene: 'office', tool: 'propose_edit', find: 'Come before the bell, and come alone.', meant: 'Come before the bell, and come alone.' },
  // Straight quotes and apostrophes for curly ones.
  { id: 'M05', category: 'straight quotes', scene: 'tally', tool: 'propose_edit', find: `"I don't care what the ledger says," Hesper said.`, meant: '“I don’t care what the ledger says,” Hesper said.' },
  { id: 'M06', category: 'straight quotes', scene: 'steps', tool: 'propose_edit', find: `"The tide's late," Bram said.`, meant: '“The tide’s late,” Bram said.' },
  { id: 'M07', category: 'straight quotes', scene: 'vigil', tool: 'propose_edit', find: `"You shouldn't be here," Ilse said.`, meant: '“You shouldn’t be here,” Ilse said.' },
  { id: 'M08', category: 'straight quotes', scene: 'tally', tool: 'propose_edit', find: "Bram's face when the ferry came in", meant: 'Bram’s face when the ferry came in' },
  { id: 'M09', category: 'straight quotes', scene: 'office', tool: 'propose_edit', find: '"Your aunt writes a fine letter," Quill said', meant: '“Your aunt writes a fine letter,” Quill said' },
  // White space.
  { id: 'M10', category: 'white space', scene: 'tally', tool: 'propose_edit', find: 'Ilse had not slept.  Her hands still smelled of lamp oil', meant: 'Ilse had not slept. Her hands still smelled of lamp oil' },
  { id: 'M11', category: 'white space', scene: 'tally', tool: 'propose_edit', find: 'It was, after all, only Tuesday. ', meant: 'It was, after all, only Tuesday.' },
  { id: 'M12', category: 'white space', scene: 'tally', tool: 'propose_edit', find: ' Hesper closed the tally book.', meant: 'Hesper closed the tally book.' },
  { id: 'M13', category: 'white space', scene: 'tally', tool: 'propose_edit', find: 'Ilse had not slept.\nHer hands still smelled', meant: 'Ilse had not slept. Her hands still smelled' },
  // Wrapped in quotes.
  { id: 'M14', category: 'wrapped in quotes', scene: 'tally', tool: 'propose_edit', find: '"It was, after all, only Tuesday."', meant: 'It was, after all, only Tuesday.' },
  { id: 'M15', category: 'wrapped in quotes', scene: 'tally', tool: 'propose_edit', find: '“Her grey shawl slipped from one shoulder and she did not fix it.”', meant: 'Her grey shawl slipped from one shoulder and she did not fix it.' },
  { id: 'M16', category: 'wrapped in quotes', scene: 'tally', tool: 'propose_edit', find: "'Patch barked at the gulls'", meant: 'Patch barked at the gulls' },
  { id: 'M17', category: 'wrapped in quotes', scene: 'tally', tool: 'propose_edit', find: '"teh tide"', meant: 'teh tide' },
  // Cut with an ellipsis.
  { id: 'M18', category: 'ellipsis', scene: 'tally', tool: 'propose_edit', find: 'The tally book lay open on Hesper’s desk … in long bars.', meant: tally[0].slice(0, tally[0].indexOf('bars.') + 5) },
  { id: 'M19', category: 'ellipsis', scene: 'steps', tool: 'propose_edit', find: 'He raised a hand to her...and she raised hers back.', meant: 'He raised a hand to her—just the one hand, the way he always did—and she raised hers back.' },
  { id: 'M20', category: 'ellipsis', scene: 'office', tool: 'propose_edit', find: 'Ilse took the note down from the board… all the way home.', meant: office[6] },
  { id: 'M21', category: 'ellipsis', scene: 'tally', tool: 'propose_edit', find: 'Pitch came in wet and shook himself by the stove. Ilse knelt...', meant: 'Pitch came in wet and shook himself by the stove. Ilse knelt' },
  // Copied from the flattened quote "Ask about this" puts in the question.
  { id: 'M22', category: 'from the selection quote', scene: 'office', tool: 'propose_edit', find: office[2].replace(/\s+/g, ' '), meant: office[2] },
  { id: 'M23', category: 'from the selection quote', scene: 'office', tool: 'propose_edit', find: 'and come alone. Bring the tally book', meant: 'and come alone.\nBring the tally book' },
  { id: 'M24', category: 'from the selection quote', scene: 'vigil', tool: 'propose_edit', find: '“You shouldn’t be here,” Ilse said. “Neither should nine barrels of Hesper’s salt,”', meant: '“You shouldn’t be here,” Ilse said.\n“Neither should nine barrels of Hesper’s salt,”' },
  { id: 'M25', category: 'from the selection quote', scene: 'vigil', tool: 'propose_edit', find: '“They’re not missing. They’re late.” “Barrels aren’t late, Miss Marrow.', meant: '“They’re not missing. They’re late.”' },
  { id: 'M26', category: 'from the selection quote', scene: 'vigil', tool: 'propose_edit', find: s05.slice(-90), meant: null },
  // Across a line break, copied with the break.
  { id: 'M27', category: 'across a line break', scene: 'office', tool: 'propose_edit', find: 'Come before the bell, and come alone.\nBring the tally book, not the boy.', meant: 'Come before the bell, and come alone.\nBring the tally book, not the boy.' },
  { id: 'M28', category: 'across a line break', scene: 'vigil', tool: 'propose_edit', find: '“You shouldn’t be here,” Ilse said.\n“Neither should nine barrels', meant: '“You shouldn’t be here,” Ilse said.\n“Neither should nine barrels' },
  { id: 'M29', category: 'across a line break', scene: 'office', tool: 'propose_edit', find: 'Bring the tally book, not the boy.\n— H.', meant: 'Bring the tally book, not the boy.\n— H.' },
  // Dashes written another way.
  { id: 'M30', category: 'dashes', scene: 'tally', tool: 'propose_edit', find: 'teh tide--slow, then sudden--took nothing', meant: 'teh tide—slow, then sudden—took nothing' },
  { id: 'M31', category: 'dashes', scene: 'tally', tool: 'propose_edit', find: 'teh tide - slow, then sudden - took nothing', meant: 'teh tide—slow, then sudden—took nothing' },
  { id: 'M32', category: 'dashes', scene: 'tally', tool: 'propose_edit', find: 'teh tide–slow, then sudden–took nothing', meant: 'teh tide—slow, then sudden—took nothing' },
  { id: 'M33', category: 'dashes', scene: 'steps', tool: 'propose_edit', find: 'He raised a hand to her - just the one hand', meant: 'He raised a hand to her—just the one hand' },
  // Case.
  { id: 'M34', category: 'case', scene: 'tally', tool: 'propose_edit', find: 'her grey shawl slipped from one shoulder', meant: 'Her grey shawl slipped from one shoulder' },
  { id: 'M35', category: 'case', scene: 'tally', tool: 'propose_edit', find: 'the tally book lay open on Hesper’s desk', meant: 'The tally book lay open on Hesper’s desk' },
  // Too short: the words occur more than once (ambiguous on purpose).
  { id: 'M36', category: 'occurs more than once', scene: 'tally', tool: 'propose_edit', find: 'said nothing.', meant: null },
  { id: 'M37', category: 'occurs more than once', scene: 'vigil', tool: 'propose_edit', find: 'The lamp guttered, and steadied, and burned on.', meant: null },
  { id: 'M38', category: 'occurs more than once', scene: 'tally', tool: 'propose_edit', find: 'the tally book', meant: null },
  // Punctuation changed.
  { id: 'M39', category: 'punctuation', scene: 'tally', tool: 'propose_edit', find: '“Brom will know.”', meant: '“Brom will know,”' },
  { id: 'M40', category: 'punctuation', scene: 'tally', tool: 'propose_edit', find: 'Go and find him, Hesper said.', meant: '“Go and find him,” Hesper said.' },
  // propose_rewrite's start and end.
  { id: 'M41', category: 'rewrite: straight quotes', scene: 'tally', tool: 'propose_rewrite', start: `"I don't care what the ledger says,"`, end: 'had not looked at her once.', meant: '“I don’t care what the ledger says,”' },
  { id: 'M42', category: 'rewrite: straight quotes', scene: 'tally', tool: 'propose_rewrite', start: 'Hesper closed the tally book.', end: '"Before Quill does."', meant: 'Hesper closed the tally book.' },
  { id: 'M43', category: 'rewrite: from the selection quote', scene: 'office', tool: 'propose_rewrite', start: 'Come before the bell, and come alone. Bring the tally book', end: '— H.', meant: 'Come before the bell, and come alone.\nBring the tally book' },
  { id: 'M44', category: 'rewrite: exact', scene: 'tally', tool: 'propose_rewrite', start: 'The tally book lay open', end: 'only Tuesday.', meant: 'The tally book lay open' }
]

export interface MatchRow {
  id: string
  category: string
  tool: string
  /** As written, shown with \n for line breaks. */
  words: string
  agentAccepts: boolean
  agentSays: string
  /** The page's matcher finds it (Apply would work). */
  pageFinds: boolean
  /** ...at the words meant (null when the case means no one place). */
  pageRightPlace: boolean | null
}

export function measureMatcher(app: EvalApp): MatchRow[] {
  const rows: MatchRow[] = []
  let n = 0
  for (const c of MATCH_CASES) {
    const sceneId = app.scenes.get(c.scene)!
    const scene = SCENES.find((s) => s.key === c.scene)!
    if (!plainText(scene.paragraphs).includes(c.meant ?? '')) throw new Error(`${c.id}: the words meant aren't in ${c.scene}.`)
    const agent = new app.EditorAgent(app.db, { storyId: app.storyA, sceneId, prefs: app.prefs() }, () => undefined, () => undefined)
    const args =
      c.tool === 'propose_edit'
        ? { find: c.find, replace: 'NEW WORDS', why: 'Matcher measurement.' }
        : { start: c.start, end: c.end, replace: 'A new first paragraph.\n\nA new second paragraph.', why: 'Matcher measurement.' }
    const said = agent.run({ id: `m${++n}`, name: c.tool, arguments: JSON.stringify(args) }).result
    const docJson = (app.db.prepare('SELECT doc_json FROM scenes WHERE id = ?').get(sceneId) as { doc_json: string }).doc_json
    const doc = app.page.schema.nodeFromJSON(JSON.parse(docJson))
    let found: { from: number; to: number } | null
    if (c.tool === 'propose_edit') found = app.page.findTextRange(doc, c.find!)
    else {
      const a = app.page.findTextRange(doc, c.start!)
      found = a && app.page.findTextRangeAfter(doc, c.end!, a.from) ? a : null
    }
    const meantAt = c.meant ? app.page.findTextRange(doc, c.meant) : null
    rows.push({
      id: c.id,
      category: c.category,
      tool: c.tool,
      words: (c.find ?? `${c.start} … ${c.end}`).replace(/\n/g, '\\n'),
      agentAccepts: said.startsWith('Proposed to the writer'),
      agentSays: said.replace(/^Not proposed: nothing is waiting for the writer\. /, '').slice(0, 140),
      pageFinds: !!found,
      pageRightPlace: c.meant == null ? null : !!found && !!meantAt && found.from === meantAt.from
    })
  }
  return rows
}

export function matcherMarkdown(rows: MatchRow[], meta: { commit: string; at: string }): string {
  const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '–')
  const meant = rows.filter((r) => r.pageRightPlace !== null)
  const L: string[] = [
    '# Matcher measurement (R4)',
    '',
    `App @ ${meta.commit.slice(0, 9)}, ${meta.at}. ${rows.length} realistic \`find\` strings (and rewrite starts/ends) from the invented scenes, through today's acceptance in the editor chat's tools (src/main/ask/agent.ts, called) and the page's apply-time matcher (findTextRange). No model, no cost.`,
    '',
    `**The agent accepts ${rows.filter((r) => r.agentAccepts).length} of ${rows.length} (${pct(rows.filter((r) => r.agentAccepts).length, rows.length)}); the page's matcher finds ${rows.filter((r) => r.pageFinds).length} of ${rows.length} (${pct(rows.filter((r) => r.pageFinds).length, rows.length)}), at the words meant ${meant.filter((r) => r.pageRightPlace).length} of ${meant.length}.**`,
    '',
    `Turned down by the agent although the page would apply them at the words meant: ${rows.filter((r) => !r.agentAccepts && r.pageRightPlace).length}. Accepted by the agent but not found by the page: ${rows.filter((r) => r.agentAccepts && !r.pageFinds).length}.`,
    '',
    '| Category | Cases | Agent accepts | Page finds | Page, at the words meant |',
    '|---|---|---|---|---|'
  ]
  for (const cat of [...new Set(rows.map((r) => r.category))]) {
    const rs = rows.filter((r) => r.category === cat)
    const m = rs.filter((r) => r.pageRightPlace !== null)
    L.push(`| ${cat} | ${rs.length} | ${rs.filter((r) => r.agentAccepts).length} | ${rs.filter((r) => r.pageFinds).length} | ${m.length ? `${m.filter((r) => r.pageRightPlace).length} of ${m.length}` : 'n/a (ambiguous)'} |`)
  }
  L.push('', '| Case | Category | Words | Agent | Page | Agent says |', '|---|---|---|---|---|---|')
  for (const r of rows) {
    L.push(`| ${r.id} | ${r.category} | ${r.words.replace(/\|/g, '/').slice(0, 80)} | ${r.agentAccepts ? 'yes' : 'no'} | ${r.pageFinds ? (r.pageRightPlace === false ? 'yes (elsewhere)' : 'yes') : 'no'} | ${r.agentAccepts ? '' : r.agentSays.replace(/\|/g, '/')} |`)
  }
  return L.join('\n') + '\n'
}
