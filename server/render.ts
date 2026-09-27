import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, type Browser } from 'playwright'
import { frameTimestamps, validateMotionScene, type MotionScene, type RenderOptions } from '../shared/motion'
import { buildSceneDocument } from '../src/features/motion/sceneDocument'

export type RenderStatus = 'queued' | 'rendering' | 'encoding' | 'completed' | 'failed' | 'cancelled'
export interface RenderJob {
  id: string; sceneId: string; sceneName: string; status: RenderStatus; progress: number; frame: number; totalFrames: number
  width: number; height: number; fps: number; format: 'mp4' | 'webm'; quality: 'draft' | 'high'; createdAt: string
  completedAt?: string; error?: string; filePath?: string; bytes?: number; duration: number
}
type PendingRender = { job: RenderJob; scene: MotionScene; abort: AbortController }
type MotionWindow = Window & { __ONUN_MOTION__?: { ready: boolean; seek(time: number): number }; __ONUN_ERROR__?: string }
const require = createRequire(import.meta.url)

export function resolveRenderSettings(scene: MotionScene, options: RenderOptions = {}) {
  if (options.format !== undefined && !['mp4', 'webm'].includes(options.format)) throw new Error('Formato de render inválido.')
  if (options.quality !== undefined && !['draft', 'high'].includes(options.quality)) throw new Error('Qualidade de render inválida.')
  const quality = options.quality || 'high'
  const ratio = quality === 'draft' ? Math.min(1, 960 / scene.width) : 1
  const width = options.width ?? Math.round(scene.width * ratio / 2) * 2
  const height = options.height ?? Math.round(scene.height * ratio / 2) * 2
  const fps = options.fps ?? scene.fps
  if (![width, height, fps].every(Number.isInteger) || width < 64 || height < 64 || width > 4096 || height > 4096 || width * height > 8_847_360 || width % 2 || height % 2 || fps < 1 || fps > 60) throw new Error('Render exige dimensões pares de 64–4096 px, até 8,8 MP e 1–60 fps.')
  return { width, height, fps, quality, format: options.format || 'mp4' as const }
}

