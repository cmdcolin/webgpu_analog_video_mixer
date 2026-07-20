// Regenerate the README gallery: for each preset, drive Firefox Nightly
// against the dev server, click the preset, step frames deterministically
// (feedback looks need time to develop), and save the canvas.
// Usage: node scripts/gallery.mjs [outDir=docs/gallery] [url=http://localhost:5199/]

import puppeteer from 'puppeteer-core'

const outDir = process.argv[2] ?? 'docs/gallery'
const base = process.argv[3] ?? 'http://localhost:5199/'

const SHOTS = [
  { file: 'hero', preset: 'mixer loop', frames: 360, fullPage: true },
  { file: 'vhs', preset: 'vhs', frames: 150 },
  { file: 'svideo-miswire', preset: 's-video miswire', frames: 150 },
  { file: 'dead-channel', preset: 'dead channel', frames: 150 },
  { file: 'mixer-loop', preset: 'mixer loop', frames: 900 },
  { file: 'fb-bloom', preset: 'fb bloom', frames: 500 },
  { file: 'dirty-mix', preset: 'dirty mix', frames: 150, srcb: 'sweep' },
]

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})

for (const shot of SHOTS) {
  const page = await browser.newPage()
  await page.setViewport(
    shot.fullPage === true
      ? { width: 1360, height: 880 }
      : { width: 1100, height: 600 },
  )
  const url = shot.srcb === undefined ? base : `${base}?srcb=${shot.srcb}`
  await page.goto(url, { waitUntil: 'networkidle0' })
  await new Promise(r => setTimeout(r, 4000))
  await page.evaluate(name => {
    const btn = [...document.querySelectorAll('button')].find(
      b => b.textContent.trim() === name,
    )
    btn.click()
  }, shot.preset)
  // occluded windows throttle rAF; step frames deterministically instead
  await page.evaluate(async n => {
    for (let i = 0; i < n; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 15))
    }
  }, shot.frames)
  const path = `${outDir}/${shot.file}.png`
  if (shot.fullPage === true) {
    await page.screenshot({ path })
  } else {
    // overlay buttons and the fps readout sit on top of the canvas — hide them
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      for (const el of canvas.parentElement.children) {
        if (el !== canvas) el.style.display = 'none'
      }
    })
    const canvas = await page.$('canvas')
    await canvas.screenshot({ path })
  }
  console.log('saved', path, `(${shot.preset})`)
  await page.close()
}
await browser.close()
