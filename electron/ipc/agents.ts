import { execFileSync } from 'child_process';

interface AgentDef {
  id: string;
  name: string;
  command: string;
  args: string[];
  resume_args: string[];
  skip_permissions_args: string[];
  description: string;
  available?: boolean;
}

const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    resume_args: ['--continue'],
    skip_permissions_args: ['--dangerously-skip-permissions'],
    description: "Anthropic's Claude Code CLI agent",
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    args: [],
    resume_args: ['resume', '--last'],
    skip_permissions_args: ['--full-auto'],
    description: "OpenAI's Codex CLI agent",
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    resume_args: ['--resume', 'latest'],
    skip_permissions_args: ['--yolo'],
    description: "Google's Gemini CLI agent",
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: [],
    resume_args: [],
    skip_permissions_args: [],
    description: 'Open source AI coding agent (opencode.ai)',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    command: 'copilot',
    args: [],
    resume_args: ['--continue'],
    skip_permissions_args: ['--yolo'],
    description: "GitHub's Copilot CLI agent",
  },
];

function isCommandAvailable(command: string): boolean {
  const finder = process.platform === 'win32' && !process.env.WSL_DISTRO ? 'where.exe' : 'which';
  try {
    execFileSync(finder, [command], { encoding: 'utf8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// TTL cache to avoid blocking the main thread with repeated `which` calls
let cachedAgents: AgentDef[] | null = null;
let cacheTime = 0;
const AGENT_CACHE_TTL = 30_000;

export function listAgents(): AgentDef[] {
  const now = Date.now();
  if (cachedAgents && now - cacheTime < AGENT_CACHE_TTL) {
    return cachedAgents;
  }

  cachedAgents = DEFAULT_AGENTS.map((agent) => ({
    ...agent,
    available: isCommandAvailable(agent.command),
  }));
  cacheTime = now;
  return cachedAgents;
}

export interface ShellOption {
  /** Identifies which spawn branch to use in pty.ts */
  id: 'wsl2' | 'pwsh' | 'powershell';
  /** Human-readable label shown in the UI */
  label: string;
}

/**
 * Returns the available shell options on the current machine.
 * On macOS/Linux this always returns an empty array (native SHELL is used there).
 * On Windows it returns options based on what was detected at startup.
 */
export function listShells(): ShellOption[] {
  if (process.platform !== 'win32') return [];

  const shells: ShellOption[] = [];

  if (process.env.WSL_DISTRO) {
    shells.push({ id: 'wsl2', label: `WSL2 — ${process.env.WSL_DISTRO}` });
  }

  if (process.env.PS_EXE) {
    if (process.env.PS_VARIANT === 'pwsh') {
      const ver = process.env.PS_VERSION ? ` ${process.env.PS_VERSION}` : '';
      shells.push({ id: 'pwsh', label: `PowerShell 7${ver}` });
    } else if (process.env.PS_VARIANT === 'powershell') {
      const ver = process.env.PS_VERSION ? ` ${process.env.PS_VERSION}` : '';
      shells.push({ id: 'powershell', label: `Windows PowerShell${ver}` });
    }
  }

  return shells;
}
