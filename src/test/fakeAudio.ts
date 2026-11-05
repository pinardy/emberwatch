/**
 * A minimal stand-in for the WebAudio API: enough of AudioContext to build the
 * game's graph and record what was asked of it. Nodes remember what they are
 * connected to, params remember their automation, oscillators their start and
 * stop times. Time only moves when a test sets `currentTime`.
 */

export type ParamCall = [method: string, ...args: number[]]

export class FakeParam {
  value: number
  calls: ParamCall[] = []
  constructor(value = 0) {
    this.value = value
  }
  /** The last value any automation call aimed for (or the plain value). */
  get target(): number {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const [method, value] = this.calls[i]
      if (method !== 'cancelScheduledValues') return value
    }
    return this.value
  }
  private record(method: string, ...args: number[]) {
    this.calls.push([method, ...args])
    return this
  }
  setValueAtTime(v: number, t: number) {
    return this.record('setValueAtTime', v, t)
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.record('linearRampToValueAtTime', v, t)
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.record('exponentialRampToValueAtTime', v, t)
  }
  setTargetAtTime(v: number, t: number, c: number) {
    return this.record('setTargetAtTime', v, t, c)
  }
  cancelScheduledValues(t: number) {
    return this.record('cancelScheduledValues', t)
  }
}

export class FakeNode {
  outputs: FakeNode[] = []
  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.nodes.push(this)
  }
  connect(target: FakeNode) {
    this.outputs.push(target)
    return target
  }
  disconnect() {
    this.outputs = []
  }
  /** True when a chain of connections leads from this node to `target`. */
  reaches(target: FakeNode): boolean {
    return this.outputs.some((o) => o === target || o.reaches(target))
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1)
  constructor(context: FakeAudioContext) {
    super(context, 'gain')
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  constructor(context: FakeAudioContext) {
    super(context, 'filter')
  }
}

export class FakeOscillator extends FakeNode {
  type = 'sine'
  frequency = new FakeParam(440)
  detune = new FakeParam(0)
  startAt: number | null = null
  stopAt: number | null = null
  constructor(context: FakeAudioContext) {
    super(context, 'oscillator')
  }
  start(t = 0) {
    this.startAt = t
  }
  stop(t = 0) {
    this.stopAt = t
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: unknown = null
  loop = false
  started = false
  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource')
  }
  start() {
    this.started = true
  }
  stop() {}
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  sampleRate = 8000
  state: 'running' | 'suspended' = 'suspended'
  resumes = 0
  nodes: FakeNode[] = []
  destination: FakeNode

  constructor() {
    this.destination = new FakeNode(this, 'destination')
    FakeAudioContext.instances.push(this)
  }
  resume() {
    this.resumes++
    this.state = 'running'
    return Promise.resolve()
  }
  createGain() {
    return new FakeGain(this)
  }
  createBiquadFilter() {
    return new FakeFilter(this)
  }
  createOscillator() {
    return new FakeOscillator(this)
  }
  createBufferSource() {
    return new FakeBufferSource(this)
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length)
    return { getChannelData: () => data }
  }
  oscillators(): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator)
  }
}

/** Typed view of the fake as the real thing, for code under test. */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext
}
