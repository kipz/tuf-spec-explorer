import { chromium } from 'playwright'
import GIFEncoder from 'gif-encoder-2'
import { PNG } from 'pngjs'
import { writeFileSync } from 'fs'
import { execSync, spawn, type ChildProcess } from 'child_process'

const WIDTH = 1280
const HEIGHT = 800
const DEFAULT_DELAY = 120

let devServer: ChildProcess | null = null

async function startDevServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    devServer = spawn('npx', ['vite', '--port', '5199'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => reject(new Error('Dev server startup timed out')), 15000)

    devServer.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/Local:\s+(http:\/\/localhost:\d+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    })

    devServer.stderr?.on('data', (data: Buffer) => {
      console.error('vite stderr:', data.toString())
    })

    devServer.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function main() {
  console.log('Starting dev server...')
  const url = await startDevServer()
  console.log(`Dev server running at ${url}`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })
  await page.goto(url, { waitUntil: 'networkidle' })

  const encoder = new GIFEncoder(WIDTH, HEIGHT)
  encoder.setDelay(DEFAULT_DELAY)
  encoder.setRepeat(0)
  encoder.setQuality(10)
  encoder.start()

  async function frame(delay?: number) {
    if (delay) encoder.setDelay(delay)
    const buf = await page.screenshot({ type: 'png' })
    const png = PNG.sync.read(buf)
    encoder.addFrame(png.data as unknown as Buffer)
    if (delay) encoder.setDelay(DEFAULT_DELAY)
  }

  async function smoothScroll(target: number, steps: number = 8) {
    const current = await page.evaluate(() => window.scrollY)
    const delta = (target - current) / steps
    for (let i = 0; i < steps; i++) {
      await page.evaluate((d) => window.scrollBy(0, d), delta)
      await frame(80)
    }
  }

  // Helper to click nth tap-card (0-indexed) in the sidebar under "Toggle TAPs"
  async function toggleTap(index: number) {
    const cards = page.locator('.sidebar .tap-card')
    await cards.nth(index).click()
    await page.waitForTimeout(100)
  }

  console.log('Recording frames...')

  // 1. Initial empty state - light theme
  await frame(2000)

  // 2. Toggle TAP 4 (Multiple Repository Consensus) - index 1
  await toggleTap(1)
  await frame(1200)

  // 3. Toggle TAP 3 (Multi-role Delegations) - index 0
  await toggleTap(0)
  await frame(1200)

  // 4. Toggle TAP 8 (Key Rotation via Root) - index 4
  await toggleTap(4)
  await frame(1200)

  // 5. Scroll down to show interactions and constraints
  await smoothScroll(600, 10)
  await frame(1500)

  await smoothScroll(1200, 10)
  await frame(1500)

  // 6. Scroll back up
  await smoothScroll(0, 12)
  await frame(800)

  // 7. Toggle theme to dark mode
  await page.click('.theme-toggle')
  await page.waitForTimeout(100)
  await frame(1500)

  // 8. Toggle TAP 15 (Succinct Hashed Bin Delegations) - index 10
  await toggleTap(10)
  await frame(1200)

  // 9. Scroll down briefly in dark mode
  await smoothScroll(500, 8)
  await frame(1500)

  await smoothScroll(0, 8)
  await frame(1500)

  // Finish encoding
  encoder.finish()
  const gifData = encoder.out.getData()
  writeFileSync('docs/demo.gif', gifData)
  console.log(`Saved docs/demo.gif (${(gifData.length / 1024 / 1024).toFixed(1)} MB)`)

  await browser.close()

  if (devServer) {
    devServer.kill()
  }
}

main().catch(err => {
  console.error(err)
  if (devServer) devServer.kill()
  process.exit(1)
})
