# Feature Specification: Windows Support via WSL2 Backend

**Feature Branch**: `001-windows-wsl-support`  
**Created**: 2026-02-25  
**Status**: Draft  
**Input**: Native Windows Electron app with all POSIX operations (PTY, git, shell) delegated to a WSL2 distro backend.

## Overview

Enable Parallel Code to run as a native Windows desktop application by routing all shell, terminal, and git operations through WSL2. Windows users install the app normally and interact with it identically to macOS/Linux users, with WSL2 acting as the invisible POSIX execution layer beneath the native Windows UI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and Launch on Windows (Priority: P1)

A Windows user downloads and installs the Parallel Code installer. They launch the app and it opens as a native Windows window. The app detects their WSL2 installation and starts working without manual configuration.

**Why this priority**: This is the entry point for all Windows usage — no other Windows feature matters if the app cannot open and initialize correctly.

**Independent Test**: Can be fully tested by installing the app on a clean Windows 11 machine with WSL2 present, launching it, and verifying the main window opens and shows no errors.

**Acceptance Scenarios**:

1. **Given** WSL2 is installed and a default distro is configured, **When** the user launches Parallel Code, **Then** the app opens its main window within 5 seconds and all UI elements are functional.
2. **Given** WSL2 is not installed, **When** the user launches Parallel Code, **Then** the app displays a clear, actionable message explaining that WSL2 is required and how to install it.
3. **Given** a user re-launches the app after initial setup, **When** the app starts, **Then** it resumes to the last-used state without re-running first-time detection.

---

### User Story 2 - Open a Terminal Session on Windows (Priority: P2)

A Windows developer opens a project in Parallel Code and launches a terminal panel. They get a fully functional Linux shell running inside their WSL2 distro, capable of running any CLI tool they have installed there.

**Why this priority**: Terminal/PTY functionality is core to Parallel Code's value proposition. Without working terminals, the app is not usable for its primary purpose.

**Independent Test**: Can be fully tested by opening a project, spawning a terminal, running `echo hello` and a git command, and confirming output appears correctly.

**Acceptance Scenarios**:

1. **Given** a project is open, **When** the user opens a new terminal panel, **Then** a shell prompt appears and accepts commands within 3 seconds.
2. **Given** an active terminal, **When** the user types a command and presses Enter, **Then** output is displayed correctly with full colour and formatting support.
3. **Given** an active terminal, **When** the user resizes the window, **Then** the terminal adjusts to the new dimensions without garbled output.
4. **Given** a terminal running a long process, **When** the user closes the terminal panel, **Then** the child process is cleanly terminated.

---

### User Story 3 - Manage Git Worktrees on Windows (Priority: P3)

A Windows developer creates a task in Parallel Code. The app creates a git worktree for that task and symlinks shared directories (e.g. `node_modules`) as on macOS/Linux.

**Why this priority**: Worktree and git operations are essential for the parallel task workflow but depend on a working terminal layer (P2) and can be phased in after initial Windows support lands.

**Independent Test**: Can be tested by creating a new task on a Windows machine with a repository stored inside the WSL2 filesystem, verifying the worktree directory is created and `node_modules` is symlinked.

**Acceptance Scenarios**:

1. **Given** a git repository stored in the WSL2 filesystem, **When** the user creates a new task, **Then** a git worktree is created and the task appears in the task list.
2. **Given** a worktree was created, **When** the user opens a terminal in that task, **Then** the working directory is the worktree root inside WSL2.
3. **Given** the user deletes a task, **When** the deletion completes, **Then** the git worktree is removed and no orphaned directories remain.

---

### User Story 4 - Run an AI Agent Task on Windows (Priority: P4)

A Windows user assigns an AI agent to a task. The agent CLI runs inside WSL2 and its output streams to the Parallel Code UI in real time, identical to the macOS/Linux experience.

**Why this priority**: AI agent execution builds on all prior layers. It validates end-to-end integration but is not the MVP gate.

**Independent Test**: Can be tested by running a supported AI CLI (e.g. Claude Code) inside a WSL2 terminal session spawned by Parallel Code and confirming streaming output renders correctly.

**Acceptance Scenarios**:

