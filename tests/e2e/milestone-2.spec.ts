// Milestone 2's acceptance checks ("Memory that keeps up"), walked through the interface the way
// Adam works, against the fake provider (tests/fake-provider/server.mjs). Its memory model reads
// three kinds of sentence: "<Name> lost her|his <thing>.", "<Name>'s eyes were <colour>." and
// "<Name> learned that <fact>.", and adds a <Name> it doesn't know as a new character.
//
//  1. Editing or deleting words in a scene updates or removes the facts that came from them, with no
//     clicks, and facts Adam typed himself never change. What changed lists every change, and Undo on
//     one keeps it from coming back the next time those words are read.
//  2. Drafting an earlier scene does not show later changes to the AI.
//  3. A small-context model and a large-context model both get a sensible briefing for the same scene.
//  4. Mark scene done (Ctrl+Enter) shows the scene as done and writes its summary; Reopen works.
//     (It runs before 2, so that the scene with the later change is done when the drafts are made.)
//  5. After closing and reopening the app, the memory, What changed and the scene states are still there.
//
// Nothing memory-related is ever clicked to make the memory catch up: it reads a scene a moment after
// typing stops (AIWRITE_KEEPER_QUIET_MS, short here) and when Adam leaves the scene.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, closeWindow, createWorldFromWelcome, expect, openSettings, test } from './helpers'

const ENV = { AIWRITE_KEEPER_QUIET_MS: '700' }
/** How long the memory may take to catch up (it usually takes a second or two). */
const MEMORY = { timeout: 30_000 }

// ---------- The story ----------

const MARA = {
  name: 'Mara Venn',
  aliases: 'Mara',
  summary: 'A disgraced heir turned smuggler, who trusts nobody on the river.',
  description:
    "Mara Venn was born to the river's richest family and lost everything to her uncle's lies before she was twenty. Now she runs cargo nobody else will touch, up and down the Narrows, for anyone who pays in coin and asks no questions. She is quick, careful and very hard to surprise, and she has learned to treat kindness as a debt that will one day be called in. People who meet her remember the stillness first: she watches before she speaks, and she rarely speaks first.",
  /** Typed by Adam himself: the memory must never change it, whatever the text says. */
  eyes: 'grey',
  fields: {
    Basics: { Pronouns: 'she/her', 'Age or birth date': '34' },
    Looks: {
      Build: 'Lean and wiry, stronger than she looks',
      Hair: 'Black, cropped short with a knife',
      Face: 'Narrow and weathered, with a nose broken once and set badly',
      Eyes: 'grey',
      Skin: 'Pale under the river tan, freckled across the knuckles',
      'Typical clothing': 'An oilskin cloak over a sailor’s jacket, boots with soft soles',
      'How they move': 'Quietly, always with a wall at her back'
    },
    Personality: {
      'Core traits': 'Watchful, dry and stubborn. Fiercely loyal to the very few people she trusts, and coldly polite to everyone else.',
      Values: 'A debt paid is a debt forgotten. A promise is worth exactly what it costs the one who makes it.',
      Flaws: 'Proud enough to refuse help she badly needs. Keeps score of every kindness, and resents being in anyone’s debt.',
      Fears: 'Being owed nothing by anyone, and so being worth nothing. Deep water at night. Becoming her uncle.',
      Desires: 'Her name back, painted over the warehouse doors where it used to be, and her uncle made to watch it go up.',
      'Habits and quirks': 'Counts the doors in every room she enters. Turns a copper coin over her knuckles when she is thinking.',
      'What makes them laugh or snap': 'Laughs at bad luck, her own included. Snaps at pity, and at anyone who calls her Lady Venn.'
    },
    Backstory: {
      Origin:
        'The only child of Aldous Venn, master of the Venn barge fleet, which carried half the grain that came down the Narrows. Her mother died of the river fever when Mara was six, and her father raised her on the decks and in the counting house, teaching her to read a manifest before she could read a story. She grew up expecting to inherit the fleet, the warehouses at Lowtown and the seat on the Wharf Council that came with them. She learned to swim before she could walk properly, to tie every knot on the river by the age of eight, and to keep her face still when the grown men at her father’s table lied to each other over dinner.',
      'Key past events':
        "At nineteen she found her father dead in the counting house, and within a month her uncle Corwin had produced a will that left everything to him. When she challenged it before the Wharf Council, three of her father's captains swore that she had forged letters in his name, and the council believed them. She was stripped of the Venn name in law, though not in the mouths of the docks, and spent a winter sleeping in the boatsheds. Tobin Reed's mother took her in that spring. Since then she has built a small, careful trade in goods that cannot travel by day, and she has quietly bought the debts of two of the three captains who lied about her.\n\nLast autumn the third captain, Hallam Pike, drowned off the Lowtown steps on a calm night, and the docks decided she had done it. She had not, but she let them think so, because fear is cheaper than guards. Since then the Wharf Council has watched her barges, her uncle has sent her two letters she burned unread, and a man in the Duke’s livery has twice asked the dockhands where she sleeps. She has started sleeping somewhere else every night, and she has stopped going anywhere without knowing three ways out.\n\nThis spring she took her first job from someone she did not know: forty sealed casks, carried upriver from the Duke’s wharf to a landing below the old mill, no questions. The money was good enough to buy back one of her father’s barges. Halfway up, the casks began to leak, and what leaked out was lamp oil, not wine. She sank the lot in the deep water under Gallows Reach rather than be caught with it, kept the money, and has been waiting ever since for someone to come and ask for either. Nobody has. That silence frightens her more than any threat, because it means whoever paid her did not need the oil delivered; they only needed to know she would carry it.",
      'Secrets they keep':
        'She kept one of her father’s ledgers, which proves the fleet was already deep in debt to the Duke before he died. She has never shown it to anyone, because it would ruin the Venn name she still wants back. She also keeps her father’s last letter sewn into the lining of her cloak. It names the Duke’s chandler as the man he was going to meet the night he died, and she has told no one, not even Tobin, because she is not yet sure whether it means he was murdered or only that he was desperate.'
    },
    'Goals and arc': {
      'What they want': 'To win back the Venn fleet and the seat on the Wharf Council, and to watch her uncle lose them in public.',
      'What they actually need': 'To let someone help her without counting the cost, and to stop measuring herself by her father’s name.',
      'Where the arc starts': 'Alone by choice, certain that everyone on the river has a price, including the people who love her.',
      'Where the arc should end': 'Choosing the people who stood by her over the name she was born to, even if it costs her the fleet.',
      'Current motivation': 'Find out who is moving the Duke’s oil by night, and what it is worth to her uncle.'
    },
    Voice: {
      'How they speak':
        'Short, dry sentences. Never raises her voice; goes quieter when she is angry. Uses dock slang with dockhands and her father’s careful counting-house English with anyone above them. Answers questions with questions when she does not trust the asker.',
      'Verbal tics': 'Says "fair" when she means the opposite.',
      'What they never say': 'Thank you, unless she means to pay it back.',
      'Sample lines of dialogue':
        '"You can owe me. I\'m good at waiting."\n"That\'s not a plan. That\'s a hope with a coat on."\n"Count the doors. Always count the doors."\n"I don\'t need saving. I need a boat."'
    }
  } as Record<string, Record<string, string>>
}

