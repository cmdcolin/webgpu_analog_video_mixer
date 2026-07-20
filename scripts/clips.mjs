// Capture the README's motion clips. Each shot is fully declarative: the URL
// alone (?iurl / ?iurlb / ?preset / ?set) specifies the source image(s), preset,
// and param overrides, so nothing here uploads files or clicks the UI.
//
// Usage:  node scripts/clips.mjs [outDir=clips] [base=http://localhost:5199/]
//   (needs dev server + Firefox Nightly + ffmpeg on PATH). Writes an mp4 per
//   shot into outDir/ (gitignored) for review.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const outDir = process.argv[2] ?? 'clips'
const base = process.argv[3] ?? 'http://localhost:5199/'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const urlFor = params => base + '?' + new URLSearchParams(params).toString()

const SHOTS = [
  { file: 'dirty-mix', warm: 90, secs: 7,
    params: { iurl: '/sample.jpg', iurlb: '/sample-b.jpg', preset: 'dirty mix',
      set: 'bGain:0.72,bDetuneHz:230,bLineHz:1.1,bRollLps:0.5,hHold:0.42' } },
  { file: 'wipe-fight', warm: 90, secs: 7,
    params: { iurl: '/sample.jpg', iurlb: '/sample-b.jpg', preset: 'wipe fight',
      set: 'bGain:0.78,bDetuneHz:210,hHold:0.34' } },
  { file: 'torn-signal', warm: 70, secs: 7,
    params: { iurl: '/sample.jpg', preset: 'broadcast',
      set: 'ghostGain:0.55,ghostDelayUs:7,noiseIre:3' } },
  { file: 'sync-tear', warm: 70, secs: 7,
    params: { iurl: '/sample.jpg', preset: 'vhs',
      set: 'hHold:0.62,vHold:0.45,tbJitterNs:520,tbWowNs:1500' } },
  { file: 'chroma-blowout', warm: 70, secs: 7,
    params: { iurl: '/sample.jpg', preset: 'vhs',
      set: 'chromaGain:2.9,svideoBleed:0.9,hHold:0.15' } },
  { file: 'full-collapse', warm: 70, secs: 7,
    params: { iurl: '/sample.jpg', preset: 'broadcast',
      set: 'ghostGain:0.5,ghostDelayUs:6,hHold:0.5,tbWowNs:1900,chromaGain:2.1,noiseIre:4' } },
]

// One browser per clip: captureStream stalls on an occluded window, so each
// clip's window must be the sole focused one.
async function record(shot) {
  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: '/usr/bin/firefox-nightly',
    headless: false,
    extraPrefsFirefox: {
      'dom.webgpu.enabled': true,
      'gfx.webgpu.ignore-blocklist': true,
    },
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 600 })
    await page.goto(urlFor(shot.params), { waitUntil: 'networkidle0' })
    await sleep(4500) // engine init + image fetch
    await page.evaluate(k => {
      for (let i = 0; i < k; i++) window.vf?.step()
    }, shot.warm)
    await page.evaluate(() => {
      const c = document.querySelector('canvas')
      for (const el of c.parentElement.children)
        if (el !== c) el.style.display = 'none'
    })
    await page.bringToFront()
    await sleep(400)
    const dataUrl = await page.evaluate(async secs => {
      const canvas = document.querySelector('canvas')
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(t => window.MediaRecorder?.isTypeSupported(t))
      const rec = new MediaRecorder(canvas.captureStream(30), {
        mimeType: type,
        videoBitsPerSecond: 12_000_000,
      })
      const chunks = []
      rec.ondataavailable = e => e.data.size && chunks.push(e.data)
      const stopped = new Promise(res => (rec.onstop = res))
      rec.start()
      const t0 = performance.now()
      await new Promise(res => {
        const iv = setInterval(() => {
          window.vf?.step()
          if (performance.now() - t0 > secs * 1000) {
            clearInterval(iv)
            res()
          }
        }, 33)
      })
      rec.stop()
      await stopped
      const blob = new Blob(chunks, { type: 'video/webm' })
      return await new Promise(res => {
        const fr = new FileReader()
        fr.onload = () => res(fr.result)
        fr.readAsDataURL(blob)
      })
    }, shot.secs)
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    writeFileSync(`${outDir}/${shot.file}.webm`, buf)
  } finally {
    await browser.close().catch(() => {})
  }
}

mkdirSync(outDir, { recursive: true })
for (const shot of SHOTS) {
  const webm = `${outDir}/${shot.file}.webm`
  let ok = false
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    await record(shot).catch(e => console.log('FAIL', shot.file, String(e).slice(0, 80)))
    ok = statSync(webm, { throwIfNoEntry: false })?.size > 200_000
  }
  if (ok) {
    // prettier-ignore
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', webm, '-an',
      '-c:v', 'libx264', '-crf', '25', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', `${outDir}/${shot.file}.mp4`])
    rmSync(webm)
    console.log('clip', `${shot.file}.mp4`)
  }
}
