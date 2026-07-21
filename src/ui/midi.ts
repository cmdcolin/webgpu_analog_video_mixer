import type { ControlKey } from '../controls'
import { AUTOMAP_KEYS, SLIDER_BY_KEY } from './controls'
import type { SliderDef } from './controls'

// One CC source = a (channel, controller) pair. Channel is kept so two knobs
// that share a controller number on different channels stay distinct.
export interface MidiBinding {
  channel: number
  controller: number
}

export type BindingMap = Partial<Record<ControlKey, MidiBinding>>

// A controller's factory layout, as the CC number each physical knob sends, in
// the order they should take controls. `ccs` is explicit (not a base+count)
// because real layouts stripe knobs across non-contiguous CC ranges. A device
// that banks knobs on-hardware (e.g. the MIDI Fighter Twister's 4 banks) just
// lists every bank's CC — the app sees banks as more distinct knobs, no
// bank-switch logic needed here.
export interface DeviceProfile {
  name: string
  channel: number
  ccs: number[]
}

// One entry per knob (16 encoders × 4 on-device banks), factory-default CC 0..63
// on channel 1. Turning any bank on the box just changes which of these a knob
// sends, so the app maps a control to every slot up front.
const twisterCcs: number[] = []
for (let i = 0; i < 64; i++) twisterCcs.push(i)

export const DEVICE_PROFILES: DeviceProfile[] = [
  { name: 'MIDI Fighter Twister', channel: 0, ccs: twisterCcs },
]

export interface AutoMapResult {
  mapped: number
  total: number
}

// Live progress of a "learn in order" sweep: bind each control down the spine
// to whichever knob the user moves next. `nextKey` is the control still waiting
// for a knob, or null once every slot is filled.
export interface LearnState {
  done: number
  total: number
  nextKey: ControlKey | null
}

export type MidiStatus =
  'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied'

const STORE_KEY = 'video_feedback_midi'

function loadBindings(): BindingMap {
  const raw = localStorage.getItem(STORE_KEY)
  return raw === null ? {} : (JSON.parse(raw) as BindingMap)
}