const TOBIN = {
  name: 'Tobin Reed',
  summary: 'A ferryman who owes Mara a favour and hates owing anyone.',
  description:
    'Tobin Reed runs the last ferry across the Narrows below the Lowtown steps, a flat, ugly boat he loves more than most people. He is broad, slow-moving and patient, and he hears everything said on his deck, which makes him the best-informed man on the river and the least willing to say so. He owes Mara for a debt she paid without asking, and he resents it as much as he is grateful.',
  fields: {
    Basics: { Pronouns: 'he/him', 'Age or birth date': '41' },
    Looks: {
      Build: 'Broad and heavy, gone a little soft around the middle',
      Face: 'Round and sunburnt, with a beard he trims with the ferry’s rope knife',
      Hair: 'Brown, thinning, tied back with tarred string',
      Eyes: 'Brown and always half-closed, as if against the glare off the water',
      'Typical clothing': 'A boatman’s smock gone grey with washing, and a hat he never takes off'
    },
    Personality: {
      'Core traits': 'Patient, kind in small ways, and slippery in large ones. Remembers every face that has crossed on his ferry.',
      Flaws: 'Takes money to look away, and tells himself it hurts nobody. Avoids a hard truth for as long as he can.',
      Fears: 'Losing the ferry. Being the reason Mara gets hurt.',
      'Habits and quirks': 'Whistles the same four notes when he is nervous. Taps the hull twice before every crossing, for luck.'
    },
    Backstory: {
      Origin:
        'Son of the woman who took Mara in the winter she lost her name. Grew up on the ferry and took it over when his mother’s hands gave out. Has crossed the Narrows more times than anyone alive and swears he could do it blindfolded, in fog, in flood.',
      'Key past events':
        'Three years ago the Wharf Council raised the crossing toll, and Tobin fell behind on his licence. Mara paid it without telling him; he found out from the clerk. He has never thanked her, and has been trying to pay her back ever since in ways she will not notice.',
      'Secrets they keep': 'He has been paid, twice, by a man in Corwin Venn’s colours to keep his ferry on the far bank on certain nights.'
    },
    'Goals and arc': {
      'What they want': 'To keep the ferry, keep out of trouble, and settle his debt to Mara without either of them having to say so.',
      'Current motivation': 'Keep Mara away from the third barge without telling her why.'
    },
    Voice: {
      'How they speak':
        'Slow, warm, never in a hurry. Tells stories instead of answering. Calls everyone "friend", especially people he dislikes.',
      'Sample lines of dialogue':
        '"Now, friend, that depends on the river."\n"I never said that. I said it might be true."\n"Sit down, Mara. You make the boat nervous."'
    }
  } as Record<string, Record<string, string>>
}

const EEL = {
  name: 'The Gilded Eel',
  summary: 'A smoky riverside tavern where nobody asks questions.',
  fields: {
    Atmosphere: 'Smoke, wet wool and quiet threats. Low beams, a fire that never quite draws, and a back room that is never empty.',
    'Sights, sounds and smells':
      'Tallow and pine smoke, river mud on every boot, the knock of tankards and the hush when a stranger comes in.',
    Geography: 'On the Lowtown quay, between the boatsheds and the toll steps, with a back door onto the water stairs.',
    'Who rules or lives there': 'Old Hesketh keeps the bar and the peace; the back room belongs to whoever paid him last.',
    History:
      'Once a customs house, until the customs men found the tavern trade paid better. The cellars still connect to the old tide tunnels under the quay.'
  } as Record<string, string>
}

const PROSE_STYLE =
  'Lean, concrete and sensory. Short sentences in action, longer ones for thought. Dialogue does most of the work; keep tags to "said". No modern idioms.'
const STYLE_NOTES =
  'The river is always there: in the sound, the smell, the light. Money and debt are the real currency of every conversation.'

const TOLL_LAW = {
  name: 'The Toll Law',
  summary: 'Every crossing of the Narrows after dark is paid for at the toll steps, in coin, in person.',
  fields: {
    Category: 'Law',
    'How it works':
      'Anyone crossing the Narrows between the evening bell and the dawn bell must stop at the toll steps and pay the Wharf Council’s keeper, in coin, with their own hand. The keeper writes the name, the boat and the cargo in the night book. Boats that cross without paying are seized with everything aboard, and their masters are fined a year’s licence.',
    'Limits and costs':
      'The toll is a silver crown a boat and a copper a passenger. Ferries with a Council licence cross free but must still be written in the night book. The keeper cannot be paid in kind, and cannot be paid by a servant.'
  } as Record<string, string>
}

