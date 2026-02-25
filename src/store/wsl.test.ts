import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process so tests pass on Linux CI without a real wsl.exe
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

import { toWslPath, detectWsl } from '../../electron/lib/wsl';

// ---------------------------------------------------------------------------
// toWslPath
// ---------------------------------------------------------------------------
describe('toWslPath', () => {
  it('converts a Windows C: path to /mnt/c/', () => {
    expect(toWslPath('C:\\Users\\alice\\project')).toBe('/mnt/c/Users/alice/project');
  });

  it('converts a lowercase drive letter', () => {
    expect(toWslPath('d:\\repos\\myapp')).toBe('/mnt/d/repos/myapp');
  });

  it('converts Windows path using forward slashes', () => {
    expect(toWslPath('C:/Users/alice/project')).toBe('/mnt/c/Users/alice/project');
  });

  it('converts a path with spaces', () => {
    expect(toWslPath('C:\\Users\\Alice Smith\\My Project')).toBe(
      '/mnt/c/Users/Alice Smith/My Project',
    );
  });

  it('converts a drive root (trailing backslash)', () => {
    expect(toWslPath('C:\\')).toBe('/mnt/c/');
  });

  it('returns a POSIX absolute path unchanged', () => {
    expect(toWslPath('/home/alice/project')).toBe('/home/alice/project');
  });

  it('returns a WSL native path unchanged', () => {
    expect(toWslPath('/mnt/c/already/posix')).toBe('/mnt/c/already/posix');
  });

  it('returns root / unchanged', () => {
    expect(toWslPath('/')).toBe('/');
  });

  it('normalizes consecutive backslashes', () => {
    expect(toWslPath('C:\\\\Users\\alice')).toBe('/mnt/c/Users/alice');
  });

  it('normalizes mixed consecutive separators', () => {
    expect(toWslPath('C://Users//alice')).toBe('/mnt/c/Users/alice');
  });

  it('throws TypeError for UNC paths', () => {
    expect(() => toWslPath('\\\\server\\share')).toThrow(TypeError);
  });

  it('throws TypeError for relative paths', () => {
    expect(() => toWslPath('relative/path')).toThrow(TypeError);
  });

  it('throws TypeError for empty string', () => {
    expect(() => toWslPath('')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// detectWsl — behaviour on non-win32 platform (always the case on Linux CI)
// ---------------------------------------------------------------------------
describe('detectWsl (non-win32)', () => {
  beforeEach(() => {
    vi.stubEnv('WSL_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns available=false on non-Windows platforms', () => {
    // On Linux CI, process.platform is 'linux', so detectWsl() returns early
    if (process.platform !== 'win32') {
      const result = detectWsl();
      expect(result).toEqual({ available: false, distro: '' });
    }
  });
});
