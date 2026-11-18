// A surface change from a model is a Proposal: its A2UI messages are held here
// and reach the renderer only when she accepts (pinch / click / "keep").
import type { A2uiMessage } from './surfacePlan';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface SurfaceProposal {
  readonly id: string;
  readonly by: 'nano' | 'gemini' | 'rules';
  readonly summary: string;
  status(): ProposalStatus;
  accept(): boolean;
  reject(): boolean;
}

export function createSurfaceProposal(
  id: string,
  by: SurfaceProposal['by'],
  summary: string,
  messages: A2uiMessage[],
  apply: (messages: A2uiMessage[]) => void,
): SurfaceProposal {
  let status: ProposalStatus = 'pending';
  const held = messages.slice();
  return {
    id, by, summary,
    status: () => status,
    accept() {
      if (status !== 'pending') return false;
      status = 'accepted';
      apply(held);
      return true;
    },
    reject() {
      if (status !== 'pending') return false;
      status = 'rejected';
      return true;
    },
  };
}
