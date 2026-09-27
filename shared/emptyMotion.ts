import type { MotionScene } from './motion';

export function createEmptyMotionScene(name = 'Untitled scene'): MotionScene {
  return { id: crypto.randomUUID(), name, width: 1920, height: 1080, fps: 30, duration: 6, background: '#111111', layers: [] };
}
