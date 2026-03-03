import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process so tests pass on Linux CI without real pwsh.exe / powershell.exe
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
import { detectPowerShell } from '../../electron/lib/powershell';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

describe('detectPowerShell (non-win32)', () => {
  it('returns available=false immediately on non-Windows platforms', () => {
    // On Linux CI, process.platform is 'linux' — should return early without calling execFileSync
    if (process.platform !== 'win32') {
      const result = detectPowerShell();
      expect(result).toEqual({ available: false, exePath: '', variant: '', version: '' });
      expect(mockExecFileSync).not.toHaveBeenCalled();
    }
  });
});

describe('detectPowerShell (win32 simulation)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Simulate win32 environment
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
  });

  it('detects PowerShell 7 (pwsh) when available', () => {
    mockExecFileSync.mockReturnValueOnce('7.4.1\n');

    const result = detectPowerShell();

    expect(result.available).toBe(true);
    expect(result.variant).toBe('pwsh');
    expect(result.exePath).toBe('pwsh.exe');
    expect(result.version).toBe('7.4.1');
  });

  it('falls back to Windows PowerShell 5.1 (powershell) when pwsh is unavailable', () => {
    // First call (pwsh.exe) throws; second call (powershell.exe) succeeds
    mockExecFileSync
      .mockImplementationOnce(() => {
        throw new Error('not found');
      })
      .mockReturnValueOnce('5.1.19041.2364\n');

    const result = detectPowerShell();

    expect(result.available).toBe(true);
    expect(result.variant).toBe('powershell');
    expect(result.exePath).toBe('powershell.exe');
    expect(result.version).toBe('5.1.19041.2364');
  });

  it('returns available=false when neither pwsh nor powershell is found', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = detectPowerShell();

    expect(result).toEqual({ available: false, exePath: '', variant: '', version: '' });
  });

  it('trims whitespace from the version string', () => {
    mockExecFileSync.mockReturnValueOnce('  7.4.2  \n');

    const result = detectPowerShell();

    expect(result.version).toBe('7.4.2');
  });

  it('passes correct args to execFileSync for pwsh detection', () => {
    mockExecFileSync.mockReturnValueOnce('7.4.1');

    detectPowerShell();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'pwsh.exe',
      ['-NoLogo', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      expect.objectContaining({ encoding: 'utf8', timeout: 5000 }),
    );
  });
});
