// A7-010: a failed teach recording (camera lost / unclean reading) offers a
// hand- and mouse-reachable "Try again" next to Close, not a dead end.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/canvas/teachPanel.ts', 'utf8');

describe('teach failure offers Try again (A7-010)', () => {
  it('failActions renders Try again + Close and Try again starts a fresh session', () => {
    const body = src.slice(src.indexOf('function failActions()'), src.indexOf('async function open()'));
    expect(body).toContain('data-act="retry">Try again</button>');
    expect(body).toContain("addEventListener('click', () => { void open(); })");
  });
  it('both failure paths use it (camera lost and unclean reading)', () => {
    const openBody = src.slice(src.indexOf('async function open()'), src.indexOf('function openList()'));
    expect(openBody.match(/failActions\(\);/g)).toHaveLength(2);
  });
});
