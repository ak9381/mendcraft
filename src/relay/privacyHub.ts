// Attach the privacy-router hub to a desktop host session: a phone ask is
// cleaned (rules + optional Nano), sent to Gemini redacted, filled, and
// replied with the route line and byte count.
import { runHubPrivacyJob, type PrivacyAsk, type PrivacyReply } from '../ai/privacyRouter';
import type { Person } from '../privacy/directory';

export interface PrivacyHubHost {
  onPrivacyAsk(cb: (ask: PrivacyAsk) => void): void;
  sendPrivacyReply(reply: PrivacyReply): Promise<void>;
}

export function attachPrivacyHub(
  host: PrivacyHubHost,
  people: () => readonly Person[],
  gemini: (redacted: string) => Promise<string>,
  opts: Parameters<typeof runHubPrivacyJob>[3] = {},
): void {
  host.onPrivacyAsk((ask) => {
    void runHubPrivacyJob(ask, people(), gemini, opts)
      .then((reply) => host.sendPrivacyReply(reply))
      .catch((err) =>
        host.sendPrivacyReply({
          jobId: ask.jobId,
          text: '',
          routeLine: 'routed via Mac: Nano cleaned, then Gemini',
          sentBytes: 0,
          cleaned: false,
          error: err instanceof Error ? err.message.slice(0, 200) : 'hub failed',
        }),
      )
      // The transport that failed the job is often the same one that would
      // carry this reply — if it rejects too, log instead of an unhandled
      // rejection, so the phone at least has a chance to time out visibly.
      .catch((err) => console.error('[mendcraft] privacy hub: could not send reply', err));
  });
}
