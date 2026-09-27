import type { MotionEase, MotionKeyframe, MotionLayer } from '../../../shared/motion'

export const motionPresets = [
  { id: 'fade-in', name: 'Aparecer', description: 'Revela a camada suavemente.' },
  { id: 'fade-out', name: 'Desaparecer', description: 'Esconde a camada ao final.' },
  { id: 'slide-up', name: 'Subir', description: 'Entra de baixo para cima.' },
  { id: 'scale-in', name: 'Crescer', description: 'Entra com escala e opacidade.' },
  { id: 'float', name: 'Flutuar', description: 'Sobe e retorna à posição original.' },
  { id: 'spin', name: 'Girar', description: 'Completa uma volta.' },
] as const

export type MotionPresetId = typeof motionPresets[number]['id']
export type MotionPresetPatch = Pick<MotionLayer, 'keyframes' | 'ease'>

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function motionPresetRange(layer: MotionLayer, sceneDuration: number) {
  if (![layer.start, layer.end, sceneDuration].every(Number.isFinite) || sceneDuration <= 0) return null
  const start = clamp(layer.start, 0, sceneDuration)
  const end = clamp(layer.end, 0, sceneDuration)
  return end > start ? { start, end, duration: end - start } : null
}

/** Replaces the entire animation while leaving the layer's base style untouched. */
export function applyMotionPreset(layer: MotionLayer, preset: MotionPresetId, sceneDuration: number, effectDuration = .8): MotionPresetPatch | null {
  const range = motionPresetRange(layer, sceneDuration)
  if (!range || !motionPresets.some(item => item.id === preset)) return null
  const duration = Number.isFinite(effectDuration) && effectDuration > 0 ? Math.min(effectDuration, range.duration) : Math.min(.8, range.duration)
  const start = preset === 'fade-out' ? Math.max(range.start, range.end - duration) : range.start
  const end = preset === 'fade-out' ? range.end : Math.min(range.end, range.start + duration)
  // Do not round timestamps: tiny layer intervals still need distinct endpoints.
  if (end <= start) return null
  const base = { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity }
  const frame = (time: number, values: Partial<MotionKeyframe> = {}): MotionKeyframe => ({ ...base, time, ...values })
  let ease: MotionEase = 'power2.out'
  let keyframes: MotionKeyframe[]
  switch (preset) {
    case 'fade-in':
      keyframes = [frame(start, { opacity: 0 }), frame(end)]
      break
    case 'fade-out':
      ease = 'power3.inOut'
      keyframes = [frame(start), frame(end, { opacity: 0 })]
      break
    case 'slide-up':
      keyframes = [frame(start, { y: clamp(layer.y + Math.min(80, layer.height * .3), -36000, 36000), opacity: 0 }), frame(end)]
      break
    case 'scale-in':
      keyframes = [frame(start, { scale: Math.max(.001, layer.scale * .7), opacity: 0 }), frame(end)]
      break
    case 'float': {
      ease = 'power3.inOut'
      const middle = start + (end - start) / 2
      keyframes = [frame(start), ...(middle > start && middle < end ? [frame(middle, { y: clamp(layer.y - Math.min(40, layer.height * .15), -36000, 36000) })] : []), frame(end)]
      break
    }
    case 'spin':
      ease = 'none'
      keyframes = [frame(start), frame(end, { rotation: layer.rotation + (layer.rotation <= 35640 ? 360 : -360) })]
      break
  }
  return { keyframes, ease }
}
