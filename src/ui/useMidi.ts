import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Engine } from '../gpu/pipeline'
import type { ControlKey, Controls } from '../controls'
import { createMidi } from './midi'
import type { BindingMap, MidiManager, MidiStatus } from './midi'

// Owns the MIDI manager (an imperative Web MIDI subsystem living outside React)
// and the single control-write path. Every store-origin change must reach two
// sinks — the render engine and MIDI's soft-takeover bookkeeping — so callers
// go through writeControl/writeControls rather than poking each by hand.
export function useMidi(engineRef: RefObject<Engine | null>) {
  const midiRef = useRef<MidiManager | null>(null)
  const [status, setStatus] = useState<MidiStatus>('idle')
  const [bindings, setBindings] = useState<BindingMap>({})
  const [armedKey, setArmedKey] = useState<ControlKey | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)

  useEffect(() => {
    // A MIDI-origin change drives the engine only: the physical knob move IS
    // the takeover, so it must not reset its own soft-takeover state.
    const midi = createMidi({
      onControl: (key, v) => {
        engineRef.current?.setControl(key, v)
      },
      onStatus: setStatus,
      onBindings: setBindings,
      onArmed: setArmedKey,
      onTempo: setBpm,
    })
    midiRef.current = midi
    return () => {
      midi.destroy()
      midiRef.current = null
    }
  }, [engineRef])

  // The one write path for store-origin changes (slider, preset, clock sync):
  // engine renders it, MIDI drops takeover so the knob must re-catch the value.
  //
  // Deliberately still useCallback, even though React Compiler would memoize
  // these: App keeps writeControl in an effect dep array, and a fresh identity
  // per render would re-fire that effect and reset soft-takeover every frame —
  // a physical knob could never hold its catch. Correctness, not performance,
  // so the invariant is stated here rather than inferred from compiler output.
  const writeControl = useCallback(
    (key: ControlKey, v: number) => {
      engineRef.current?.setControl(key, v)
      midiRef.current?.setExternal(key, v)
    },
    [engineRef],
  )

  const writeControls = useCallback(
    (next: Controls) => {
      engineRef.current?.applyControls(next)
      const midi = midiRef.current
      if (midi)
        for (const k of Object.keys(next) as ControlKey[])
          midi.setExternal(k, next[k])
    },
    [engineRef],
  )

  return {
    status,
    bindings,
    armedKey,
    bpm,
    writeControl,
    writeControls,
    enable: () => midiRef.current?.enable(),
    // Toggle: arming the already-armed key disarms it.
    toggleArm: (key: ControlKey) =>
      midiRef.current?.arm(armedKey === key ? null : key),
    disarm: () => midiRef.current?.arm(null),
    clearBinding: (key: ControlKey) => midiRef.current?.clearBinding(key),
    clearAll: () => midiRef.current?.clearAll(),
  }
}
