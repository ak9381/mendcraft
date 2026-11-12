// Deterministic UI templates: each returns a compact screen DOCUMENT that
// expandUiDocument() turns into a validated Frame (same path as the cloud
// generator — code owns all ids). These back both the rules fallback ("login
// screen" with no AI) and the cloud generate path's fallback.

import { expandUiDocument } from './ai';
import type { Frame, FramePreset } from './doc';

export type UiTemplateName = 'login' | 'landing' | 'pricing';

export const UI_TEMPLATE_NAMES: readonly UiTemplateName[] = ['login', 'landing', 'pricing'] as const;

export function isUiTemplateName(v: unknown): v is UiTemplateName {
  return typeof v === 'string' && (UI_TEMPLATE_NAMES as readonly string[]).includes(v);
}

/** A believable mobile login: heading, email, password, a blue sign-in button. */
function login(preset: FramePreset): Record<string, unknown> {
  return {
    preset,
    padding: 32,
    gap: 16,
    align: 'stretch',
    justify: 'center',
    nodes: [
      { type: 'text', role: 'heading', text: 'Welcome back', size: 30 },
      { type: 'text', role: 'body', text: 'Sign in to continue', color: 'slate' },
      { type: 'input', inputType: 'email', label: 'Email', placeholder: 'you@example.com' },
      { type: 'input', inputType: 'password', label: 'Password', placeholder: '••••••••' },
      { type: 'button', label: 'Sign in', fill: 'blue' },
      { type: 'text', role: 'body', text: 'Forgot password?', color: 'blue' },
    ],
  };
}

/** A desktop landing hero: big heading, subhead, CTA button, hero image. */
function landing(): Record<string, unknown> {
  return {
    preset: 'desktop',
    padding: 64,
    gap: 20,
    align: 'center',
    justify: 'center',
    nodes: [
      { type: 'text', role: 'heading', text: 'Design hands-free.', size: 56 },
      { type: 'text', role: 'body', text: 'Pinch to point, speak the value. Export real HTML.', size: 20, color: 'slate' },
      { type: 'button', label: 'Get started', fill: 'blue' },
      { type: 'image', w: 720, h: 320 },
    ],
  };
}

/** A pricing section: a heading over a row of three cards. */
function pricing(): Record<string, unknown> {
  const card = (name: string, price: string, cta: string, fill?: string): Record<string, unknown> => ({
    type: 'stack', direction: 'column', gap: 12, padding: 24, align: 'stretch', fill: 'white', radius: 12,
    children: [
      { type: 'text', role: 'heading', text: name, size: 22 },
      { type: 'text', role: 'heading', text: price, size: 36 },
      { type: 'text', role: 'body', text: 'per month', color: 'slate' },
      { type: 'button', label: cta, fill: fill ?? 'slate' },
    ],
  });
  return {
    preset: 'desktop',
    padding: 48,
    gap: 24,
    align: 'center',
    nodes: [
      { type: 'text', role: 'heading', text: 'Simple, fair pricing', size: 40 },
      {
        type: 'stack', direction: 'row', gap: 24, align: 'stretch', justify: 'center',
        children: [
          card('Starter', '$0', 'Start free'),
          card('Pro', '$12', 'Choose Pro', 'blue'),
          card('Team', '$39', 'Choose Team'),
        ],
      },
    ],
  };
}

const BUILDERS: Record<UiTemplateName, (preset: FramePreset) => Record<string, unknown>> = {
  login,
  landing: () => landing(),
  pricing: () => pricing(),
};

/** Build a Frame for a named UI template (or null if expansion failed). */
export function buildUiTemplate(name: UiTemplateName, preset: FramePreset = 'desktop'): Frame | null {
  const doc = BUILDERS[name](name === 'login' ? preset : preset);
  return expandUiDocument(doc);
}