function bindingId(b: MidiBinding): string {
  return `${b.channel}:${b.controller}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// Copy of a partial control map without one key. Generic so both the binding
// map here and the sync map in app.tsx share it.
export function omit<V>(
  map: Partial<Record<ControlKey, V>>,
  key: ControlKey,
): Partial<Record<ControlKey, V>> {
  const out: Partial<Record<ControlKey, V>> = {}
  for (const [k, v] of Object.entries(map))
    if (k !== key) out[k as ControlKey] = v
  return out
}

// A 0..127 CC value → a stepped control value in the slider's range.
function ccToValue(def: SliderDef, cc: number): number {
  const raw = def.min + (cc / 127) * (def.max - def.min)
  const stepped = Math.round((raw - def.min) / def.step) * def.step + def.min
  return clamp(stepped, def.min, def.max)
}

// Half a control's full span per MIDI step — the pickup tolerance for the very
// first message of a binding, where there's no previous value to cross.
function epsilon(def: SliderDef): number {
  return (def.max - def.min) / 64
}

// Rate controls (Hz) that can lock to the incoming clock. `beats` is the cycle
// length: 1/4 means one full cycle per quarter note.
export const SYNC_DIVISIONS: { label: string; beats: number }[] = [
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
]

export const SYNCABLE_KEYS: ControlKey[] = ['wipeRate', 'bLineHz']

// Tempo-locked value for a rate control, clamped to its slider range.
export function syncedValue(
  key: ControlKey,
  bpm: number,
  beats: number,
): number {
  const raw = bpm / 60 / beats
  const def = SLIDER_BY_KEY.get(key)
  return def ? clamp(raw, def.min, def.max) : raw
}

export interface MidiManager {
  enable: () => void
  arm: (key: ControlKey | null) => void
  // Replace all bindings with a device's factory layout: each knob CC takes the
  // next control along the auto-map spine. Returns how many controls got a knob.
  autoMap: (profile: DeviceProfile) => AutoMapResult
  // Device-agnostic bulk bind: start from a clean slate, then bind the next
  // control down the spine to each fresh knob the user moves. Works for any
  // controller regardless of its CC layout.
  learnSequence: () => void
  stopLearn: () => void
  clearBinding: (key: ControlKey) => void
  clearAll: () => void
  // Report a value set from outside MIDI (slider drag, preset, slot). Drops
  // soft-takeover engagement so the physical knob must re-catch the new value.
  setExternal: (key: ControlKey, value: number) => void
  destroy: () => void
}

export interface MidiCallbacks {
  onControl: (key: ControlKey, value: number) => void
  onStatus: (status: MidiStatus) => void
  onBindings: (bindings: BindingMap) => void
  onArmed: (key: ControlKey | null) => void
  // Progress of a learn-in-order sweep, or null when none is running.
  onLearn: (state: LearnState | null) => void
  // Detected clock tempo, or null when no clock is running.
  onTempo: (bpm: number | null) => void
}

export function createMidi(cb: MidiCallbacks): MidiManager {
  let bindings = loadBindings()
  let armed: ControlKey | null = null
  let access: MIDIAccess | null = null
  // Active learn-in-order sweep: the spine of keys to fill, how far along we
  // are, and the knob sources already claimed (so one knob's stream of messages
  // binds a single control, not the whole row).
  let learn: { keys: ControlKey[]; index: number; seen: Set<string> } | null =
    null
  const keyByBinding = new Map<string, ControlKey>()

  // Soft-takeover bookkeeping, keyed by control.
  const current = new Map<ControlKey, number>()
  const lastCc = new Map<ControlKey, number>()
  const engaged = new Set<ControlKey>()

  // Clock: 24 pulses per quarter note. BPM is averaged over a window of pulse
  // arrivals and only reported when the rounded value changes.
  let pulses: number[] = []
  let lastPulse = 0
  let reportedBpm: number | null = null
  let tempoTimer: ReturnType<typeof setInterval> | null = null

  const stopClock = () => {
    pulses = []
    if (reportedBpm !== null) {
      reportedBpm = null
      cb.onTempo(null)
    }
  }

  const onPulse = () => {
    const now = performance.now()
    pulses.push(now)
    if (pulses.length > 25) pulses.shift() // ~one beat of history
    lastPulse = now
    if (pulses.length >= 7) {
      const perPulse =
        (pulses[pulses.length - 1] - pulses[0]) / (pulses.length - 1)
      const bpm = Math.round((60000 / (perPulse * 24)) * 2) / 2
      if (Number.isFinite(bpm) && bpm !== reportedBpm) {
        reportedBpm = bpm
        cb.onTempo(bpm)
      }
    }
  }

  const reindex = () => {
    keyByBinding.clear()
    for (const [k, b] of Object.entries(bindings))
      keyByBinding.set(bindingId(b), k as ControlKey)
  }
  reindex()

  const persist = () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(bindings))
    cb.onBindings({ ...bindings })
  }

  const reportLearn = () => {
    cb.onLearn(
      learn === null
        ? null
        : {
            done: learn.index,
            total: learn.keys.length,
            nextKey: learn.keys[learn.index] ?? null,
          },
    )
  }

  const bind = (key: ControlKey, b: MidiBinding) => {
    // A CC drives one control at a time: drop whoever held this source before.
    const prev = keyByBinding.get(bindingId(b))
    bindings = {
      ...(prev === undefined ? bindings : omit(bindings, prev)),
      [key]: b,
    }
    engaged.delete(key)
    lastCc.delete(key)
    reindex()
    persist()
  }

  const drive = (key: ControlKey, cc: number) => {
    const def = SLIDER_BY_KEY.get(key)
    if (def) {
      const mapped = ccToValue(def, cc)
      const cur = current.get(key)
      const last = lastCc.get(key)
      const crossed =
        cur === undefined || last === undefined
          ? cur === undefined || Math.abs(mapped - cur) <= epsilon(def)
          : (last - cur) * (mapped - cur) <= 0
      if (crossed) engaged.add(key)
      lastCc.set(key, mapped)
      if (engaged.has(key)) {
        current.set(key, mapped)
        cb.onControl(key, mapped)
      }
    }
  }

  const onMessage = (e: MIDIMessageEvent) => {
    const data = e.data
    // System real-time is a single status byte: 0xF8 clock tick, 0xFC stop.
    if (data?.length === 1) {
      if (data[0] === 0xf8) onPulse()
      else if (data[0] === 0xfc) stopClock()
    }
    // Control Change is status 0xB0..0xBF; three bytes: status, controller, value.
    if (data?.length === 3 && (data[0] & 0xf0) === 0xb0) {
      const b = { channel: data[0] & 0x0f, controller: data[1] }
      const id = bindingId(b)
      if (learn !== null) {
        // A knob already claimed this sweep keeps streaming as it turns — only a
        // fresh source advances to the next control.
        if (!learn.seen.has(id)) {
          learn.seen.add(id)
          bind(learn.keys[learn.index], b)
          learn.index += 1
          if (learn.index >= learn.keys.length) learn = null
          reportLearn()
        }
      } else if (armed !== null) {
        bind(armed, b)
        armed = null
        cb.onArmed(null)
      } else {
        const key = keyByBinding.get(id)
        if (key !== undefined) drive(key, data[2])
      }
    }
  }

  const listen = (m: MIDIAccess) => {
    for (const input of m.inputs.values()) input.onmidimessage = onMessage
  }

  return {
    enable: () => {
      if (!('requestMIDIAccess' in navigator)) {
        cb.onStatus('unsupported')
      } else {
        cb.onStatus('requesting')
        navigator.requestMIDIAccess().then(
          m => {
            access = m
            cb.onStatus('ready')
            cb.onBindings({ ...bindings })
            listen(m)
            // New devices plugged in after grant still get wired up.
            m.onstatechange = () => listen(m)
            // A source that stops sending clock ticks (or is unplugged) never
            // sends 0xFC; drop the tempo once ticks go quiet.
            tempoTimer = setInterval(() => {
              if (reportedBpm !== null && performance.now() - lastPulse > 1000)
                stopClock()
            }, 500)
          },
          () => cb.onStatus('denied'),
        )
      }
    },
    arm: key => {
      armed = key
      cb.onArmed(key)
    },
    autoMap: profile => {
      const n = Math.min(profile.ccs.length, AUTOMAP_KEYS.length)
      const next: BindingMap = {}
      for (let i = 0; i < n; i++)
        next[AUTOMAP_KEYS[i]] = {
          channel: profile.channel,
          controller: profile.ccs[i],
        }
      bindings = next
      engaged.clear()
      lastCc.clear()
      reindex()
      persist()
      return { mapped: n, total: AUTOMAP_KEYS.length }
    },
    learnSequence: () => {
      armed = null
      cb.onArmed(null)
      learn = { keys: AUTOMAP_KEYS, index: 0, seen: new Set() }
      bindings = {}
      engaged.clear()
      lastCc.clear()
      reindex()
      persist()
      reportLearn()
    },
    stopLearn: () => {
      if (learn !== null) {
        learn = null
        reportLearn()
      }
    },
    clearBinding: key => {
      bindings = omit(bindings, key)
      reindex()
      persist()
    },
    clearAll: () => {
      bindings = {}
      reindex()
      persist()
    },
    setExternal: (key, value) => {
      current.set(key, value)
      engaged.delete(key)
    },
    destroy: () => {
      if (tempoTimer !== null) clearInterval(tempoTimer)
      if (access) {
        for (const input of access.inputs.values()) input.onmidimessage = null
        access.onstatechange = null
      }
    },
  }
}
