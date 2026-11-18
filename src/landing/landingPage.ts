// Marketing landing at /. Ports the v3 brand look (serif headlines, warm
// paper / near-black, one blue accent). CTAs leave this page for the real
// editor (/studio) and control room (/control). No Relay mentions.
import './landing.css';
import shell from './shell.html?raw';
import { bootLanding } from './boot.js';
import { BACKUP_VIDEO_SLOT_LABEL, backupVideoUrl } from '../ux/demoKit';

export function mountLandingPage(root: HTMLElement): void {
  document.title = 'Mendcraft — draw and check a floor plan with your voice and hands';
  document.documentElement.classList.add('js', 'mc-land');
  document.body.classList.add('mc-land');
  root.classList.add('mc-land');
  root.innerHTML = shell;
  bootLanding();
  const slot = document.getElementById('mc-backup-video-slot');
  if (slot) {
    const url = backupVideoUrl(localStorage);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = BACKUP_VIDEO_SLOT_LABEL;
      a.rel = 'noreferrer';
      slot.append(a);
    } else {
      const p = document.createElement('p');
      p.textContent = `${BACKUP_VIDEO_SLOT_LABEL}. Add a link in the demo kit before going on stage.`;
      slot.append(p);
    }
  }
}

