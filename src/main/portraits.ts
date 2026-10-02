// Serves portraits to the interface on aiwrite-image://entry/<entry id>?v=<version>. Portraits live
// in the open world's database (repo.setEntryImage), so they go wherever the world goes: backups,
// restores and the trash. The version in the address changes with the picture, so the window can
// keep a picture for as long as it likes.
import { protocol } from 'electron'
import * as repo from './db/repo'
import { maybeCurrentWorld } from './world'

/** Must run before the app is ready. */
export function registerPortraitScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: repo.IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/** Answers portrait requests from the open world. Runs once the app is ready. */
export function servePortraits(): void {
  protocol.handle(repo.IMAGE_SCHEME, (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const world = maybeCurrentWorld()
    const image = url.hostname === 'entry' && id && world ? repo.getEntryImage(world.db, id) : null
    if (!image) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(image.bytes), {
      headers: { 'content-type': image.type, 'cache-control': 'max-age=31536000, immutable' }
    })
  })
}
