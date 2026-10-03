import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecipeParts } from '@shared/contracts/recipes'
import { GENRES } from '@shared/genres'
import { INTENSITY } from '@shared/intensity'
import type { Story } from '@shared/types'
import { recipeIntoStory, storyBeforeRecipe } from './apply'
import { feelText, parseFeel } from './feel'
import { emptyParts, parseRecipe } from './parse'
import { combineSystem } from './prompts'
import { RecipeFiles } from './store'

describe('reading a recipe’s genre and content', () => {
  it('reads genres and levels by their labels', () => {
    expect(parseFeel('Genres: Horror, Mystery. Romance: Fade to black. Violence: Vivid. Language: Mild.')).toEqual({
      genres: ['horror', 'mystery'],
      intensity: { romance: 2, violence: 3, language: 2 }
    })
  })

  it('ignores case, bullets, notes in brackets and the way genres are joined', () => {
    expect(parseFeel('- genre: DARK FANTASY (leading) with romance\n- violence: graphic;\n- LANGUAGE: anything goes')).toEqual({
      genres: ['dark-fantasy', 'romance'],
      intensity: { violence: 4, language: 4 }
    })
    expect(parseFeel('Sci-fi and cosy. Romance: none').genres).toEqual(['sci-fi', 'cosy'])
  })

  it('tells the Romance genre from the Romance level', () => {
    expect(parseFeel('Genres: Romance. Romance: Explicit.')).toEqual({ genres: ['romance'], intensity: { romance: 4 } })
  })

  it('leaves out words it doesn’t know, and keeps at most two genres', () => {
    expect(parseFeel('Genres: Western, Horror, Thriller, Comedy. Romance: Steamy. Violence: lots. Swearing: Strong.')).toEqual({
      genres: ['horror', 'thriller'],
      intensity: {}
    })
  })

  it('finds nothing in empty or unrelated text', () => {
    expect(parseFeel('')).toEqual({ genres: [], intensity: {} })
    expect(parseFeel('A quiet story about a lighthouse keeper.')).toEqual({ genres: [], intensity: {} })
  })

  it('writes the part in its own form, which reads back the same', () => {
    const f = { genres: ['mystery', 'cosy'], intensity: { violence: 2 as const, language: 1 as const } }
    expect(feelText(f)).toBe('Genres: Mystery, Cosy. Violence: Restrained. Language: Clean.')
    expect(parseFeel(feelText(f))).toEqual(f)
    expect(feelText({ genres: ['horror'], intensity: {} })).toBe('Genre: Horror.')
    expect(feelText({ genres: [], intensity: {} })).toBe('')
  })
})

describe('asking for genre and content', () => {
  it('lists every genre and every level to choose from, and is read back under its heading', () => {
    const system = combineSystem()
    expect(system).toContain('## Genre and content')
    for (const g of GENRES) expect(system).toContain(g.label)
    for (const s of INTENSITY) expect(system).toContain(`${s.label} (${s.steps.map((st) => st.label).join(', ')})`)
    expect(parseRecipe('## Genre and content\nGenres: Horror.').parts.feel).toBe('Genres: Horror.')
  })
})

const parts = (p: Partial<RecipeParts>): RecipeParts => ({ ...emptyParts(), ...p })

const story = (style: Story['style'] = {}): Pick<Story, 'id' | 'themes' | 'tone' | 'style'> => ({ id: 's1', themes: '', tone: '', style })

describe('a new story from a recipe', () => {
  it('takes its genres and levels, and Undo puts back what the story had', () => {
    const s = story({ pov: 'First person', genres: ['fantasy'], intensity: { romance: 1, language: 3 } })
    const { before, patch } = recipeIntoStory(s, parts({ feel: 'Genres: Horror, Mystery. Violence: Vivid. Language: mild.', tense: 'Past' }))
    expect(patch.style.genres).toEqual(['horror', 'mystery'])
    // Levels the recipe names replace the story's; the others stay.
    expect(patch.style.intensity).toEqual({ romance: 1, violence: 3, language: 2 })
    expect(patch.style.pov).toBe('First person')
    const back = storyBeforeRecipe({ style: patch.style }, before)
    expect(back.style).toEqual(s.style)
  })

  it('leaves genres and levels alone when the part names nothing it knows, or is empty (an old recipe)', () => {
    for (const feel of ['', 'Genres: Western. Romance: lots.']) {
      const s = story({ genres: ['comedy'], intensity: { violence: 1 } })
      const { before, patch } = recipeIntoStory(s, parts({ feel }))
      expect(patch.style.genres).toEqual(['comedy'])
      expect(patch.style.intensity).toEqual({ violence: 1 })
      expect(before.style.genres).toBeUndefined()
      expect(before.style.intensity).toBeUndefined()
    }
  })

  it('Undo clears genres and levels from a story that had none', () => {
    const { before, patch } = recipeIntoStory(story(), parts({ feel: 'Genre: Thriller. Romance: None.' }))
    expect(patch.style).toEqual({ genres: ['thriller'], intensity: { romance: 1 } })
    expect(storyBeforeRecipe({ style: patch.style }, before).style).toEqual({})
  })
})

describe('a recipe saved before genre and content', () => {
  it('still loads, with the part empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aiwrite-recipes-'))
    try {
      const id = '00000000-0000-4000-8000-000000000009'
      mkdirSync(join(dir, id), { recursive: true })
      const old = { version: 1, id, name: 'An old one', status: 'ready', parts: { themes: 'Trust', tone: 'Wry' }, edited: [] }
      writeFileSync(join(dir, id, 'recipe.json'), JSON.stringify(old))
      const r = new RecipeFiles(dir).read(id)!
      expect(r.parts.feel).toBe('')
      expect(r.parts.themes).toBe('Trust')
      expect(recipeIntoStory(story(), r.parts).patch.style).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
