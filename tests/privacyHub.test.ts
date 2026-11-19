import { describe, expect, it } from 'vitest';
import { attachPrivacyHub } from '../src/relay/privacyHub';
import type { PrivacyAsk, PrivacyReply } from '../src/ai/privacyRouter';
import type { Person } from '../src/privacy/directory';

const priya: Person = {
  id: 'p1', name: 'Priya Rao', role: 'client', token: '[Client A]', notes: [], createdAt: 0,
};

describe('attachPrivacyHub', () => {
  it('cleans a phone ask on the hub and replies with the real name filled back', async () => {
    let handler: ((ask: PrivacyAsk) => void) | null = null;
    const replies: PrivacyReply[] = [];
    attachPrivacyHub(
      {
        onPrivacyAsk: (cb) => { handler = cb; },
        sendPrivacyReply: async (r) => { replies.push(r); },
      },
      () => [priya],
      async (redacted) => {
        expect(redacted).toContain('[Client A]');
        expect(redacted).not.toContain('Priya');
        return 'Hello [Client A]';
      },
    );
    handler!({ jobId: 'pv-h', text: 'Write to Priya Rao' });
    await new Promise((r) => setTimeout(r, 0));
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toBe('Hello Priya Rao');
    expect(replies[0]!.cleaned).toBe(true);
    expect(replies[0]!.routeLine).toContain('routed via Mac');
    expect(replies[0]!.sentBytes).toBeGreaterThan(0);
  });
});
