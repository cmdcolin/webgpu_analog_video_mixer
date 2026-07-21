import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CONTROLS } from '../controls'
import type { ControlKey, Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'
import { REVERB_DEFAULT, SPEED_DEFAULT } from './useEngine'

interface UrlStateArgs {
  controls: Controls
  // Gated on the engine existing: before it does, `controls` is the default
  // fallback and syncing would wipe the very params the loader is about to read.
  engineReady: boolean
  sourceMode: SourceMode
  sourceBMode: SourceBMode
  // YouTube source URLs + vaporwave look, so a refresh or shared link restores
  // the clips slowed down. Audio-out isn't serialized: browsers block unmuted
  // autoplay, so a restored clip must start muted and be un-muted by a click.
  ytUrlA: string
  ytUrlB: string
  speedA: number
  speedB: number
  reverb: number
}

// Mirrors the live look into the query string so a reload or shared link
// restores it, and hands back a copy-to-clipboard action with its transient
// "copied" flash.
export function useUrlState({
  controls,
  engineReady,
  sourceMode,
  sourceBMode,
  ytUrlA,
  ytUrlB,
  speedA,
  speedB,
  reverb,
}: UrlStateArgs) {
  const [copied, setCopied] = useState(false)

  // The managed keys (set/src/srcb, yt*/speed*/reverb/audio) are rewritten from
  // the live state; any other params the loader reads (iurl, iurlb, vurl,
  // preset, debug) are left untouched so a URL-loaded source survives edits.
  const stateUrl = useCallback(() => {
    const set = (Object.keys(DEFAULT_CONTROLS) as ControlKey[])
      .filter(k => controls[k] !== DEFAULT_CONTROLS[k])
      .map(k => `${k}:${+controls[k].toFixed(4)}`)
    // URLSearchParams so values with spaces (src=tv static) get encoded.
    const q = new URLSearchParams(location.search)
    const put = (key: string, on: boolean, value: string) =>
      on ? q.set(key, value) : q.delete(key)
    put('set', set.length > 0, set.join(','))
    // youtube has its own yt=/ytb= keys (the URL, not just the mode name).
    put(
      'src',
      sourceMode !== 'bars' && sourceMode !== 'file' && sourceMode !== 'youtube',
      sourceMode,
    )
    put('srcb', sourceBMode === 'bars' || sourceBMode === 'sweep', sourceBMode)
    put('yt', sourceMode === 'youtube' && ytUrlA !== '', ytUrlA)
    put('ytb', sourceBMode === 'youtube' && ytUrlB !== '', ytUrlB)
    put('speeda', speedA !== SPEED_DEFAULT, String(+speedA.toFixed(4)))
    put('speedb', speedB !== SPEED_DEFAULT, String(+speedB.toFixed(4)))
    put('reverb', reverb !== REVERB_DEFAULT, String(+reverb.toFixed(4)))
    const query = q.toString()
    return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`
  }, [controls, sourceMode, sourceBMode, ytUrlA, ytUrlB, speedA, speedB, reverb])

  // Keep the address bar current on every change (replaceState, so it doesn't
  // flood history). Trailing-debounced: a slider drag emits a move per frame,
  // and the browser rate-limits the history API — so coalesce to one write once
  // the value settles.
  useEffect(() => {
    if (engineReady) {
      const url = stateUrl()
      const id = setTimeout(() => history.replaceState(null, '', url), 250)
      return () => clearTimeout(id)
    }
  }, [engineReady, stateUrl])

  const copyLink = () => {
    navigator.clipboard
      .writeText(stateUrl())
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  return { copyLink, copied }
}
