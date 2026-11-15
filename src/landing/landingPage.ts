// Marketing landing at /. Ports the v3 brand look (serif headlines, warm
// paper / near-black, one blue accent). CTAs leave this page for the real
// editor (/studio) and control room (/control). No Relay mentions.
import './landing.css';
import shell from './shell.html?raw';
import { bootLanding } from './boot.js';

export function mountLandingPage(root: HTMLElement): void {
  document.title = 'Mendcraft — your hands and voice, in control of everything';
  document.documentElement.classList.add('js', 'mc-land');
  document.body.classList.add('mc-land');
  root.classList.add('mc-land');
  root.innerHTML = shell;
  bootLanding();
}
