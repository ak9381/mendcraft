import { describe, expect, it } from 'vitest';
import { createNetworkMonitor, routeBigJob, type NavigatorLike } from '../src/offline/network';

describe('routeBigJob (pure online/offline routing)', () => {
  it('runs on the cloud when online and cloud is configured', () => {
    expect(routeBigJob({ online: true, cloudConfigured: true })).toBe('run-now');
  });

  it('enqueues when offline but cloud is configured', () => {
    expect(routeBigJob({ online: false, cloudConfigured: true })).toBe('enqueue');
  });

  it('stays local-only when no cloud is configured, online or not', () => {
    // No cloud means queueing would strand the job forever — serve local now.
    expect(routeBigJob({ online: true, cloudConfigured: false })).toBe('local-only');
    expect(routeBigJob({ online: false, cloudConfigured: false })).toBe('local-only');
  });
});

describe('createNetworkMonitor', () => {
  // A mutable navigator + a real EventTarget stand in for window/navigator.
  function setup(initial: boolean) {
    const nav: { onLine: boolean } = { onLine: initial };
    const target = new EventTarget();
    const monitor = createNetworkMonitor({
      navigator: nav as NavigatorLike,
      target: target as unknown as import('../src/offline/network').EventTargetLike,
    });
    return { nav, target, monitor };
  }

  it('reports the initial navigator state', () => {
    expect(setup(true).monitor.online()).toBe(true);
    expect(setup(false).monitor.online()).toBe(false);
  });

  it('notifies subscribers on online↔offline transitions', () => {
    const { nav, target, monitor } = setup(true);
    const seen: boolean[] = [];
    monitor.subscribe((o) => seen.push(o));

    nav.onLine = false;
    target.dispatchEvent(new Event('offline'));
    nav.onLine = true;
    target.dispatchEvent(new Event('online'));

    expect(seen).toEqual([false, true]);
    expect(monitor.online()).toBe(true);
  });

  it('debounces events that do not change state', () => {
    const { nav, target, monitor } = setup(true);
    const seen: boolean[] = [];
    monitor.subscribe((o) => seen.push(o));
    // An 'online' event while already online must not fire a spurious update.
    target.dispatchEvent(new Event('online'));
    nav.onLine = false;
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('offline')); // duplicate
    expect(seen).toEqual([false]);
  });

  it('stops notifying after unsubscribe and dispose', () => {
    const { nav, target, monitor } = setup(true);
    const seen: boolean[] = [];
    const off = monitor.subscribe((o) => seen.push(o));
    off();
    nav.onLine = false;
    target.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([]);
    monitor.dispose(); // no throw, listeners detached
    nav.onLine = true;
    target.dispatchEvent(new Event('online'));
    expect(seen).toEqual([]);
  });
});
