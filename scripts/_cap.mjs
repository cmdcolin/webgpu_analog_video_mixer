import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const base = 'http://localhost:5250/'
const OUT =
  '/tmp/claude-1001/-home-cdiesh-src-phosphene/598b7991-4fa8-447e-b0f5-5d2001e14e91/scratchpad/cap'
const CAT = '/home/cdiesh/Downloads/PXL_20260521_153156948.jpg'
const STORM = '/home/cdiesh/Downloads/PXL_20260530_214330186.jpg'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: '/usr/bin/firefox-nightly',
  headless: false,
  extraPrefsFirefox: {
    'dom.webgpu.enabled': true,
    'gfx.webgpu.ignore-blocklist': true,
  },
})

async function open(src) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1100, height: 600 })
  await page.goto(base, { waitUntil: 'networkidle0' })
  await sleep(4000)
  if (src) {
    const input = await page.$('input[type=file]')
    await input.uploadFile(src)
    await sleep(2500)
  }
  return page
}
const preset = (page, name) =>
  page.evaluate(n => {
    ;[...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === n)
      .click()
  }, name)
const hide = page =>
  page.evaluate(() => {
    const c = document.querySelector('canvas')
    for (const el of c.parentElement.children)
      if (el !== c) el.style.display = 'none'
  })
const step = (page, n) =>
  page.evaluate(async k => {
    for (let i = 0; i < k; i++) {
      window.vf?.step()
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 12))
    }
  }, n)

const STILLS = [
  { file: 'cat-vhs', src: CAT, p: 'vhs' },
  { file: 'cat-worn', src: CAT, p: 'worn tape' },
  { file: 'cat-rf', src: CAT, p: 'mistuned rf' },
  { file: 'cat-svideo', src: CAT, p: 's-video miswire' },
  { file: 'storm-broadcast', src: STORM, p: 'broadcast' },
  { file: 'storm-dead', src: STORM, p: 'dead channel' },
]
for (const s of STILLS) {
  const page = await open(s.src)
  await preset(page, s.p)
  await step(page, 150)
  await hide(page)
  const c = await page.$('canvas')
  await c.screenshot({ path: `${OUT}/${s.file}.jpg`, type: 'jpeg', quality: 90 })
  console.log('still', s.file)
  await page.close()
}

async function video({ src, p, warm, frames, dir }) {
  mkdirSync(`${OUT}/${dir}`, { recursive: true })
  const page = await open(src)
  await preset(page, p)
  await step(page, warm)
  await hide(page)
  const c = await page.$('canvas')
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => window.vf?.step())
    await c.screenshot({
      path: `${OUT}/${dir}/f${String(i).padStart(4, '0')}.png`,
    })
  }
  console.log('video', dir)
  await page.close()
}
await video({ src: CAT, p: 'worn tape', warm: 120, frames: 130, dir: 'vid_worn' })
await video({ src: CAT, p: 'mixer loop', warm: 50, frames: 130, dir: 'vid_mix' })

await browser.close()
