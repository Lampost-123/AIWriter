// The guided tour of the desk: what each step points at and what it says, in Adam's words. A step whose target isn't
// on screen (a room that isn't open, the top bar at a small size) shows as a card in the middle of the window.

export interface TourStep {
  /** A CSS selector for the thing the step points at; none means the middle of the window. */
  target?: string
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to your desk',
    body: 'This is where the whole story lives. The tour takes about a minute. You can skip it at any point and show it again from the command bar.'
  },
  {
    target: '[aria-label="Home"]',
    title: 'Home',
    body: 'Home, top left, takes you back to the start screen. That is where you pick what to work on: a world, a story, or where you left off.'
  },
  {
    target: '[aria-label="Story home"]',
    title: 'The book page',
    body: 'The lamp and the story’s name open the book page: where you left off, its chapters, open plot threads and cast, and how much you wrote this week.'
  },
  {
    target: '[aria-label="Rooms"]',
    title: 'The rooms',
    body: 'Write is the page you draft in. Plan holds the outline and the story board, World holds every character and place, and Check shows what needs a look.'
  },
  {
    title: 'Writing',
    body: 'Click into a scene and type. Ctrl+G asks the AI for a draft, and Ctrl+Enter marks the scene done. Nothing needs saving: it is saved as you type.'
  },
  {
    target: '[data-tour="keeper"]',
    title: 'The memory',
    body: 'AI Write keeps track of who knows what, where everyone is and what has changed, as you write. This shows when it is reading your words.'
  },
  {
    target: '[data-tour="command"]',
    title: 'The command bar',
    body: 'Press Ctrl+K to find anything in your story, or run an action such as Show the tour or Keyboard shortcuts.'
  },
  {
    target: '[aria-label="Settings"]',
    title: 'Settings',
    body: 'Settings holds your AI services and the models that write for you, the look of the app, and backups of your work.'
  },
  {
    title: 'That is the tour',
    body: 'Start with a scene, or open the book page to see the whole story. Show the tour again any time from the command bar.'
  }
]

/** The step after `index`, or null past the last one (the tour is done). */
export function stepAfter(index: number, count = TOUR_STEPS.length): number | null {
  return index + 1 < count ? index + 1 : null
}

/** The step before `index`, never below the first. */
export function stepBefore(index: number): number {
  return Math.max(0, index - 1)
}
