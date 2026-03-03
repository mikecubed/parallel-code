# Parallel Code

Electron desktop app — SolidJS frontend, Node.js backend. Published for **macOS, Linux, and Windows (via WSL2)**.

## Stack

- **Frontend:** SolidJS, TypeScript (strict), Vite
- **Backend:** Node.js (Electron, node-pty)
- **Package manager:** npm

## Commands

- `npm run dev` — start Electron app in dev mode
- `npm run build` — build production Electron app
- `npm run typecheck` — run TypeScript type checking

## Project Structure

- `src/` — SolidJS frontend (components, store, IPC, lib)
- `src/lib/` — frontend utilities (IPC wrappers, window management, drag, zoom)
- `electron/` — Electron main process (IPC handlers, preload)
- `electron/ipc/` — backend IPC handlers (pty, git, tasks, persistence)
- `electron/lib/` — platform helpers (e.g. `wsl.ts` for WSL2 detection and path translation)
- `src/store/` — app state management

## Conventions

- Functional components only (SolidJS signals/stores, no classes)
- Electron IPC for all frontend-backend communication
- IPC channel names defined in `electron/ipc/channels.ts` (shared enum)
- `strict: true` TypeScript, no `any`

## Windows Platform Notes

- **WSL2 is required** — the app shows a dialog and quits if WSL2 is not found at startup
- **Repos should live in WSL-native storage** (`/home/<user>/…`) — repos under `/mnt/c/…` have 10–50× slower git I/O and require Developer Mode for symlinks
- **`electron/lib/wsl.ts` is the single source of truth** for all WSL2 interaction — `detectWsl()` for detection, `toWslPath()` for path translation; no inline `wsl.exe` calls elsewhere
- All Windows-specific code is gated with `process.platform === 'win32'` — POSIX code paths are 100% untouched
