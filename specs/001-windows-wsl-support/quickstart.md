# Quickstart: Testing Windows WSL2 Support

## Prerequisites

- Windows 10 21H2+ or Windows 11
- WSL2 installed with a default distro (e.g. Ubuntu): `wsl --install`
- Node.js 18+ installed **inside WSL** (e.g. via `nvm`) — `npm install` and `npm run dev` run inside WSL
- Git installed inside WSL: `sudo apt install git`
- A git repository stored inside the WSL2 filesystem (e.g. `/home/<user>/projects/parallel-code`)

> **Note:** You do not need Node.js installed on Windows. The Electron app is launched from a Windows terminal but the build tools (`npm`, `node`) must be in your WSL distro because all dev commands run there.

## Dev Setup

```bash
# Inside WSL terminal — clone, install, and run
cd ~
git clone https://github.com/your-org/parallel-code.git
cd parallel-code
npm install
npm run dev   # launches the Electron app via WSL; the window opens on the Windows desktop
```

## Verifying WSL2 Detection

On startup, check the Electron main process logs (DevTools → Console or terminal):

```
WSL2 detected: distro=Ubuntu
```

If WSL2 is not found, the app should display a dialog explaining the requirement.

## Smoke Tests

### 1. Terminal session

1. Open a project (any repo stored in `/home/…` inside WSL)
2. Open a new terminal panel
3. Run `echo $SHELL` — should return a Linux shell path (e.g. `/bin/bash`)
4. Run `git log --oneline -3` — should return git output from WSL git

### 2. Task creation (worktree)

1. Open a project stored in WSL-native storage
2. Create a new task — worktree should appear under `.worktrees/`
3. Open a terminal in the task — working directory should be the worktree root
4. Delete the task — worktree directory should be removed

### 3. Windows-path warning

1. Open a project whose path starts with `/mnt/c/…`
2. App should display a warning about performance and symlink limitations

## macOS/Linux Regression Check

After any Windows-related change, run:

```bash
npm run check   # typecheck + lint + format:check
npm run test    # all Vitest tests
```

All must pass without modification.

## Building the Windows Installer

```bash
# On a Windows machine (or CI):
npm run build
# Produces:
#   dist/Parallel Code Setup x64.exe
#   dist/Parallel Code Setup arm64.exe
```
