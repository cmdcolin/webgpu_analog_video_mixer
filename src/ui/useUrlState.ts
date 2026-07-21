import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_CONTROLS } from '../controls'
import type { ControlKey, Controls } from '../controls'
import type { SourceBMode, SourceMode } from '../sources/modes'

interface UrlStateArgs {
  controls: Controls
  // Gated on the engine existing: before it does, `controls` is the default
  // fallback and syncing would wipe the very params the loader is about to read.
  engineReady: boolean
  sourceMode: SourceMode
  sourceBMode: SourceBMode
}

// Mirrors the live look into the query string so a reload or shared link
// restores it, and hands back a copy-to-clipboard action with its transient
// "copied" flash.
export function useUrlState({
  controls,
  engineReady,
  sourceMode,
  sourceBMode,
}: UrlStateArgs) {
  const [copied, setCopied] = useState(false)

  // The managed keys (set/src/srcb) are rewritten from the live state; any other
  // params the loader reads (iurl, iurlb, vurl, preset, debug) are left untouched
  // so a URL-loaded source survives later edits.
  const stateUrl = useCallback(() => {
    const set = (Object.keys(DEFAULT_CONTROLS) as ControlKey[])
      .filter(k => controls[k] !== DEFAULT_CONTROLS[k])
      .map(k => `${k}:${+controls[k].toFixed(4)}`)
    // URLSearchParams so values with spaces (src=tv static) get encoded.
    const q = new URLSearchParams(location.search)
    if (set.length) q.set('set', set.join(','))
    else q.delete('set')
    if (sourceMode !== 'bars' && sourceMode !== 'file') q.set('src', sourceMode)
    else q.delete('src')
    if (sourceBMode === 'bars' || sourceBMode === 'sweep')
      q.set('srcb', sourceBMode)
    else q.delete('srcb')
    const query = q.toString()
    return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`
  }, [controls, sourceMode, sourceBMode])

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