const SAMPLE_PASSAGE =
  'The river did not care who you had been. That was the first thing the docks taught Mara, and the only lesson she had never had to learn twice. It carried grain for the Council and oil for the Duke and bodies for anyone careless enough to need it, and it carried them all at the same unhurried pace, brown and wide and patient, past the warehouses that had once had her name painted over their doors.\n\nShe did not look at the doors any more. She looked at the water, at the barges riding high or low, at who was standing on which deck and who was pretending not to watch them. A barge riding low meant weight. Weight meant money. Money meant someone, somewhere, who would rather nobody counted it.\n\nCounting it was what Mara did. She was very good at it. She had been taught by the best counting-house in Lowtown, before it had stopped being hers, and every night since she had added up the same sum and found it came out the same: one uncle, three liars, and a debt.'

/** Scene 2: the sentences the memory reads (and one it doesn't). */
const S2 = {
  opening: 'The ferry was late again, and the river ran high against the steps.',
  kell: 'Kell lost his left eye.',
  kellEdited: 'Kell lost his right eye.',
  eyes: "Mara's eyes were green in the lamplight.",
  learned: 'Mara learned that the ferry was sold.',
  learnedEdited: 'Mara learned that the ferry was burned.',
  brann: 'Brann lost his hat. He did not go back for it.',
  brannEdited: 'Brann lost his hat. Brann learned that the toll had doubled.'
}

/** Scene 3, a real-sized scene that ends with a lasting change for Mara. */
const S3 = [
  'The rain had not let up since noon, and the gutters of Lowtown ran black with it. Mara kept to the lee of the warehouses, where the eaves dripped steadily and the lamplight did not quite reach, and she counted the doors from the corner the way her father had taught her to count exits. Seven doors. Two of them barred, one of them new. Someone had money for new doors in Lowtown, and that was worth knowing.',
  'The docks smelled of tar and wet rope and the sour mud the river left behind when it dropped. Barges knocked against the pilings with a hollow, patient sound, and somewhere upriver a bell was ringing the change of the watch. She had timed it twice already. Between the bell and the lanterns coming round again there were nine minutes, perhaps ten if the sergeant stopped to argue with the toll-keeper, which he usually did.',
  'Tobin had said the crates would be on the third barge from the steps, under a tarpaulin patched with green. He had said it the way he said everything, looking past her at the water, as though the river might contradict him. She had not asked how he knew. Asking Tobin how he knew things was a good way to be told a story, and she did not have time for stories tonight.',
  'The third barge sat low in the water. Too low, she thought, for crates of salt and nails, which was what the manifest would say if anyone ever read it. She crouched at the edge of the steps and watched the deck for a long count of twenty. Nothing moved but the tarpaulin, lifting and settling in the wind like something breathing under it.',
  'She went down the steps on the outside of her boots, where the moss was thinnest, and stepped across the gap onto the deck. The boards gave a little under her weight. She found the edge of the tarpaulin by touch, then the rope that held it, then the knot, which was a sailor’s knot tied by someone who was not a sailor. She smiled at that, despite herself, and drew her knife.',
  'The crates were not salt. The first one she opened held lamp oil in stoppered jars, packed in straw, each jar stamped with the seal of the Duke’s own chandlery. The second held the same. By the fourth she had stopped counting and started thinking, because oil with a ducal seal did not travel by night on a barge that rode too low, not unless someone wanted it to burn somewhere it was not supposed to.',
  'She thought of the warehouses with her name painted out, and of the new doors, and of her uncle standing on the Council steps with his hands folded over his belly like a man who had already eaten. She thought of how much oil it would take to burn a whole street of warehouses, and of who would be paid to rebuild them, and she found that she had stopped feeling the rain.',
  'Above her, on the quay, a lantern swung round the corner a full three minutes early. She heard the sergeant’s voice, raised and cheerful, and another voice answering him that she knew far too well. Not the toll-keeper. Not anyone who should have been on the docks at this hour. She pulled the tarpaulin back over the crates with both hands and flattened herself against the wet boards, and she did not breathe.',
  'Two men came down the steps first, carrying nothing, which was its own kind of warning. They stood at the bottom with their backs to the barge and their faces to the quay, the way guards stand when they have been told to watch for someone in particular, and neither of them spoke.',
  'Then the voice again, closer now, saying something about the tide and the hour and how much a man could be expected to wait. It was a voice used to being answered. She had last heard it reading her father’s will aloud to a room full of people who already knew what it said.',
  'Boots on the steps. The barge dipped as someone stepped aboard, and the lantern light slid along the deck towards her like water finding a crack. She rolled for the gap between the hull and the pilings, caught the mooring rope as she went, and felt the barge lurch away from the wall as the current took it.',
  'The rope came tight around her wrist, the hull swung back, and the dock took what it wanted. Mara lost her left hand.'
]
const S3_NEW_OPENING = 'Dawn came grey over the Narrows.'

/** Scene 4's card: everything a real scene card holds. */
const S4 = {
  when: 'The night after the docks',
  beats: [
    'Mara reaches the Gilded Eel, her arm bound and hidden under her cloak',
    'Tobin sees the bandage and says nothing, which is worse',
    'She tells him about the oil with the Duke’s seal',
    'Tobin admits he knew whose barge it was',
    'Someone knocks at the door of the back room'
  ],
  goal: 'Find out who loaded the Duke’s oil onto the barge, without letting Tobin see how badly she is hurt.',
  conflict: 'Tobin knows more than he says, and Mara cannot afford to owe him anything else.',
  outcome: 'Mara learns Tobin was paid to look away; the knock cuts off her answer.',
  mood: 'Quiet and tense, with a bitter edge',
  notes:
    'Keep the injury mostly off the page: show it in what she cannot do, not in description. Tobin should never say outright that he knew; let it come out in what he avoids saying. The knock is Corwin’s man, but the scene ends before the door opens.'
}

