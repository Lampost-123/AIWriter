// What the memory model is told when it works out where things stand (continuity/tracker.ts): the reply's shape and the
// rules for each value. One copy, used by the tracker's own request and by the memory keeper's reading of a scene when
// that reading also says where things stand at its end (one reading of a scene, overhaul phase 1: keeper/prompts.ts
// ONE_READING_STAGE), so a change to a rule reaches both. Pure; no imports.

/** The reply room where things stand needs (the tracker's own request asks with this much). */
export const STAGE_REPLY = 3000

/** One value and the words that show it. */
export const STAGE_FIELD = '{"value": "", "quote": ""}'
const piece = '{"item": "", "state": "", "quote": ""}'
const thing = '{"thing": "", "state": "", "quote": ""}'

/** The reply's shape: the scene's time, weather, light and things, and each character. */
export const STAGE_SHAPE = `{"time": ${STAGE_FIELD}, "weather": ${STAGE_FIELD}, "light": ${STAGE_FIELD}, "things": [${thing}], "characters": [{"name": "", "where": ${STAGE_FIELD}, "clothes": [${piece}], "posture": ${STAGE_FIELD}, "touching": ${STAGE_FIELD}, "sees": ${STAGE_FIELD}, "holding": ${STAGE_FIELD}, "condition": ${STAGE_FIELD}, "mood": ${STAGE_FIELD}, "lastAction": ${STAGE_FIELD}}]}`

/** The rules for each value, as the tracker has always given them ("the scene" is the words being read). */
export const STAGE_RULES = `- Only values the scene's words show or change, each with its quote. Leave out anything you can't quote: it carries on from before, or stays unknown. Never guess or fill a gap with what is likely. A value without its words is thrown away.
- time: time of day (and date, if the story gives one); weather; light (lamplight, dusk, harsh sun).
- things: the things in the place that matter, only where the words put them there or change them: a door or a window shut, open, locked or barred; something put down somewhere (the case on the windowsill, the cup on the table); a lamp lit or out; a fire banked. "thing": a short name, the same as before for the same thing ("the back door"). When the words say only "the door" (or "the window") and more than one is named, it is not the nearest one named: it is the one the words show the person came through or stands at, and the quote takes in those words too ("at the passage door … turned the key"); when the words don't show which, call it "the door". "state": where it is and how it is now ("on the windowsill"; "shut and barred from inside"). When someone picks it up or carries it off, its state is "gone" (it is then what they hold). Not people, not the room itself, and never clothing, on or off: a piece of clothing goes under its person's clothes, even lying on the floor.
- One entry for each character who is in the scene or whose situation it changes, by their name as the cast list has it.
- where: where they are at the end, as exactly as the text allows (the inn's back room, by the hearth; on the bed, by the window).
- clothes: one entry for each piece of clothing the scene shows them wearing, putting on, taking off or changing, each with its own quote. Jewellery, a pack and a sword belt count; hair, beard and body don't. "item": a short name, the same as before for the same piece ("grey cloak", "left boot"); "state": "on" or "off" first, then where it is when off, then how it sits: done up or open, pushed up, tucked in, torn, soaked ("off, over the chair"; "on, unbuttoned to the waist, sleeves rolled up"); "gone" when it is no longer theirs (given away, burnt). Only the pieces the scene shows or changes: boots taken off is one entry, and the coat carries on from before. Everything taken off (naked): one entry, "item": "everything", "state": "off" (and where, if the words say), with its quote.
- posture: how their body is placed: standing, sitting, kneeling or lying, and on what; which way they face; what their hands, arms and legs are doing (sitting on the edge of the bed facing the window, hands in her lap).
- touching: who they are touching and how, only when the words say so (her knee against Tobin's; holding Ash's hand); "nobody" when the words show it ending.
- sees: who they can or can't see or hear, only when the words say so (watching Tobin from the stairs; can't see Mara behind the screen; out of earshot of the yard). Never work it out from where people are.
- holding: what they hold or carry now, and in which hand when the text says. Something put down, hung up or given away is no longer held: say "nothing" (or what they still hold), and quote the words where they put it down.
- condition: injuries, exhaustion, hunger, drunkenness: how their body is now, not how it always is (a scar or a missing finger belongs to who they are, not here, unless the scene changes it).
- mood: how they feel at the end.
- lastAction: the last thing they did, in a few words.
- When something has changed, give only the new state, never the old one. When something stops (a thing put down, a coat or boots taken off), the quote is the words where it happens.
- Keep each value short, but leave out no detail the text gives: posture may take a full line.`

/** The heading the cast list goes under, in the tracker's request and in a reading that also says where things stand. */
export const CAST_HEADING = 'Characters in this story (the name to use first, then other names the story calls them):'

/** The cast list as the memory model is given it, under its heading; '' with no one. */
export const castBlock = (cast: string[]): string => (cast.length ? `${CAST_HEADING}\n${cast.map((c) => `- ${c}`).join('\n')}` : '')
