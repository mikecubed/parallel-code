# Data Model: Windows WSL2 Support

## Overview

This feature introduces no new persistent data entities. All app state, task, project, and agent models are unchanged. The changes are purely behavioral — adding platform-detection and path-translation logic to the Electron main process.

## New Runtime State (non-persistent)

These values are computed once at app startup and cached in `process.env` for the lifetime of the process. They are never serialized to disk.

### WslEnvironment

Computed by `detectWsl()` in `electron/main.ts` during startup.

| Field | Type | Description |
|-------|------|-------------|
| `available` | `boolean` | Whether WSL2 is present and functional |
| `distro` | `string` | Name of the default WSL2 distro (e.g. `"Ubuntu"`) |
| `wslPath` | `string` | Colon-separated PATH resolved from the WSL2 login shell |

Cached as:
- `process.env.WSL_DISTRO` — distro name
- `process.env.WSL_PATH` — WSL-resolved PATH

### Path Shapes

No new entities, but two path shapes must be handled consistently throughout the codebase:

| Shape | Example | Context |
|-------|---------|---------|
| Windows absolute path | `C:\Users\alice\project` | Passed in from renderer on Win32 |
| WSL mount path | `/mnt/c/Users/alice/project` | Derived from Windows path for WSL operations |
| WSL native path | `/home/alice/project` | Preferred storage; no translation needed |

## State Transitions

No new state machines. Existing task lifecycle (pending → running → done) is unaffected.

## Schema Compatibility

No migrations required. The `AppState` persistence schema in `electron/ipc/persistence.ts` is unchanged.
