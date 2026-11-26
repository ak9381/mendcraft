// One-Euro filter (Casiez, Roussel, Vogel 2012). Two low-pass filters — one
// on the signal, one on its derivative — with a cutoff that rises as the
// pointer speeds up, so a shaky hold is smoothed without lagging a reach.

export interface OneEuroParams {
  /** Minimum cutoff (Hz). Lower = more smoothing when still. */
  minCutoff: number;
  /** Cutoff slope vs. speed. Higher = less lag on fast moves. */
  beta: number;
  /** Derivative cutoff (Hz). */
  dCutoff: number;
}

const DEFAULT_PARAMS: OneEuroParams = { minCutoff: 1, beta: 3, dCutoff: 1 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(1e-6, cutoff));
  return 1 / (1 + tau / Math.max(1e-6, dt));
}

class LowPass {
  private hat: number | null = null;
  filter(value: number, a: number): number {
    if (this.hat === null) this.hat = value;
    else this.hat = a * value + (1 - a) * this.hat;
    return this.hat;
  }
  reset(): void {
    this.hat = null;
  }
}

class OneEuro1D {
  private readonly xFilt = new LowPass();
  private readonly dxFilt = new LowPass();
  private prev: number | null = null;
  private params: OneEuroParams;
  constructor(params: OneEuroParams) {
    this.params = params;
  }
  setParams(p: OneEuroParams): void {
    this.params = p;
  }
  filter(value: number, dt: number): number {
    const dx = this.prev === null ? 0 : (value - this.prev) / dt;
    const edx = this.dxFilt.filter(dx, alpha(this.params.dCutoff, dt));
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(edx);
    const hat = this.xFilt.filter(value, alpha(cutoff, dt));
    this.prev = value;
    return hat;
  }
  reset(): void {
    this.xFilt.reset();
    this.dxFilt.reset();
    this.prev = null;
  }
}

/** Map a 0–1 tremor/smoothing preference to One-Euro parameters. */
export function paramsFromSmoothing(smoothing: number): OneEuroParams {
  const t = Math.max(0, Math.min(1, smoothing));
  return {
    minCutoff: 1.2 - 0.7 * t,
    beta: 2.5 + 4 * t,
    dCutoff: 1,
  };
}

export interface OneEuroFilter {
  filter(x: number, y: number, nowMs: number): { x: number; y: number };
  setSmoothing(smoothing: number): void;
  setParams(params: Partial<OneEuroParams>): void;
  reset(): void;
}

export function createOneEuroFilter(initial?: Partial<OneEuroParams>): OneEuroFilter {
  let params: OneEuroParams = { ...DEFAULT_PARAMS, ...initial };
  const fx = new OneEuro1D(params);
  const fy = new OneEuro1D(params);
  let lastT: number | null = null;

  const apply = (p: OneEuroParams): void => {
    params = p;
    fx.setParams(p);
    fy.setParams(p);
  };

  return {
    filter(x, y, nowMs) {
      let dt = lastT === null ? 1 / 60 : (nowMs - lastT) / 1000;
      if (dt <= 0 || dt > 0.5) dt = 1 / 60;
      lastT = nowMs;
      return { x: fx.filter(x, dt), y: fy.filter(y, dt) };
    },
    setSmoothing(smoothing) {
      apply(paramsFromSmoothing(smoothing));
    },
    setParams(partial) {
      apply({ ...params, ...partial });
    },
    reset() {
      fx.reset();
      fy.reset();
      lastT = null;
    },
  };
}
