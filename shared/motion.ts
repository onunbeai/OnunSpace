export type MotionLayerType = 'text' | 'shape' | 'orb' | 'label'
export const motionEases = ['none', 'power2.out', 'power3.inOut', 'expo.out', 'back.out(1.4)'] as const
export type MotionEase = typeof motionEases[number]
export type MotionKeyframe = { time: number; x?: number; y?: number; scale?: number; rotation?: number; opacity?: number; ease?: MotionEase }
export type MotionLayerContent = { html: string; css: string }
export interface MotionLayer {
  id: string; name: string; type: MotionLayerType; x: number; y: number; width: number; height: number
  rotation: number; opacity: number; scale: number; color: string; text?: string; fontSize?: number
  fontWeight?: number; radius?: number; start: number; end: number; ease: MotionEase; keyframes: MotionKeyframe[]; hidden?: boolean
  fontFamily?: string; fontStyle?: 'normal' | 'italic'; textAlign?: 'left' | 'center' | 'right' | 'justify'
  lineHeight?: number; letterSpacing?: number; textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  textDecoration?: 'none' | 'underline' | 'line-through'; backgroundColor?: string; borderColor?: string
  borderWidth?: number; borderStyle?: 'solid' | 'dashed' | 'dotted'; padding?: number
  textStrokeWidth?: number; textStrokeColor?: string; customContent?: MotionLayerContent
}
export interface MotionScene {
  id: string; name: string; width: number; height: number; fps: number; duration: number; background: string
  layers: MotionLayer[]; customCode?: { html: string; css: string; js: string }
}
export type RenderOptions = { format?: 'mp4' | 'webm'; quality?: 'draft' | 'high'; width?: number; height?: number; fps?: number }

const baseLayer = { rotation: 0, opacity: 1, scale: 1, start: 0, end: 6, ease: 'power3.inOut' as const, keyframes: [] }
export const defaultScene: MotionScene = {
  id: 'onun-launch', name: 'Make it move', width: 1920, height: 1080, fps: 30, duration: 6, background: '#111013',
  layers: [
    { ...baseLayer, id: 'orbit-outer', name: 'Orbit · outer', type: 'shape', x: 1190, y: 120, width: 700, height: 700, color: '#ff87f7', radius: 350, opacity: .12, keyframes: [{ time: 0, scale: .7, rotation: -30 }, { time: 6, scale: 1.08, rotation: 30 }] },
    { ...baseLayer, id: 'orbit-inner', name: 'Orbit · inner', type: 'shape', x: 1255, y: 185, width: 570, height: 570, color: '#ff87f7', radius: 285, opacity: .28, keyframes: [{ time: 0, scale: 1.1 }, { time: 6, scale: .93 }] },
    { ...baseLayer, id: 'orb', name: 'Pink matter', type: 'orb', x: 1300, y: 230, width: 480, height: 480, color: '#ff87f7', keyframes: [{ time: 0, scale: .55, rotation: -15, opacity: 0 }, { time: 1.4, scale: 1, rotation: 0, opacity: 1 }, { time: 6, y: 200, rotation: 16, scale: 1.04 }] },
    { ...baseLayer, id: 'eyebrow', name: 'Onun / Creative space', type: 'label', x: 130, y: 122, width: 650, height: 44, color: '#ff87f7', text: 'ONUN  /  CREATIVE SPACE', fontSize: 22, fontWeight: 500, keyframes: [{ time: 0, opacity: 0 }, { time: .7, opacity: 1 }] },
    { ...baseLayer, id: 'title', name: 'Ideas into', type: 'text', x: 120, y: 290, width: 1150, height: 170, color: '#faf7fa', text: 'Ideas into', fontSize: 174, fontWeight: 500, keyframes: [{ time: 0, y: 380, opacity: 0 }, { time: 1.2, y: 290, opacity: 1 }] },
    { ...baseLayer, id: 'title-pink', name: 'motion.', type: 'text', x: 120, y: 445, width: 1150, height: 190, color: '#ff87f7', text: 'motion.', fontSize: 188, fontWeight: 500, keyframes: [{ time: 0, y: 550, opacity: 0 }, { time: .35, y: 550, opacity: 0 }, { time: 1.65, y: 445, opacity: 1 }] },
    { ...baseLayer, id: 'subtitle', name: 'Your imagination. In motion.', type: 'text', x: 132, y: 736, width: 860, height: 60, color: '#aaa3b2', text: 'Your imagination. In motion.', fontSize: 34, fontWeight: 400, keyframes: [{ time: 0, opacity: 0 }, { time: 1, opacity: 0 }, { time: 2, opacity: 1 }] },
    { ...baseLayer, id: 'footer', name: 'Made of possibilities', type: 'label', x: 133, y: 935, width: 1000, height: 40, color: '#9c92a5', text: 'MADE OF POSSIBILITIES.  BUILT BY YOU.', fontSize: 18, fontWeight: 400, keyframes: [{ time: 0, opacity: 0 }, { time: 1.8, opacity: 0 }, { time: 2.6, opacity: 1 }] },
    { ...baseLayer, id: 'pill', name: 'The next chapter', type: 'label', x: 1300, y: 797, width: 480, height: 75, color: '#ded7e2', text: 'THE NEXT CHAPTER', fontSize: 22, fontWeight: 400, radius: 40, keyframes: [{ time: 0, opacity: 0, y: 835 }, { time: 1, opacity: 0, y: 835 }, { time: 2.3, opacity: 1, y: 797 }] },
  ],
}

