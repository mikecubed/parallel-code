# Tasks: Windows Support via WSL2 Backend

**Input**: Design documents from `/specs/001-windows-wsl-support/`
**Branch**: `001-windows-wsl-support`
**Spec**: spec.md | **Plan**: plan.md | **Research**: research.md | **Data Model**: data-model.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths are included in every description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new helper module and icon asset; amend the constitution.

- [X] T001 Create `electron/lib/` directory and stub `electron/lib/wsl.ts` with exported empty functions `detectWsl()` and `toWslPath()` so downstream modules can import without error
- [X] T002 [P] Add `build/icon.ico` placeholder (256×256 multi-resolution ICO) for the Windows installer — must exist before electron-builder Win32 config is added
- [X] T003 [P] Amend `.specify/memory/constitution.md` Principle V to permit WSL2-gated Windows support; bump version to 2.0.0 and update `LAST_AMENDED_DATE`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the WSL detection and path translation helpers that every downstream task depends on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: All Phase 3–6 tasks import from `electron/lib/wsl.ts`. This phase must be complete first.

- [X] T004 Implement `detectWsl()` in `electron/lib/wsl.ts` — runs `wsl.exe --version` (5 s timeout) to confirm WSL2 presence, then `wsl.exe --list --verbose` to extract the default distro name; returns `{ available: boolean; distro: string }` with full strict TypeScript types; catches all errors and returns `{ available: false, distro: '' }` on failure
- [X] T005 Implement `toWslPath(winPath: string): string` in `electron/lib/wsl.ts` — converts `C:\Users\alice\project` → `/mnt/c/Users/alice/project` using drive-letter regex + backslash replacement; returns POSIX paths unchanged; throw a typed error for unrecognised input
- [X] T006 [P] Write Vitest unit tests for `toWslPath()` in `src/store/` (or nearest test co-location) — test Windows paths, already-POSIX paths, paths with spaces, UNC inputs; tests must pass on Linux CI without a real `wsl.exe`
- [X] T007 [P] Extend `detectWsl()` to also resolve the WSL login-shell PATH via `wsl.exe -d <distro> bash -ilc 'printf "__P__%s__P__" "$PATH"'` and cache it in `process.env.WSL_PATH`; sentinel-parse the output as in `port/windows-native-approach.md`

**Checkpoint**: `electron/lib/wsl.ts` is complete, typed, tested. All exports ready for consumers.

---

## Phase 3: User Story 1 — Install & Launch on Windows (Priority: P1) 🎯 MVP

**Goal**: App opens on Windows, detects WSL2, shows a clear error if WSL2 is absent, and resumes cleanly on relaunch.

**Independent Test**: Install on a clean Windows 11 machine with WSL2 present; app opens main window within 5 s. Remove WSL2; app shows the missing-WSL2 dialog instead of crashing.

### Implementation for User Story 1

- [X] T008 [US1] Update `fixPath()` in `electron/main.ts` — on `win32`, call `detectWsl()` from `electron/lib/wsl.ts`; if WSL2 available, store `process.env.WSL_DISTRO` and `process.env.WSL_PATH`; if unavailable, store `process.env.WSL_DISTRO = ''`; guard the entire block with `process.platform === 'win32'`; leave POSIX branch untouched
- [X] T009 [US1] Add a startup WSL2 guard in `electron/main.ts` — after `fixPath()`, if `process.platform === 'win32'` and `process.env.WSL_DISTRO` is empty, show an Electron `dialog.showMessageBox` with a clear explanation and a link to the WSL2 install page, then call `app.quit()`; no crash, no hang
- [X] T010 [P] [US1] Add `win` and `nsis` build targets to `package.json` `build` section — `{ "target": "nsis", "arch": ["x64", "arm64"] }`, `"icon": "build/icon.ico"`, `nsis: { "oneClick": false, "allowToChangeInstallationDirectory": true }`; verify existing `asarUnpack` entry covers node-pty
- [X] T011 [P] [US1] Add WSL detection branch to `install.sh` — detect `/proc/version` containing `microsoft`; set `OS="Linux"` and continue with the Linux install path; print `"WSL detected — using Linux build path"`

**Checkpoint**: On Windows with WSL2 → app opens. Without WSL2 → dialog shown. macOS/Linux tests still pass (`npm run check && npm run test`).

---

## Phase 4: User Story 2 — Terminal Sessions on Windows (Priority: P2)

**Goal**: A shell prompt appears in the terminal panel within 3 s; commands run inside WSL2; resize works; closing the panel cleanly terminates the child process.