// ---------- Finding things on screen ----------

const main = (win: Page) => win.locator('main')
const prose = (win: Page) => win.locator('.scene-prose')
const paragraph = (win: Page, text: string) => prose(win).locator('p', { hasText: text })
const sceneHeader = (win: Page) => win.locator('main header')
const generateButton = (win: Page) => sceneHeader(win).getByRole('button', { name: 'Generate', exact: true })
const doneButton = (win: Page) => sceneHeader(win).getByRole('button', { name: /^(Mark scene done|Done\. Reopen)/ })
const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
const contextTab = (win: Page) => win.getByRole('tabpanel', { name: 'Context' })
const nameBox = (win: Page) => win.getByRole('textbox', { name: 'Name', exact: true })
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title })
const entryRows = (win: Page) => win.locator('[data-entry]')
const section = (win: Page, title: string) =>
  main(win)
    .locator('section')
    .filter({ has: win.getByRole('button', { name: new RegExp(`^${title}`) }) })
/** The changes listed on the open entry page, one per item. */
const changes = (win: Page) => section(win, 'Changes over time').locator('li')

/** Opens a scene from the binder and waits for its page. */
async function openScene(win: Page, title: string): Promise<void> {
  await sceneRow(win, title).click()
  await expect(sceneHeader(win).getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(prose(win)).toBeVisible()
}

/** Adds a scene at the end of the chapter with the chapter's + button, keeping the name it is given ("Scene 2"). */
async function addScene(win: Page, title: string): Promise<void> {
  const chapter = binder(win).locator('[data-row="chapter"]', { hasText: 'Chapter 1' })
  await chapter.hover()
  await chapter.getByRole('button', { name: 'Add a scene to this chapter' }).click()
  const rename = binder(win).getByRole('textbox', { name: 'Scene title' })
  await expect(rename).toBeFocused()
  await expect(rename).toHaveValue(title)
  await rename.press('Enter')
  await expect(sceneRow(win, title)).toBeVisible()
}

/** Writes paragraphs at the end of the open scene, each arriving whole, as when Adam pastes it. */
async function writeParagraphs(win: Page, paras: string[]): Promise<void> {
  const empty = !(await prose(win).innerText()).trim()
  await prose(win).click()
  await win.keyboard.press('Control+End')
  for (const [i, p] of paras.entries()) {
    if (i > 0 || !empty) await win.keyboard.press('Enter')
    await win.keyboard.insertText(p)
  }
  await expect(paragraph(win, paras[paras.length - 1])).toBeVisible()
}

/** Selects a one-line paragraph's words and types new ones over them. */
async function rewriteParagraph(win: Page, before: string, after: string): Promise<void> {
  await paragraph(win, before).click()
  await win.keyboard.press('End')
  await win.keyboard.press('Shift+Home')
  await win.keyboard.insertText(after)
  await expect(paragraph(win, after)).toBeVisible()
  await expect(paragraph(win, before)).toHaveCount(0)
}

/** Selects a one-line paragraph's words and deletes them, and the empty line they leave. */
async function deleteParagraph(win: Page, text: string): Promise<void> {
  await paragraph(win, text).click()
  await win.keyboard.press('End')
  await win.keyboard.press('Shift+Home')
  await win.keyboard.press('Backspace')
  await win.keyboard.press('Backspace')
  await expect(paragraph(win, text)).toHaveCount(0)
}

type List = 'Characters' | 'Places' | 'Lore'
/** The buttons that make a new entry in each list: on its empty screen, and above the list. */
const CREATE: Record<List, [string, string]> = {
  Characters: ['Create a character', 'New character'],
  Places: ['Create a place', 'New place'],
  Lore: ['Create lore', 'New lore']
}

/** Opens one of the world's lists from the binder. */
async function openList(win: Page, list: List): Promise<void> {
  await binder(win).getByRole('button', { name: list }).click()
  const heading = main(win).getByRole('heading', { name: list, exact: true })
  await expect(heading.or(main(win).getByRole('heading', { name: `No ${list.toLowerCase()} yet` }))).toBeVisible()
}

/** Opens an entry's page from its list. */
async function openEntry(win: Page, list: List, name: string): Promise<void> {
  await openList(win, list)
  await entryRows(win).filter({ hasText: name }).first().click()
  await expect(nameBox(win)).toHaveValue(name)
}

/** Opens a section of the entry page (sections stay open from one page to the next). */
async function openSection(win: Page, title: string): Promise<void> {
  const toggle = main(win).getByRole('button', { name: new RegExp(`^${title}`) })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/** Creates a character or place from its list; a new one opens with its name selected, ready to type over. */
async function newEntry(win: Page, list: List, name: string): Promise<void> {
  await openList(win, list)
  const [empty, another] = CREATE[list]
  const create = win.getByRole('button', { name: empty, exact: true }).or(win.getByRole('button', { name: another, exact: true }))
  await create.first().click()
  await expect(nameBox(win)).toBeFocused()
  await win.keyboard.type(name)
  await expect(entryRows(win).filter({ hasText: name })).toBeVisible()
}

/** Fills the open entry page's fields, opening each section first. */
async function fillFields(win: Page, groups: Record<string, Record<string, string>>): Promise<void> {
  for (const [title, fields] of Object.entries(groups)) {
    await openSection(win, title)
    for (const [label, value] of Object.entries(fields)) await main(win).getByLabel(label, { exact: true }).fill(value)
  }
}

/** Picks a model for writing in Settings › Models. */
async function chooseWriter(win: Page, modelId: string): Promise<void> {
  if (!(await win.getByRole('heading', { level: 1, name: 'Models' }).isVisible())) await openSettings(win, 'Models')
  // The memory model's section below names the writer model too, so this looks only in the writer's.
  const writer = main(win).locator('section').filter({ has: win.getByRole('heading', { name: 'Writer model', exact: true }) })
  const change = writer.getByRole('button', { name: 'Change', exact: true })
  if (await change.isVisible()) await change.click()
  await win
    .getByRole('listbox', { name: 'Models' })
    .getByRole('option', { name: new RegExp(`^${modelId.replace('/', '\\/')}\\b`) })
    .click()
  await expect(writer.getByTitle(modelId, { exact: true })).toBeVisible()
}

const draftRows = (win: Page) => win.getByRole('tabpanel', { name: 'Drafts' }).getByRole('button', { name: /What the AI saw/ })

/** Generates a draft for the open scene and waits for it to finish, watching the Drafts tab. */
async function generate(win: Page): Promise<void> {
  await win.getByRole('tab', { name: 'Drafts' }).click()
  await expect(win.getByRole('tabpanel', { name: 'Drafts' }).getByText('No drafts yet')).toBeVisible()
  await generateButton(win).click()
  await expect(draftRows(win)).toHaveCount(1, MEMORY)
  await expect(draftRows(win).first()).not.toContainText('Writing', MEMORY)
  await expect(draftRows(win).first()).toContainText(/\d+ words/)
  await expect(generateButton(win)).toBeEnabled()
}

/** Opens the newest draft's "What the AI saw" and returns the exact messages the model was sent. */
async function whatTheAISaw(win: Page): Promise<string> {
  await win.getByRole('tab', { name: 'Drafts' }).click()
  await draftRows(win).first().click()
  await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
  await win.getByText('Show the exact messages sent').click()
  await expect(main(win).locator('pre').first()).toBeVisible()
  return (await main(win).locator('pre').allTextContents()).join('\n\n')
}

/** Each part of the briefing in the Context tab, with its state in the tab's own words. */
async function briefingParts(win: Page): Promise<{ title: string; state: string; note: string; tokens: string }[]> {
  const rows = contextTab(win).locator('section', { hasText: 'The briefing, part by part' }).locator('button[aria-expanded]')
  await expect(rows.first()).toBeVisible()
  return rows.evaluateAll((buttons) =>
    buttons.map((b) => {
      const spans = [...b.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '')
      const title = spans[0] ?? ''
      const badge = spans.find((s) => s === 'Short' || s === 'Left out')
      const note = (b.getAttribute('title') ?? '').slice(title.length + 2)
      return { title, state: badge ?? (note === 'Sent in full.' ? 'Full' : '?'), note, tokens: spans[spans.length - 1] }
    })
  )
}

/** Opens one part of the briefing in the Context tab and returns the words it sends. */
async function briefingPartText(win: Page, title: string): Promise<string> {
  const row = contextTab(win).getByRole('button', { name: new RegExp(`^${title}`) })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const body = contextTab(win).locator(`[id="${await row.getAttribute('aria-controls')}"]`)
  await expect(body).toBeVisible()
  return body.innerText()
}

/** The briefing's size and the room the chosen model has for it, from the Context tab's meter. */
async function briefingSize(win: Page): Promise<{ used: number; room: number }> {
  const meter = contextTab(win).getByRole('meter', { name: 'Briefing size' })
  return { used: Number(await meter.getAttribute('aria-valuenow')), room: Number(await meter.getAttribute('aria-valuemax')) }
}

const POV = `Point-of-view character: ${MARA.name}`
/** The part titles that must always be in the briefing, whatever the model. */
const ESSENTIAL = ['Instructions and style guide', 'Scene card', POV]

test('milestone 2: the memory keeps up with the text, drafts see only what came before, and every model gets a sensible briefing', async ({
  launch
}) => {
  test.setTimeout(360_000)
  const { startFakeProvider } = (await import('../fake-provider/server.mjs')) as { startFakeProvider: (o: object) => Promise<FakeProvider> }
  const fake = await startFakeProvider({ delayMs: 2, words: 120 })
  try {
    const first = await launch({ env: ENV })
    const win = first.win
    await createWorldFromWelcome(win, 'The Northern Reaches')

    await test.step('setup: a provider, a writer model, the cast, a place, a style guide and four scenes', async () => {
      await openSettings(win, 'Models')
      await win.getByRole('button', { name: 'Add another provider' }).click()
      const form = win.locator('form').filter({ hasText: 'Add a provider' })
      await form.getByLabel('Name').fill('Test server')
      await form.getByLabel('Base URL').fill(fake.url)
      await form.getByRole('button', { name: 'Add provider' }).click()
      await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
      await chooseWriter(win, 'fake/writer')

      // Mara, by hand, with a full profile; her eyes are grey because Adam says so.
      await newEntry(win, 'Characters', MARA.name)
      await main(win).getByLabel('Aliases').fill(MARA.aliases)
      await main(win).getByLabel('Short summary').fill(MARA.summary)
      await main(win).getByLabel('Description').fill(MARA.description)
      await fillFields(win, MARA.fields)
      await newEntry(win, 'Characters', TOBIN.name)
      await main(win).getByLabel('Short summary').fill(TOBIN.summary)
      await main(win).getByLabel('Description').fill(TOBIN.description)
      await fillFields(win, TOBIN.fields)
      await newEntry(win, 'Places', EEL.name)
      await main(win).getByLabel('Short summary').fill(EEL.summary)
      await fillFields(win, { Place: EEL.fields })
      // A law of the world the AI must never break.
      await newEntry(win, 'Lore', TOLL_LAW.name)
      await main(win).getByLabel('Short summary').fill(TOLL_LAW.summary)
      await main(win).getByRole('switch', { name: 'Hard rule' }).click()
      await expect(main(win).getByRole('switch', { name: 'Hard rule' })).toBeChecked()
      await fillFields(win, { Lore: TOLL_LAW.fields })

      await binder(win).getByRole('button', { name: 'Style guide' }).click()
      await expect(win.getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
      await main(win).getByLabel('Prose style').fill(PROSE_STYLE)
      await main(win).getByLabel('Notes', { exact: true }).fill(STYLE_NOTES)
      await main(win).getByLabel('Sample passage').fill(SAMPLE_PASSAGE)
      await expect(main(win).getByLabel('Sample passage')).toHaveValue(SAMPLE_PASSAGE)

      await openScene(win, 'Scene 1')
      for (const title of ['Scene 2', 'Scene 3', 'Scene 4']) await addScene(win, title)
    })

    await test.step('1. words in a scene become facts on the entry pages, by themselves', async () => {
      await openScene(win, 'Scene 2')
      await writeParagraphs(win, [S2.opening, S2.kell, S2.eyes, S2.learned, S2.brann])

      // Adam goes to look at Kell, whom he never made: the memory read him from the scene.
      await openEntry(win, 'Characters', 'Kell')
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Lost his left eye' })).toContainText(`“${S2.kell}”`, MEMORY)
      await expect(changes(win).filter({ hasText: 'Lost his left eye' })).toContainText('Book 1, Ch 1, Sc 2')

      await openEntry(win, 'Characters', MARA.name)
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Learns: the ferry was sold' })).toContainText(`“${S2.learned}”`, MEMORY)
      // The scene says green; Adam said grey, and his word stands.
      await openSection(win, 'Looks')
      await expect(main(win).getByLabel('Eyes', { exact: true })).toHaveValue(MARA.eyes)

      await openEntry(win, 'Characters', 'Brann')
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Lost his hat' })).toContainText('“Brann lost his hat.”', MEMORY)
    })

    await test.step('1. What changed lists it all, and Undo keeps a fact from coming back', async () => {
      await binder(win).getByRole('button', { name: 'What changed' }).click()
      await expect(win.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible()
      for (const line of [
        'Kell, New character',
        'Kell, Lost his left eye',
        `${MARA.name}, Knows the ferry was sold`,
        'Brann, New character',
        'Brann, Lost his hat'
      ]) {
        await expect(main(win).getByRole('button', { name: `Undo: ${line}`, exact: true })).toBeVisible()
      }
      await expect(main(win).getByRole('region', { name: 'Book 1, Ch 1, Sc 2' }).first()).toContainText(`“${S2.kell}”`)
      // Mara's eyes aren't listed: the memory doesn't change what Adam typed.
      await expect(main(win).getByRole('button', { name: new RegExp(`^Undo: ${MARA.name}, Eyes`) })).toHaveCount(0)

      await main(win).getByRole('button', { name: 'Undo: Brann, Lost his hat', exact: true }).click()
      await expect(win.getByText("Undone. The memory won't add that again from the same words.")).toBeVisible()
      await expect(main(win).getByRole('button', { name: 'Undo: Brann, Lost his hat', exact: true })).toHaveCount(0)
      await expect(main(win).locator('li', { hasText: 'Lost his hat' })).toContainText('Undone')
    })

    await test.step('1. editing the words updates the facts; Adam’s own fact stays', async () => {
      await openScene(win, 'Scene 2')
      await rewriteParagraph(win, S2.kell, S2.kellEdited)
      await rewriteParagraph(win, S2.learned, S2.learnedEdited)
      // Brann's paragraph is read again: the undone fact stays away, the new one is added.
      await rewriteParagraph(win, S2.brann, S2.brannEdited)

      await openEntry(win, 'Characters', 'Kell')
      await openSection(win, 'Changes over time')
      await expect(changes(win)).toHaveCount(1, MEMORY)
      await expect(changes(win).first()).toContainText('Lost his right eye', MEMORY)
      await expect(changes(win).first()).toContainText(`“${S2.kellEdited}”`)

      await openEntry(win, 'Characters', MARA.name)
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Learns: the ferry was burned' })).toContainText(`“${S2.learnedEdited}”`, MEMORY)
      await expect(changes(win).filter({ hasText: 'the ferry was sold' })).toHaveCount(0)
      await openSection(win, 'Looks')
      await expect(main(win).getByLabel('Eyes', { exact: true })).toHaveValue(MARA.eyes)

      await openEntry(win, 'Characters', 'Brann')
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Learns: the toll had doubled' })).toBeVisible(MEMORY)
      await expect(changes(win).filter({ hasText: 'Lost his hat' })).toHaveCount(0)
    })

    await test.step('1. deleting the words removes the facts, and Kell, whom only the text knew', async () => {
      await openScene(win, 'Scene 2')
      await deleteParagraph(win, S2.kellEdited)
      await deleteParagraph(win, S2.learnedEdited)
      await expect
        .poll(async () => (await prose(win).innerText()).split(/\n+/).filter((l) => l.trim()))
        .toEqual([S2.opening, S2.eyes, S2.brannEdited])

      await openList(win, 'Characters')
      await expect(entryRows(win).filter({ hasText: 'Kell' })).toHaveCount(0, MEMORY)
      await openEntry(win, 'Characters', MARA.name)
      await openSection(win, 'Changes over time')
      await expect(section(win, 'Changes over time')).toContainText(`what happens to ${MARA.name} is listed here`, MEMORY)
      await openSection(win, 'Looks')
      await expect(main(win).getByLabel('Eyes', { exact: true })).toHaveValue(MARA.eyes)

      await openSettings(win, 'Recently deleted')
      await expect(
        main(win).getByRole('list', { name: 'Recently deleted' }).getByRole('listitem').filter({ hasText: 'Kell' })
      ).toContainText('Character')

      await binder(win).getByRole('button', { name: 'What changed' }).click()
      for (const line of [
        'Kell, Lost his right eye: those words were deleted',
        `${MARA.name}, No longer knows the ferry was burned: those words were deleted`,
        'Kell, Moved to Trash: no scene mentions it any more',
        'Kell, Lost his right eye',
        `${MARA.name}, Knows the ferry was burned`
      ]) {
        await expect(main(win).getByRole('button', { name: `Undo: ${line}`, exact: true })).toBeVisible()
      }
      await expect(main(win).locator('li', { hasText: 'Lost his hat' })).toContainText('Undone')
    })

    await test.step('scene 3: Mara loses her left hand, and the memory follows', async () => {
      await openScene(win, 'Scene 3')
      await writeParagraphs(win, S3)
      await openEntry(win, 'Characters', MARA.name)
      await openSection(win, 'Changes over time')
      await expect(changes(win).filter({ hasText: 'Lost her left hand' })).toContainText('“Mara lost her left hand.”', MEMORY)
      await expect(changes(win).filter({ hasText: 'Lost her left hand' })).toContainText('Book 1, Ch 1, Sc 3')
    })

    await test.step('4. Ctrl+Enter marks the scene done and writes its summary; Reopen opens it again', async () => {
      await openScene(win, 'Scene 3')
      await win.getByRole('tab', { name: 'Scene card' }).click()
      const summary = sceneCard(win).getByRole('textbox', { name: 'Scene summary' })
      await expect(summary).toHaveValue(/^This part of the story begins: The rain had not let up since noon/, MEMORY)

      // A new opening line, then straight to Ctrl+Enter.
      await prose(win).click()
      await win.keyboard.press('Control+Home')
      await win.keyboard.insertText(`${S3_NEW_OPENING} `)
      await win.keyboard.press('Control+Enter')
      await expect(win.getByText('Scene marked done.')).toBeVisible()
      await expect(doneButton(win)).toHaveAccessibleName('Done. Reopen this scene for more work')
      await expect(sceneHeader(win).getByRole('button', { name: 'Scene status: Done' })).toBeVisible()
      await expect(sceneRow(win, 'Scene 3')).toContainText('Done')
      await expect(summary).toHaveValue(new RegExp(`^This part of the story begins: ${S3_NEW_OPENING} The rain`), MEMORY)
      await expect(sceneCard(win).getByText('Written by AI Write. Edit it to make it your own.')).toBeVisible()

      await doneButton(win).click()
      await expect(doneButton(win)).toHaveAccessibleName('Mark scene done (Ctrl+Enter)')
      await expect(sceneHeader(win).getByRole('button', { name: 'Scene status: Revised' })).toBeVisible()
      await expect(sceneRow(win, 'Scene 3')).toContainText('Revised')

      // Done again, to see it survive a restart.
      await prose(win).click()
      await win.keyboard.press('Control+Enter')
      await expect(doneButton(win)).toHaveAccessibleName('Done. Reopen this scene for more work')
    })

    await test.step('2. a draft of scene 1 never hears what happens in scene 3', async () => {
      await openScene(win, 'Scene 1')
      await win.getByRole('tab', { name: 'Scene card' }).click()
      await sceneCard(win).getByRole('combobox', { name: 'Point of view' }).click()
      await win.getByRole('option', { name: MARA.name, exact: true }).click()
      await sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true }).click()
      await win.keyboard.type('Mara waits on the Lowtown steps for a ferry that is late')
      await generate(win)

      const sent = await whatTheAISaw(win)
      expect(sent).toContain(`Point-of-view character: ${MARA.name}`)
      expect(sent).toContain(MARA.fields.Backstory.Origin)
      expect(sent).toContain(`Eyes: ${MARA.eyes}`)
      expect(sent).not.toMatch(/left hand/i)
      expect(sent).not.toContain('Eyes: green')
    })

    await test.step('2. a draft of scene 4 does', async () => {
      await openScene(win, 'Scene 4')
      await win.getByRole('tab', { name: 'Scene card' }).click()
      const card = sceneCard(win)
      await card.getByRole('combobox', { name: 'Point of view' }).click()
      await win.getByRole('option', { name: MARA.name, exact: true }).click()
      // The point-of-view list gives the keyboard back to its box as it closes: only then type in the next one.
      await expect(win.getByRole('listbox')).toHaveCount(0)
      const cast = card.getByRole('combobox', { name: 'Characters present' })
      await cast.click()
      await cast.fill('Tob')
      await win
        .getByRole('listbox', { name: 'Characters' })
        .getByRole('option', { name: new RegExp(TOBIN.name) })
        .click()
      await cast.press('Escape')
      await expect(card.getByRole('button', { name: `Remove ${TOBIN.name}` })).toBeVisible()
      await card.getByRole('combobox', { name: 'Location' }).click()
      await win.getByRole('option', { name: EEL.name, exact: true }).click()
      await card.getByRole('textbox', { name: 'When', exact: true }).fill(S4.when)
      await card.getByRole('textbox', { name: 'Beats', exact: true }).click()
      for (const [i, beat] of S4.beats.entries()) {
        if (i > 0) await win.keyboard.press('Enter')
        await win.keyboard.type(beat)
      }
      await card.getByRole('textbox', { name: 'Goal', exact: true }).fill(S4.goal)
      await card.getByRole('textbox', { name: 'Conflict', exact: true }).fill(S4.conflict)
      await card.getByRole('textbox', { name: 'Outcome', exact: true }).fill(S4.outcome)
      await card.getByRole('textbox', { name: 'Mood or tone', exact: true }).fill(S4.mood)
      await card.getByRole('textbox', { name: 'Notes for the AI', exact: true }).fill(S4.notes)
      await expect(card.getByRole('textbox', { name: `Beat ${S4.beats.length}`, exact: true })).toHaveValue(S4.beats[S4.beats.length - 1])
      await generate(win)

      const sent = await whatTheAISaw(win)
      expect(sent).toContain('lost her left hand (Book 1, Ch 1, Sc 3)')
      expect(sent).toContain('Mara lost her left hand.')
      expect(sent).toContain(`Eyes: ${MARA.eyes}`)
      expect(sent).not.toContain('Eyes: green')
    })

    await test.step('3. the same scene, briefed for a large-context model and a small one', async () => {
      // The large model: every part in full.
      await openScene(win, 'Scene 4')
      await win.getByRole('tab', { name: 'Context' }).click()
      await expect(contextTab(win).getByText('fake/writer reads 32K tokens; 2,835 of them are kept for its reply.')).toBeVisible()
      const large = await briefingParts(win)
      for (const title of [
        ...ESSENTIAL,
        'End of the previous scene',
        'Also in the scene',
        'Setting',
        'World rules (never break these)',
        'The story so far'
      ]) {
        expect(large.map((p) => p.title)).toContain(title)
      }
      expect(
        large.filter((p) => p.state !== 'Full'),
        'every part is sent in full to the large model'
      ).toEqual([])
      const full = await briefingSize(win)
      expect(full.used).toBeLessThanOrEqual(full.room)
      const largePov = await briefingPartText(win, POV)
      expect(largePov).toContain('Short, dry sentences')
      expect(largePov).toContain('Hallam Pike')

      // A small model, chosen the way Adam does it.
      await chooseWriter(win, 'fake/8k')
      await openScene(win, 'Scene 4')
      await expect(contextTab(win).getByText('fake/8k reads 8K tokens; 2,835 of them are kept for its reply.')).toBeVisible()
      await expect.poll(async () => (await briefingSize(win)).room).toBeLessThan(full.room)
      const { room } = await briefingSize(win)
      expect(full.used, 'the full briefing is too big for the small model, so it must be shortened').toBeGreaterThan(room)
      await expect.poll(async () => (await briefingParts(win)).some((p) => p.state !== 'Full')).toBe(true)
      const small = await briefingParts(win)
      expect(small.map((p) => p.title)).toEqual(large.map((p) => p.title))
      for (const title of ESSENTIAL) {
        expect(small.find((p) => p.title === title)?.state, `"${title}" is in the small model's briefing`).toMatch(/^(Full|Short)$/)
      }
      expect(small.filter((p) => p.state === 'Short' || p.state === 'Left out').length).toBeGreaterThan(0)
      // Mara's part still says who she is and what has happened to her; shortened, it leaves out her backstory.
      const smallPov = await briefingPartText(win, POV)
      expect(smallPov).toContain('Short, dry sentences')
      expect(smallPov).toContain('lost her left hand')
      if (small.find((p) => p.title === POV)?.state === 'Short') expect(smallPov).not.toContain('Hallam Pike')
      // And it fits.
      expect((await briefingSize(win)).used).toBeLessThanOrEqual(room)
    })

    await test.step('5. close the app, open it again: everything is still there', async () => {
      await closeWindow(first.app)
      const second = await launch({ dataDir: first.dataDir, env: ENV })
      const again = second.win
      await expect(prose(again)).toBeVisible()

      // The scene states and the summary.
      await expect(sceneRow(again, 'Scene 3')).toContainText('Done')
      await openScene(again, 'Scene 3')
      await expect(doneButton(again)).toHaveAccessibleName('Done. Reopen this scene for more work')
      await again.getByRole('tab', { name: 'Scene card' }).click()
      await expect(sceneCard(again).getByRole('textbox', { name: 'Scene summary' })).toHaveValue(
        new RegExp(`^This part of the story begins: ${S3_NEW_OPENING} The rain`)
      )

      // The memory.
      await openList(again, 'Characters')
      await expect(entryRows(again)).toHaveCount(3)
      for (const name of [MARA.name, TOBIN.name, 'Brann']) await expect(entryRows(again).filter({ hasText: name })).toBeVisible()
      await openEntry(again, 'Characters', MARA.name)
      await openSection(again, 'Looks')
      await expect(main(again).getByLabel('Eyes', { exact: true })).toHaveValue(MARA.eyes)
      await openSection(again, 'Changes over time')
      await expect(changes(again)).toHaveCount(1)
      await expect(changes(again).first()).toContainText('Lost her left hand')
      await expect(changes(again).first()).toContainText('“Mara lost her left hand.”')
      await openEntry(again, 'Characters', 'Brann')
      await openSection(again, 'Changes over time')
      await expect(changes(again)).toHaveCount(1)
      await expect(changes(again).first()).toContainText('Learns: the toll had doubled')
      await openSettings(again, 'Recently deleted')
      await expect(
        main(again).getByRole('list', { name: 'Recently deleted' }).getByRole('listitem').filter({ hasText: 'Kell' })
      ).toBeVisible()

      // What changed, with Undo where it was left.
      await binder(again).getByRole('button', { name: 'What changed' }).click()
      await expect(main(again).getByRole('button', { name: `Undo: ${MARA.name}, Lost her left hand`, exact: true })).toBeVisible()
      await expect(
        main(again).getByRole('button', {
          name: `Undo: ${MARA.name}, No longer knows the ferry was burned: those words were deleted`,
          exact: true
        })
      ).toBeVisible()
      await expect(main(again).locator('li', { hasText: 'Lost his hat' })).toContainText('Undone')
      await expect(main(again).getByRole('button', { name: 'Undo: Brann, Lost his hat', exact: true })).toHaveCount(0)
    })
  } finally {
    await fake.close()
  }
})
