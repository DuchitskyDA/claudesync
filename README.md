# claudesync

Desktop app to sync AI tool configs (`~/.claude/`, etc.) across machines + manage Claude Code plugins from a GUI.

## Features

- **Sync tab** — `git clone` / `git pull` your config repo and run its install script with one button. Status indicators per step, collapsible log.
- **Plugins tab** — browse a catalog of Claude Code plugins, install / remove individually or apply a preset (group of plugins) in one click. Env-key prompts (e.g. Context7 API key) with built-in instructions.

## Install

Download the build for your OS from [Releases](https://github.com/DuchitskyDA/claudesync/releases).

### macOS (unsigned — extra step required)

The app is **not signed with an Apple Developer ID** (signing costs $99/year). macOS Gatekeeper will block it on first launch with a message like *"claudesync is damaged and can't be opened"* or *"cannot be opened because the developer cannot be verified"*.

**To run:**

1. Download `claudesync-<version>-arm64.dmg` (Apple Silicon: M1/M2/M3/M4) or `-x64.dmg` (Intel).
2. Open the `.dmg` and drag **claudesync.app** into `Applications`.
3. Open Terminal and run:

   ```bash
   xattr -cr /Applications/claudesync.app
   codesign --force --deep --sign - /Applications/claudesync.app
   ```

   First line clears all macOS extended attributes (including quarantine). Second line re-applies ad-hoc signature — Apple Silicon refuses to launch unsigned arm64 binaries even after quarantine removal.
4. Open the app from Launchpad / Applications normally.

If you see *"claudesync is damaged and can't be opened"* — re-run the two commands above. They are idempotent.

> **Note:** v0.3.3+ build pipeline applies ad-hoc signing automatically, but the `xattr -cr` is still required because macOS adds a fresh quarantine flag every time you download a file.

### Windows

Download `claudesync-Setup-<version>.exe` (installer) or `claudesync-<version>.exe` (portable).

The app is **not code-signed**, so SmartScreen will show *"Windows protected your PC"*:
1. Click **More info**.
2. Click **Run anyway**.

### Linux

Download `claudesync-<version>.AppImage`:

```bash
chmod +x claudesync-*.AppImage
./claudesync-*.AppImage
```

## First run

1. Settings modal opens automatically.
2. **Rules target folder** is auto-detected from `~/.claude` if it exists. Otherwise enter the path manually.
3. **Repo URL** is optional — only needed if you want Sync (clone+install your config repo). For plugin-only usage you can leave it empty.
4. Click **Save**.

### To sync a config repo
- Fill **Repo URL** (HTTPS or SSH).
- Local repo path is auto-managed (hidden under `▸ Advanced` if you want to override).
- Switch to **Sync** tab → **Sync now**.

### To manage plugins
- Switch to **Plugins** tab.
- Apply a preset or click **Install** on individual plugins.
- For plugins with API key requirements (e.g. Context7), a modal pops up with instructions.
- Restart Claude Code after applying changes.

## Plugin catalog

The catalog lives at [DuchitskyDA/claudesync-plugins](https://github.com/DuchitskyDA/claudesync-plugins) — JSON updated independently from app releases. Open a PR there to add a plugin or preset.

## Develop

```bash
npm install
npm run dev          # Electron + Vite with HMR
npm test             # vitest
npm run typecheck
npm run lint
npm run dist         # build installers for current OS
```

## License

MIT