**Independent Test**: Open a project, spawn a terminal, run `echo $SHELL` — returns a Linux shell path. Run `git log --oneline -3` — returns git output from WSL git. Resize the window — no garbled output.

### Implementation for User Story 2

- [X] T012 [US2] Update `spawnAgent()` in `electron/ipc/pty.ts` — on `win32`, prepend `wsl.exe` as the executable and pass `['--', command, ...args.args]`; use `toWslPath(args.cwd)` from `electron/lib/wsl.ts` to translate the working directory; leave POSIX spawn path untouched; no `any` types
- [X] T013 [US2] Add a `win32` shell fallback in `electron/ipc/pty.ts` — if `process.env.SHELL` is unset on Windows (it will be), default the shell to `bash` (resolved through WSL); remove the `|| '/bin/sh'` fallback from the Windows code path since it doesn't exist natively
- [X] T014 [US2] Verify terminal resize path in `electron/ipc/pty.ts` — confirm `pty.resize(cols, rows)` is called unconditionally (it already invokes `ResizePseudoConsole` on Windows via ConPTY); add a guard that `cols >= 1` and `rows >= 1` before calling resize (node-pty issue #877)
- [X] T015 [US2] Update `electron/ipc/register.ts` `validatePath()` — add Win32 absolute path acceptance: `path.isAbsolute(p) || (process.platform === 'win32' && /^[A-Za-z]:[/\\]/.test(p))`; keep the `..` traversal check; add `validateRelativePath` Win32 guard if needed

**Checkpoint**: Terminal panels open on Windows; PTY sessions run inside WSL2; resize works; existing macOS/Linux PTY tests are unaffected.

---

## Phase 5: User Story 3 — Git Worktrees on Windows (Priority: P3)

**Goal**: Creating a task on Windows creates a git worktree; the worktree lives in WSL2-native storage; `node_modules` is symlinked without requiring Developer Mode.

**Independent Test**: Create a new task on Windows with a repo in `/home/…`; `.worktrees/<branch>` appears; opening a terminal in the task shows the correct working directory; deleting the task removes the worktree.

### Implementation for User Story 3

- [X] T016 [US3] Wrap all `exec('git', …)` calls in `electron/ipc/git.ts` with a `win32` delegation helper — on Windows, replace `exec('git', args, { cwd })` with `exec('wsl.exe', ['git', ...args], { cwd: toWslPath(cwd) })`; extract a private `gitExec(args, cwd)` helper that encapsulates this branching so all ~12 call sites become one-liners
- [X] T017 [US3] Add path normalisation in `electron/ipc/git.ts` — after `wsl.exe git` calls that return file paths (e.g. `getChangedFiles`, `getWorktreeStatus`), strip any `/mnt/c/` prefix and re-emit as Windows paths if the consumer expects Windows paths; document in code comments which functions return which path shape
- [X] T018 [US3] Add a Windows-mounted-drive warning in `electron/ipc/tasks.ts` (or `git.ts`) — before `createWorktree()`, if `process.platform === 'win32'` and `projectRoot` starts with `/mnt/`, log a console warning and surface it to the renderer via a resolved value flag (e.g. `{ path, branch, warnMountedDrive: true }`); update the `createTask` IPC handler in `register.ts` to pass the flag back to the renderer
- [X] T019 [P] [US3] Update the `createTask` IPC response type in `electron/ipc/channels.ts` or the relevant type file — add optional `warnMountedDrive?: boolean` to the return shape so the renderer can display a warning toast; update the renderer-side `invoke` call type accordingly in `src/lib/ipc.ts`

**Checkpoint**: Worktrees created and deleted on Windows; symlinks work in WSL-native storage; mounted-drive warning surfaced to UI; macOS/Linux behavior unchanged.

---

## Phase 6: User Story 4 — AI Agent Tasks on Windows (Priority: P4)

**Goal**: An AI agent CLI running inside WSL2 streams output to the Parallel Code UI in real time; stopping the agent terminates the process cleanly.

**Independent Test**: Start a Claude Code (or equivalent) agent task via WSL2 PTY; confirm streaming output appears; stop the agent; confirm process exits and task returns to idle.

### Implementation for User Story 4

- [X] T020 [US4] Audit `electron/ipc/agents.ts` for any hardcoded POSIX-only assumptions (e.g. path construction, env var names) and apply `win32` guards or `toWslPath()` where needed; document any agent CLI that requires WSL2 installation instructions
- [X] T021 [US4] Update `electron/ipc/pty.ts` `spawnEnv` construction — on `win32`, merge `process.env.WSL_PATH` into the `PATH` passed to the WSL PTY so agent CLIs installed in the WSL distro are discoverable; preserve the existing `delete spawnEnv.CLAUDECODE` / session-env cleanup logic

**Checkpoint**: Agent tasks run end-to-end on Windows; streaming output renders correctly; stop/kill works.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, docs, and quality gates.

- [X] T022 [P] Update `README.md` — add a "Windows (via WSL2)" section to the installation instructions, referencing `quickstart.md` for dev setup and noting WSL2 is required
- [X] T023 [P] Update `CLAUDE.md` — add Windows platform notes: WSL2 required, repos should live in WSL-native storage, `electron/lib/wsl.ts` is the platform helper
- [X] T024 Run full quality gates: `npm run check` (typecheck + lint + format:check) and `npm run test` — fix any regressions introduced by this feature; lint budget must stay ≤ 21 warnings
- [ ] T025 Manual smoke test on Windows per `specs/001-windows-wsl-support/quickstart.md` — cover all four scenarios: WSL2 present/absent, terminal spawn, worktree create/delete, agent task

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. T002 and T003 are parallel.
- **Phase 2 (Foundational)**: Depends on Phase 1. T006 and T007 can run in parallel after T004/T005.
- **Phase 3 (US1)**: Depends on Phase 2. T010 and T011 can run in parallel within the phase.
- **Phase 4 (US2)**: Depends on Phase 2. Can start in parallel with Phase 3.
- **Phase 5 (US3)**: Depends on Phase 4 (PTY delegation must work before worktree terminal tests are meaningful). T019 can run in parallel.
- **Phase 6 (US4)**: Depends on Phase 4 (agent tasks run via PTY).
- **Phase 7 (Polish)**: Depends on all user story phases complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2) only — independent
- **US2 (P2)**: Depends on Foundational (Phase 2) only — independent
- **US3 (P3)**: Depends on US2 (needs working PTY for terminal-in-worktree testing)
- **US4 (P4)**: Depends on US2 (agents run via PTY delegation)

