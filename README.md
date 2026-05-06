# claudesync

Desktop app to sync Claude Code configs (`~/.claude/`) across machines.

Two buttons — one for macOS, one for Windows — run `git pull` in your ai-config repo and then the matching install script. Output streams into a log console; errors are visible inline.

## Install

Download from [Releases](https://github.com/DuchitskyDA/claudesync/releases):

- **macOS:** `claudesync-<version>-arm64.dmg` or `-x64.dmg`. App is unsigned — right-click → Open the first time.
- **Windows:** `claudesync-Setup-<version>.exe` or portable `claudesync-<version>.exe`. SmartScreen may warn — More info → Run anyway.
- **Linux:** `claudesync-<version>.AppImage`. `chmod +x` and run.

## First run

1. Settings modal opens automatically. Click `Browse…` and pick the folder of your ai-config repo (the one with `install.sh` / `install.ps1`).
2. App validates the path: must be a directory with a `.git` and at least one of `install.sh` / `install.ps1`.
3. Click "Обновить" matching your OS — log streams progress.

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
