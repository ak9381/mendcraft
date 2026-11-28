// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mountAskCard } from '../../src/canvas/askCard';

describe('ask card choices', () => {
  it('first choice is the thumbs-up button at the top; something else is thumbs-down; yes/no comes back after', () => {
    const root = document.createElement('div');
    const yn: string[] = [];
    const card = mountAskCard(root, { yes: () => yn.push('yes'), no: () => yn.push('no') });
    const picks: number[] = [];
    card.showChoices('Did you mean:', ['Status board', 'Dashboard', 'Floor plan'], 'Something else', (i) => picks.push(i));
    const list = [...root.querySelectorAll('.mc-ask-choices button')].map((b) => b.textContent);
    expect(list).toEqual(['Status board', 'Dashboard', 'Floor plan']);
    expect(root.querySelector('.mc-ask-choices .mc-review-approve')?.textContent).toBe('Status board');
    (root.querySelectorAll('.mc-ask-choices button')[2] as HTMLButtonElement).click();
    (root.querySelector('.mc-review-reject') as HTMLButtonElement).click();
    expect(picks).toEqual([2, -1]);
    card.show('Is the gimbal switched on?');
    expect(root.querySelector('.mc-ask-yes')?.textContent).toBe('Yes');
    (root.querySelector('.mc-ask-yes') as HTMLButtonElement).click();
    expect(yn).toEqual(['yes']);
    expect((root.querySelector('.mc-ask-choices') as HTMLElement).hidden).toBe(true);
  });
});