### Within Each Phase

- Helper module (`electron/lib/wsl.ts`) must be complete before any IPC handler changes
- `validatePath()` (T015) must be done before worktree/path operations are tested
- Constitution amendment (T003) should be done early to unblock review

---

## Parallel Execution Examples

### Phase 2 (after T004 + T005 complete)
```
Task T006: Vitest unit tests for toWslPath()
Task T007: Extend detectWsl() with PATH resolution
```

### Phase 3 (US1 — after Phase 2 complete)
```
Task T010: Add win/nsis build targets to package.json
Task T011: Add WSL detection branch to install.sh
```

### Phase 5 (US3 — within phase)
```
Task T019: Update IPC response type for warnMountedDrive flag
(while T016, T017, T018 proceed sequentially)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T007)
3. Complete Phase 3: User Story 1 — Install & Launch (T008–T011)
4. **STOP and VALIDATE**: Windows app opens; WSL2 dialog shown when absent; macOS/Linux unaffected
5. Ship Phase 1 installer as a "Preview — requires WSL2" release

### Incremental Delivery

1. Setup + Foundational → WSL helper ready
2. **US1** → Windows installer, WSL detection, startup guard (MVP!)
3. **US2** → Terminal sessions working on Windows
4. **US3** → Worktree / git delegation working on Windows
5. **US4** → Agent tasks working end-to-end on Windows
6. Polish → Docs, smoke test, quality gates

### Single-Developer Sequence

```
T001 → T002/T003 (parallel) → T004 → T005 → T006/T007 (parallel)
→ T008 → T009 → T010/T011 (parallel)   [US1 complete ✓]
→ T012 → T013 → T014 → T015            [US2 complete ✓]
→ T016 → T017 → T018 → T019            [US3 complete ✓]
→ T020 → T021                           [US4 complete ✓]
→ T022/T023 (parallel) → T024 → T025   [Polish complete ✓]
```

---

## Notes

- All new code must be guarded with `process.platform === 'win32'` — POSIX paths must be 100% untouched
- `electron/lib/wsl.ts` is the single source of truth for all WSL interaction — no inline `wsl.exe` calls in other files
- `npm run test` runs on Linux CI — Windows-specific code paths will not execute there; use dependency injection or mocking in unit tests
- Commit after each checkpoint to keep the branch reviewable
- The constitution amendment (T003) must be merged before this branch is reviewed
