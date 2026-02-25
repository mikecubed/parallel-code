# Copilot Instructions

Electron desktop app — SolidJS frontend, Node.js backend. macOS and Linux only (no Windows support).

## Commands

```sh
npm run dev          # start Electron app in dev mode
npm run typecheck    # TypeScript type checking (no emit)
npm run lint         # ESLint (max 21 warnings)
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check
npm run test         # vitest run (all tests)
npm run check        # typecheck + lint + format:check
npm run build        # full production build
```

**Run a single test file:**
```sh
npx vitest run src/store/taskStatus.test.ts
```

Tests live in `src/**/*.test.ts` and run with Vitest outside a browser (mock SolidJS reactivity in tests — see `taskStatus.test.ts` for the pattern).

## Architecture

### Two processes

- **Renderer** (`src/`) — SolidJS UI, runs in Chromium. No direct Node.js access.
- **Main** (`electron/`) — Node.js/Electron. Spawns PTYs, runs git, manages worktrees, serves the remote web UI.

Communication is exclusively via Electron IPC. The preload script (`electron/preload.cjs`) exposes `window.electron.ipcRenderer` with an allowlist of channels.

### IPC channel contract

`electron/ipc/channels.ts` defines the `IPC` enum — the **single source of truth** for channel names. When adding a new IPC call:
1. Add the channel to the `IPC` enum in `channels.ts`
2. Register the handler in `electron/ipc/register.ts` with `ipcMain.handle(IPC.YourChannel, ...)`
3. Add the string value to `ALLOWED_CHANNELS` in `electron/preload.cjs`
4. Call from the frontend via `invoke<ReturnType>(IPC.YourChannel, args)` from `src/lib/ipc.ts`

The main process verifies at startup that `preload.cjs` allowlist stays in sync with the enum.

### Frontend state (SolidJS store)

`src/store/store.ts` is a barrel re-export. The actual state lives in domain modules:
- `core.ts` — the `[store, setStore]` pair (SolidJS `createStore`)
- `tasks.ts`, `projects.ts`, `agents.ts`, `terminals.ts` — domain actions
- `navigation.ts`, `focus.ts` — UI navigation state
- `persistence.ts` — load/save app state via IPC

Always import from `src/store/store.ts`, not from individual domain modules directly.

### Remote access

`electron/remote/server.ts` runs an Express + WebSocket server that mirrors agent terminal output to a phone browser. The frontend SPA for this lives in `src/remote/` and is built separately (`npm run build:remote` → `dist-remote/`).

### Two Vite builds + one tsc compile

- `electron/vite.config.electron.ts` — renderer + Electron main
- `src/remote/vite.config.ts` — phone remote UI
- `electron/tsconfig.json` — compiles main process to `dist-electron/`

## Key Conventions

- **SolidJS only, no classes.** Use signals and stores; no React-style hooks or class components.
- **`strict: true` TypeScript, no `any`.** ESLint uses `@typescript-eslint/strict` rules.
- **IPC args as plain objects.** `invoke()` does a JSON round-trip (`JSON.parse(JSON.stringify(args))`), so args must be structured-clone-safe. `Channel` instances serialize via `toJSON()` to `{ __CHANNEL_ID__: id }`.
- **Input validation in `register.ts`.** All IPC handlers that accept paths or branch names call `validatePath` / `validateRelativePath` / `validateBranchName` before use.
- **Prettier config:** single quotes, semicolons, trailing commas (all), print width 100, 2-space indent.
- **Branch naming:** tasks get branches prefixed with the project's `branchPrefix` (default: `"task"`). Branch names must not start with `-`.
- **Worktrees:** each task gets a git worktree; gitignored dirs (e.g. `node_modules`) are symlinked in from the main worktree.
- **`produce` from `solid-js/store`** is used for complex nested state mutations.
