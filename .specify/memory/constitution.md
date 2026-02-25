<!--
SYNC IMPACT REPORT
==================
Version change: (new) → 1.0.0
Added sections: Core Principles (I–V), Technology Stack, Development Workflow, Governance
Removed sections: N/A (initial ratification)
Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gates align with principles below
  ✅ .specify/templates/spec-template.md — no changes required; spec format is principle-agnostic
  ✅ .specify/templates/tasks-template.md — no changes required; task structure is principle-agnostic
Follow-up TODOs: None
-->

# Parallel Code Constitution

## Core Principles

### I. Worktree Isolation (NON-NEGOTIABLE)

Every AI agent task MUST operate in its own dedicated git branch and git worktree.
Agents MUST NOT write directly to the main branch during active task execution.
Gitignored directories (e.g., `node_modules`) MUST be symlinked from the main worktree
into each task worktree to avoid redundant installs and disk waste.
Merging a task branch back to main is a deliberate, user-initiated action — never automatic.

**Rationale**: Isolation is the core product promise. Without it, agents conflict, corrupt
state, and produce unreviewable diffs. Every design decision MUST preserve this guarantee.

### II. IPC-Only Frontend–Backend Communication

The renderer process (SolidJS, `src/`) MUST NEVER access Node.js APIs directly.
All communication between renderer and main process MUST flow through the Electron IPC
channel enum defined in `electron/ipc/channels.ts` — the single source of truth for
channel names.

Rules:
- New channels MUST be added to the `IPC` enum first, then registered in
  `electron/ipc/register.ts`, allowlisted in `electron/preload.cjs`, and called via
  `invoke<T>(IPC.Channel, args)` from `src/lib/ipc.ts`.
- IPC arguments MUST be structured-clone-safe (JSON round-trip safe). `Channel` instances
  MUST serialize via `toJSON()`.
- All IPC handlers that accept paths or branch names MUST call `validatePath`,
  `validateRelativePath`, or `validateBranchName` before use.
- The main process MUST verify at startup that the preload allowlist stays in sync
  with the `IPC` enum.

**Rationale**: The IPC boundary enforces security, testability, and a clear contract
between the two processes. Bypassing it creates untraceable side effects.

### III. Strict TypeScript — No Exceptions

All TypeScript MUST be compiled with `strict: true`. The `any` type is PROHIBITED.
Frontend code MUST use functional SolidJS components with signals and stores — no class
components, no React-style hooks. ESLint (`@typescript-eslint/strict`) violations MUST
be resolved before merging (max 21 warnings is the lint budget; do not increase it).

**Rationale**: `strict: true` and no `any` eliminate entire categories of runtime errors
in an Electron app where renderer crashes are disruptive and hard to debug remotely.

### IV. Automated Quality Gates (NON-NEGOTIABLE)

The following MUST pass before any branch is merged to main:

1. `npm run typecheck` — zero TypeScript errors
2. `npm run lint` — within the 21-warning budget
3. `npm run format:check` — Prettier-compliant
4. `npm run test` — all Vitest tests green

Running `npm run check` executes steps 1–3 together. These gates are not optional under
any circumstance, including "quick fixes" or "trivial changes".

**Rationale**: The gates exist because each check catches a different class of defect.
Skipping one in a hurry is how regressions ship to end users who cannot hotfix easily.

### V. Platform Focus — macOS and Linux Only

Parallel Code targets macOS and Linux exclusively. Windows MUST NOT be supported.
Platform-specific behavior (PTY handling, file paths, shell detection) MUST be isolated
to dedicated modules and clearly documented. No platform-detection hacks scattered
through business logic.

**Rationale**: Maintaining three platforms with a two-process Electron + PTY architecture
adds disproportionate complexity for a tool aimed at developers already on unix-like
systems. Scope focus enables higher quality on supported platforms.

## Technology Stack

- **Frontend**: SolidJS, TypeScript (strict), Vite
- **Backend**: Node.js, Electron, node-pty
- **Testing**: Vitest (runs outside browser; mock SolidJS reactivity — see
  `src/store/taskStatus.test.ts` for the pattern)
- **Linting/Formatting**: ESLint (`@typescript-eslint/strict`), Prettier
  (single quotes, semicolons, trailing commas, print width 100, 2-space indent)
- **Package manager**: npm (no yarn, no pnpm)
- **Builds**: two Vite configs (renderer + remote UI) + one tsc compile for main process

New dependencies MUST be justified. Prefer the standard library or an existing dependency
before introducing a new one.

## Development Workflow

- **Branch naming**: task branches use the project's `branchPrefix` (default: `"task"`).
  Branch names MUST NOT start with `-`.
- **State management**: all app state lives in `src/store/`. Import exclusively from
  `src/store/store.ts` (barrel re-export). Use `produce` from `solid-js/store` for
  complex nested mutations.
- **Commit discipline**: commits MUST be atomic and scoped. Prefer small, reviewable
  commits over large squashes.
- **Remote UI**: the phone monitoring SPA lives in `src/remote/` and is built separately
  (`npm run build:remote` → `dist-remote/`). Changes to the remote UI MUST not break
  the main renderer build.

## Governance

This constitution supersedes all other practices documented in the repository.
Conflicts between this document and other guidance files MUST be resolved in favour of
the constitution.

**Amendment procedure**:
1. Open a PR with proposed changes to `.specify/memory/constitution.md`.
2. Bump `CONSTITUTION_VERSION` according to semantic versioning rules defined in the
   speckit tooling (MAJOR for breaking governance changes, MINOR for additions,
   PATCH for clarifications).
3. Update `LAST_AMENDED_DATE` to the amendment date.
4. Run the consistency propagation checklist (templates, README, CLAUDE.md) and resolve
   any conflicts before merging.

**Compliance review**: All PRs MUST verify principle compliance as part of code review.
Complexity violations (e.g., bypassing IPC, adding `any`) MUST be justified in the PR
description with a documented rationale and a plan to remediate.

Use `CLAUDE.md` for runtime agent guidance. Use this constitution for durable engineering
principles.

**Version**: 1.0.0 | **Ratified**: 2026-02-25 | **Last Amended**: 2026-02-25