export class RenderQueue {
  readonly outputDir: string
  private readonly jobs = new Map<string, PendingRender>()
  private running = false
  constructor(outputDir: string) { this.outputDir = path.resolve(outputDir) }
  enqueue(input: unknown, options: RenderOptions = {}): RenderJob {
    const scene = validateMotionScene(input)
    if (this.list().filter(job => ['queued', 'rendering', 'encoding'].includes(job.status)).length >= 4) throw new Error('A fila local aceita até 4 renders. Aguarde ou cancele um render.')
    const settings = resolveRenderSettings(scene, options)
    const job: RenderJob = { id: randomUUID(), sceneId: scene.id, sceneName: scene.name, status: 'queued', progress: 0, frame: 0, totalFrames: frameTimestamps(scene.duration, settings.fps).length, ...settings, createdAt: new Date().toISOString(), duration: scene.duration }
    this.jobs.set(job.id, { job, scene, abort: new AbortController() })
    for (const [id, pending] of this.jobs) if (this.jobs.size > 30 && ['completed', 'failed', 'cancelled'].includes(pending.job.status)) this.jobs.delete(id)
    void this.pump()
    return job
  }
  get(id: string): RenderJob | undefined { return this.jobs.get(id)?.job }
  list(): RenderJob[] { return Array.from(this.jobs.values(), pending => pending.job) }
  publicJob(job: RenderJob) {
    const { filePath: _filePath, ...publicData } = job
    return { ...publicData, ...(job.status === 'completed' ? { downloadUrl: `/api/renders/${job.id}/file` } : {}) }
  }
  cancel(id: string): RenderJob | undefined {
    const pending = this.jobs.get(id)
    if (!pending) return undefined
    if (['queued', 'rendering', 'encoding'].includes(pending.job.status)) {
      pending.abort.abort()
      pending.job.status = 'cancelled'
      pending.job.completedAt = new Date().toISOString()
    }
    return pending.job
  }
  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const pending = Array.from(this.jobs.values()).find(item => item.job.status === 'queued')
        if (!pending) break
        await this.render(pending)
      }
    } finally { this.running = false }
  }
  private async render({ job, scene, abort }: PendingRender) {
    let browser: Browser | undefined
    let encoder: ChildProcessWithoutNullStreams | undefined
    const filePath = path.join(this.outputDir, `${job.id}.${job.format}`)
    const timeout = setTimeout(() => abort.abort(new Error('O render excedeu o limite de 15 minutos.')), 15 * 60 * 1000)
    const cancel = () => { encoder?.kill('SIGKILL'); void browser?.close().catch(() => {}) }
    abort.signal.addEventListener('abort', cancel, { once: true })
    try {
      const ffmpegPath = [process.env.ONUN_FFMPEG_PATH, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(candidate => candidate && existsSync(candidate)) || 'ffmpeg'
      await mkdir(this.outputDir, { recursive: true })
      const gsapSource = await readFile(require.resolve('gsap/dist/gsap.min.js'), 'utf8')
      const fontPath = path.resolve('public/assets/inter-medium.woff2')
      const font = existsSync(fontPath) ? `data:font/woff2;base64,${(await readFile(fontPath)).toString('base64')}` : undefined
      job.status = 'rendering'
      const chromePath = process.env.ONUN_CHROMIUM_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
      browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) })
      abort.signal.throwIfAborted()
      const context = await browser.newContext({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true })
      await context.route('**/*', route => route.abort())
      const page = await context.newPage()
      page.setDefaultTimeout(15_000)
      await page.setContent(buildSceneDocument(scene, gsapSource, font), { waitUntil: 'load', timeout: 20_000 })
      await page.waitForFunction(() => (window as MotionWindow).__ONUN_MOTION__?.ready)
      const runtimeError = await page.evaluate(() => (window as MotionWindow).__ONUN_ERROR__)
      if (runtimeError) throw new Error(`Erro na cena: ${runtimeError}`)
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(job.fps), '-vcodec', 'png', '-i', 'pipe:0', '-an', '-threads', '2']
      if (job.format === 'mp4') args.push('-c:v', 'libx264', '-preset', job.quality === 'draft' ? 'ultrafast' : 'medium', '-crf', job.quality === 'draft' ? '24' : '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart')
      else args.push('-c:v', 'libvpx-vp9', '-crf', job.quality === 'draft' ? '36' : '22', '-b:v', '0', '-pix_fmt', 'yuv420p', '-row-mt', '1')
      args.push(filePath)
      encoder = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      const runningEncoder = encoder
      let stderr = ''
      runningEncoder.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8_000) })
      runningEncoder.stdin.on('error', () => {})
      let processError: Error | undefined
      const encodingFinished = new Promise<void>((resolve, reject) => {
        runningEncoder.once('error', error => { processError = new Error(error.message.includes('ENOENT') ? 'FFmpeg não encontrado. Instale FFmpeg ou configure ONUN_FFMPEG_PATH.' : error.message); reject(processError) })
        runningEncoder.once('close', code => code === 0 ? resolve() : reject(processError || new Error(stderr || `FFmpeg terminou com código ${code}.`)))
      })
      void encodingFinished.catch(() => {})
      const timestamps = frameTimestamps(scene.duration, job.fps)
      for (let index = 0; index < timestamps.length; index++) {
        abort.signal.throwIfAborted()
        if (processError) throw processError
        await page.evaluate(time => (window as MotionWindow).__ONUN_MOTION__!.seek(time), timestamps[index])
        const png = await page.screenshot({ type: 'png', animations: 'allow', timeout: 15_000 })
        await new Promise<void>((resolve, reject) => runningEncoder.stdin.write(png, error => error ? reject(processError || error) : resolve()))
        job.frame = index + 1
        job.progress = Math.round(job.frame / job.totalFrames * 95)
      }
      job.status = 'encoding'
      runningEncoder.stdin.end()
      await encodingFinished
      abort.signal.throwIfAborted()
      job.bytes = (await stat(filePath)).size
      job.filePath = filePath
      job.status = 'completed'
      job.progress = 100
    } catch (error) {
      encoder?.kill('SIGKILL')
      job.status = abort.signal.aborted ? 'cancelled' : 'failed'
      job.error = abort.signal.aborted ? (abort.signal.reason instanceof Error ? abort.signal.reason.message : 'Render cancelado.') : error instanceof Error ? error.message : 'Não foi possível renderizar.'
      await rm(filePath, { force: true }).catch(() => {})
    } finally {
      clearTimeout(timeout)
      abort.signal.removeEventListener('abort', cancel)
      await browser?.close().catch(() => {})
      job.completedAt = new Date().toISOString()
    }
  }
}