1. **Given** an AI agent CLI is installed in the WSL2 distro, **When** the user starts an agent task, **Then** streaming output appears in the task panel in real time.
2. **Given** an agent is running, **When** the user stops the agent, **Then** the agent process is terminated and the task returns to idle state.

---

### Edge Cases

- What happens when the user's WSL2 default distro is changed after Parallel Code is already running?
- What happens when a repository is on a Windows drive (`C:\`) rather than inside the WSL2 filesystem — does the user see a warning about performance/symlink limitations?
- What happens when the user's WSL2 distro does not have `git` installed?
- How does the app handle a Windows path containing spaces or non-ASCII characters when translating to a WSL2 path?
- What happens if the WSL2 distro is stopped or restarted while Parallel Code has open terminal sessions?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST ship a native Windows installer (NSIS) targeting x64 and arm64 architectures.
- **FR-002**: On first launch, the app MUST detect whether WSL2 is available and which distro is set as default.
- **FR-003**: When WSL2 is absent, the app MUST display a user-facing message explaining the requirement and providing guidance to install WSL2.
- **FR-004**: All terminal/PTY sessions on Windows MUST execute inside the WSL2 default distro, presenting a Linux shell to the user.
- **FR-005**: The app MUST translate Windows absolute paths to WSL2-compatible paths when passing working directories to shell or git operations.
- **FR-006**: All git operations on Windows MUST execute via the `git` binary inside the WSL2 distro (not Git for Windows).
- **FR-007**: Path validation MUST accept Windows absolute paths (e.g. `C:\Users\…`) in addition to POSIX paths, rejecting relative or traversal paths.
- **FR-008**: The app MUST symlink shared directories (e.g. `node_modules`) inside the WSL2 filesystem where repositories reside.
- **FR-009**: When a repository is located on a Windows-mounted drive (e.g. `/mnt/c/…`), the app MUST warn the user about reduced performance and symlink limitations and recommend storing repos inside WSL2 native storage.
- **FR-010**: Terminal sessions MUST support full colour rendering and dynamic resize on Windows.
- **FR-011**: The WSL bridge path resolution MUST complete within 5 seconds on app startup; failure MUST be caught and surfaced gracefully rather than hanging the UI.
- **FR-012**: The existing macOS and Linux behaviour MUST be entirely unaffected by all Windows-specific code paths.

### Key Entities

- **WSL Distro**: The WSL2 Linux distribution used as the execution backend; has a name, filesystem root, and default status.
- **WSL Path**: A Linux-style absolute path within the WSL2 distro's filesystem (e.g. `/home/user/project` or `/mnt/c/…`).
- **Windows Path**: A native Windows absolute path (e.g. `C:\Users\alice\project`).
- **PTY Session**: A pseudo-terminal process running inside the WSL2 distro, proxied to the Electron renderer via IPC.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Windows users can install the app and reach a functional main window in under 2 minutes on a machine with WSL2 already installed.
- **SC-002**: Terminal sessions on Windows spawn and display a shell prompt within 3 seconds of being opened.
- **SC-003**: All existing macOS and Linux automated tests continue to pass without modification after Windows support is added.
- **SC-004**: A Windows user with no prior knowledge of WSL2 can understand and act on the WSL2-required error message without consulting external documentation.
- **SC-005**: Creating, using, and deleting a task (including worktree lifecycle) on Windows produces the same user-observable outcome as on macOS or Linux.
- **SC-006**: No regressions: all features available to macOS/Linux users remain available and functionally identical after this change.

## Assumptions

- WSL2 (not WSL1) is the target; WSL1 compatibility is out of scope.
- The user's WSL2 default distro has `bash` and `git` installed; if not, the app surfaces an actionable error.
- Repositories are assumed to be stored inside the WSL2 native filesystem for optimal performance; Windows-mounted paths are supported with a warning but are not the primary tested path.
- The Windows minimum target is Windows 10 21H2 (WSL2 GA) and Windows 11; earlier versions of Windows are out of scope.
- Developer Mode or Administrator elevation is not required for the primary happy path when repos reside in WSL2 native storage.
- A phased rollout is acceptable: Phase 1 (installer + WSL detection), Phase 2 (PTY delegation), Phase 3 (git delegation + worktrees).
