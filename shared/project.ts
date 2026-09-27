import type { MotionScene } from './motion';
export type NodeKind = 'reference' | 'image' | 'video' | 'motion' | 'text';
export type ReviewStatus = 'none' | 'review' | 'progress' | 'approved' | 'rejected';
export interface CanvasNode {
  id: string; kind: NodeKind; title: string; x: number; y: number; width: number;
  prompt: string; model: string; provider: 'openrouter' | 'higgsfield'; aspectRatio: string; resolution: string;
  duration?: number; count: number; status: ReviewStatus; generatedFrom?: string; media?: string; artwork?: 'brand' | 'orb' | 'poster' | 'type' | 'motion';
  generationCancelling?: boolean; outputs?: string[]; generationStatus?: 'idle' | 'running' | 'complete' | 'error'; error?: string;
}
export interface CanvasEdge { id: string; source: string; target: string; }
export interface Project {
  id: string; name: string; revision?: number; updatedAt?: string;
  nodes: CanvasNode[]; edges: CanvasEdge[]; motion: MotionScene;
}
