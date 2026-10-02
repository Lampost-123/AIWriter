# AI Write

Write long stories with AI that remembers your world: characters, places, lore and style,
so every scene stays consistent.

## Installing (Windows)

1. Download **AI-Write-Setup-x.y.z.exe** from the latest release:
   <https://github.com/Lampost-123/AIWriter/releases/latest>.
   Your browser may say the file isn't commonly downloaded. Choose **Keep**.
2. Double-click the file. Windows may show a blue "Windows protected your PC" screen. This happens
   because the installer isn't code-signed yet. Click **More info**, then **Run anyway**.
   You only see this when installing: after that, new versions install themselves.
3. AI Write installs and opens straight away. Next time, open it from the Start menu or the
   desktop.

**Updating:** AI Write checks for a new version each time it starts, downloads it in the
background and asks before restarting. Your worlds, settings and keys are kept.

**Before the first release is published:** on GitHub, open **Actions**, click the latest **CI**
run with a green tick, scroll down to **Artifacts** and download **AI-Write-Windows-installer**.
Unzip it (right-click it, then **Extract All**); the installer is inside.

## For developers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```
npm ci             # install exactly what package-lock.json lists (it never changes the file)
npm run dev        # run the app with hot reload
npm run typecheck
npm test
```
