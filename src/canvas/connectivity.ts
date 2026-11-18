// Connectivity state + a small "do it later" queue. When she is offline, Gemini
// turns don't run and "add kannada" is parked here; on reconnect the queue drains
// and each parked request runs as a Proposal. Pure: the DOM toggle and
// navigator.onLine live in the shell; this only holds state and the queue.

export interface Connectivity<T> {
  isOnline(): boolean;
  setOnline(on: boolean): void;
  queueLater(item: T): void;
  drainLater(): T[];
  laterCount(): number;
}

export function createConnectivity<T = string>(online = true): Connectivity<T> {
  let on = online;
  const later: T[] = [];
  return {
    isOnline: () => on,
    setOnline(next) { on = next; },
    queueLater(item) { later.push(item); },
    drainLater() { return later.splice(0, later.length); },
    laterCount: () => later.length,
  };
}
