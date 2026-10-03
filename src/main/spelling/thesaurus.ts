// The thesaurus for synonyms on right-click: made from WordNet (Princeton University) by build/thesaurus.mjs and
// shipped in resources/thesaurus/ with its licence. Read once, the first time synonyms are asked for.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseThesaurus, type Thesaurus } from '@shared/spelling'

/** The thesaurus file, beside the app (out/main is two folders down from the app's root, inside the archive too). */
export const thesaurusFile = (): string => join(__dirname, '../../resources/thesaurus/en-thesaurus.txt.gz')

let loaded: Thesaurus | null = null
let failed = false

/** The thesaurus, read on first use; null if it can't be read (then the menu simply has no synonyms). */
export function thesaurus(): Thesaurus | null {
  if (loaded || failed) return loaded
  try {
    loaded = parseThesaurus(gunzipSync(readFileSync(thesaurusFile())).toString('utf8'))
  } catch (e) {
    failed = true
    console.warn('The thesaurus could not be read', e)
  }
  return loaded
}
