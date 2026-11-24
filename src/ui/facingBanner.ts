// A small, non-blocking "Facing this device" pill at the TOP of the viewport.
// Replaces the old full-face corner-bracket overlay that covered most of a
// laptop screen when the user sat close to the webcam. The banner itself is
// pointer-events: none; only its optional dismiss button can receive a click
// or pinch, so it never steals Talk / Tools / canvas pinches.

export interface FacingBanner {
  /** `null` hides the pill (no face / FaceLandmarker off). */
  set(facing: boolean | null): void;
  destroy(): void;
  readonly element: HTMLElement;
}

export function createFacingBanner(container: HTMLElement): FacingBanner {
  const el = container.ownerDocument.createElement('div');
  el.className = 'mc-facing-banner';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  el.innerHTML = `
    <span class="mc-facing-banner-label"></span>
    <button type="button" class="mc-facing-banner-hide" aria-label="Hide facing status">Hide</button>
  `;
  const label = el.querySelector<HTMLElement>('.mc-facing-banner-label')!;
  const hideBtn = el.querySelector<HTMLButtonElement>('.mc-facing-banner-hide')!;
  let dismissed = false;
  hideBtn.addEventListener('click', () => {
    dismissed = true;
    el.hidden = true;
  });
  container.append(el);

  return {
    element: el,
    set(facing) {
      if (dismissed || facing === null) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.classList.toggle('is-facing', facing);
      el.classList.toggle('is-away', !facing);
      label.textContent = facing ? 'Facing this device' : 'Not facing';
    },
    destroy() { el.remove(); },
  };
}
