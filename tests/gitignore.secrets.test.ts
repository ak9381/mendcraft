// Guard: secret-bearing files must stay untracked. This test never reads
// .env.local, .env.production, or token files — it only checks .gitignore,
// `git check-ignore --no-index`, and `git ls-files`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gitignore = readFileSync('.gitignore', 'utf8');

function isIgnoredByPattern(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', path], { stdio: 'ignore' });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return false;
    throw err;
  }
}

function isTracked(path: string): boolean {
  const out = execFileSync('git', ['ls-files', '--', path], { encoding: 'utf8' }).trim();
  return out.length > 0;
}

describe('secret files stay gitignored', () => {
  it('.gitignore lists .env.local, .env*, !.env.example, and .secrets/', () => {
    const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain('.env.local');
    expect(lines).toContain('.env*');
    expect(lines).toContain('!.env.example');
    expect(lines).toContain('.secrets/');
  });

  it('git check-ignore --no-index matches env/secret paths and keeps .env.example visible', () => {
    expect(isIgnoredByPattern('.env.local')).toBe(true);
    expect(isIgnoredByPattern('.env.production')).toBe(true);
    expect(isIgnoredByPattern('.secrets/mendcraft-appcheck-debug')).toBe(true);
    expect(isIgnoredByPattern('.env.example')).toBe(false);
  });

  // main tracks .env.production on purpose: it holds only the public Spotify
  // PKCE client id (c38c480). It is still matched by the ignore patterns above.
  it('does not track .env.local; .env.example stays tracked', () => {
    expect(isTracked('.env.local')).toBe(false);
    expect(isTracked('.env.example')).toBe(true);
  });
});