export function frameTimestamps(duration: number, fps: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120 || !Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Duração ou FPS inválidos.')
  return Array.from({ length: Math.ceil(duration * fps) }, (_, index) => index / fps)
}

function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} deve estar entre ${min} e ${max}.`)
  return value
}
function string(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} inválido.`)
  return value
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use uma cor hexadecimal de seis dígitos.')
  return value
}
function choice(value: unknown, values: readonly string[], label: string) {
  if (value !== undefined && (typeof value !== 'string' || !values.includes(value))) throw new Error(`${label} inválido.`)
}
export function validateMotionScene(input: unknown): MotionScene {
  if (!input || typeof input !== 'object') throw new Error('Cena inválida.')
  const scene = input as MotionScene
  string(scene.id, 120, 'ID'); string(scene.name, 200, 'Nome')
  finite(scene.width, 64, 4096, 'Largura'); finite(scene.height, 64, 4096, 'Altura')
  if (scene.width * scene.height > 8_847_360 || !Number.isInteger(scene.width) || !Number.isInteger(scene.height)) throw new Error('Resolução máxima de 8,8 megapixels, com dimensões inteiras.')
  finite(scene.duration, .1, 120, 'Duração'); finite(scene.fps, 1, 60, 'FPS')
  if (!Number.isInteger(scene.fps)) throw new Error('FPS deve ser inteiro.')
  color(scene.background)
  if (!Array.isArray(scene.layers) || scene.layers.length > 200) throw new Error('Uma cena pode ter até 200 camadas.')
  const ids = new Set<string>()
  for (const layer of scene.layers) {
    string(layer.id, 120, 'ID da camada'); string(layer.name, 200, 'Nome da camada')
    if (!/^[a-zA-Z0-9_-]+$/.test(layer.id) || ids.has(layer.id)) throw new Error('IDs de camadas devem ser únicos e conter letras, números, hífen ou sublinhado.')
    ids.add(layer.id)
    if (!['text', 'shape', 'orb', 'label'].includes(layer.type)) throw new Error('Tipo de camada inválido.')
    finite(layer.x, -10000, 10000, 'X'); finite(layer.y, -10000, 10000, 'Y')
    finite(layer.width, 1, 10000, 'Largura'); finite(layer.height, 1, 10000, 'Altura')
    finite(layer.rotation, -36000, 36000, 'Rotação'); finite(layer.opacity, 0, 1, 'Opacidade'); finite(layer.scale, .001, 100, 'Escala')
    finite(layer.start, 0, scene.duration, 'Início'); finite(layer.end, layer.start, scene.duration, 'Fim'); color(layer.color)
    if (!motionEases.includes(layer.ease)) throw new Error('Curva de animação inválida.')
    if (layer.text !== undefined) string(layer.text, 10000, 'Texto')
    if (layer.fontSize !== undefined) finite(layer.fontSize, 1, 2000, 'Fonte')
    if (layer.fontWeight !== undefined) finite(layer.fontWeight, 100, 900, 'Peso da fonte')
    if (layer.fontFamily !== undefined && (!string(layer.fontFamily, 200, 'Família da fonte').trim() || [...layer.fontFamily].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) throw new Error('Família da fonte inválida.')
    choice(layer.fontStyle, ['normal', 'italic'], 'Estilo da fonte')
    choice(layer.textAlign, ['left', 'center', 'right', 'justify'], 'Alinhamento do texto')
    choice(layer.textTransform, ['none', 'uppercase', 'lowercase', 'capitalize'], 'Transformação do texto')
    choice(layer.textDecoration, ['none', 'underline', 'line-through'], 'Decoração do texto')
    choice(layer.borderStyle, ['solid', 'dashed', 'dotted'], 'Estilo da borda')
    if (layer.lineHeight !== undefined) finite(layer.lineHeight, .1, 10, 'Altura da linha')
    if (layer.letterSpacing !== undefined) finite(layer.letterSpacing, -200, 1000, 'Espaçamento das letras')
    if (layer.padding !== undefined) finite(layer.padding, 0, 1000, 'Espaçamento interno')
    if (layer.borderWidth !== undefined) finite(layer.borderWidth, 0, 1000, 'Espessura da borda')
    if (layer.textStrokeWidth !== undefined) finite(layer.textStrokeWidth, 0, 100, 'Contorno do texto')
    if (layer.backgroundColor !== undefined && layer.backgroundColor !== 'transparent') color(layer.backgroundColor)
    if (layer.borderColor !== undefined) color(layer.borderColor)
    if (layer.textStrokeColor !== undefined) color(layer.textStrokeColor)
    if (layer.customContent !== undefined) {
      if (!layer.customContent || typeof layer.customContent !== 'object' || Array.isArray(layer.customContent)) throw new Error('Conteúdo da camada inválido.')
      string(layer.customContent.html, 100_000, 'HTML da camada')
      string(layer.customContent.css, 50_000, 'CSS da camada')
      if (Object.keys(layer.customContent).some(key => key !== 'html' && key !== 'css')) throw new Error('O conteúdo da camada aceita apenas HTML e CSS.')
    }
    if (layer.radius !== undefined) finite(layer.radius, 0, 10000, 'Raio')
    if (!Array.isArray(layer.keyframes) || layer.keyframes.length > 100) throw new Error('Máximo de 100 keyframes por camada.')
    for (const keyframe of layer.keyframes) {
      finite(keyframe.time, 0, scene.duration, 'Tempo do keyframe')
      if (keyframe.ease !== undefined && !motionEases.includes(keyframe.ease)) throw new Error('Curva de animação do keyframe inválida.')
      for (const property of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) if (keyframe[property] !== undefined) finite(keyframe[property], property === 'opacity' ? 0 : property === 'scale' ? .001 : -36000, property === 'opacity' ? 1 : 36000, property)
    }
  }
  if (scene.customCode) for (const field of ['html', 'css', 'js'] as const) string(scene.customCode[field], 500_000, field)
  return structuredClone(scene)
}
export function createMotionLayer(type: MotionLayerType, scene: MotionScene): MotionLayer {
  const textLayer = type === 'text' || type === 'label'
  const width = Math.min(textLayer ? 640 : 280, scene.width * .8), height = Math.min(textLayer ? 140 : 280, scene.height * .8)
  return { ...baseLayer, id: `layer-${crypto.randomUUID()}`, name: textLayer ? 'Novo texto' : type === 'orb' ? 'Nova esfera' : 'Nova forma', type, x: (scene.width - width) / 2, y: (scene.height - height) / 2, width, height, color: '#ff87f7', ...(type === 'shape' ? { backgroundColor: '#ff87f7', borderWidth: 0 } : {}), text: textLayer ? 'Make it yours.' : undefined, fontSize: Math.min(type === 'label' ? 32 : 90, width / 8, height * .8), fontWeight: 500, end: scene.duration, keyframes: [] }
}
