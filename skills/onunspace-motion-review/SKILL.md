---
name: onunspace-motion-review
description: Diagnose and verify OnunSpace Motion compositions, timeline edits, deterministic previews, and local MP4/WebM exports. Use for broken playback, keyframe timing, visual motion review, or checking an actual OnunSpace render.
---

# OnunSpace Motion Review

Read the intended project and `onun://motion-contract` before diagnosing. Keep source state and editor UI state separate: selection, zoom, playhead, and visible panels are not persisted motion content. Confirm whether the composition is native layers or custom HTML/CSS/GSAP; custom code replaces the native rendering.

## Identify the failing boundary

- **Content or timing:** inspect the saved scene's keyframes, layer visibility, start/end, dimensions, easing, and text. Check times at the actual FPS, including the last rendered frame.
- **Interactive timeline:** use a disposable project. Check selection across tracks, pointer drag, keyboard movement, constraints, and one undo restoring the whole gesture. Compare saved keyframe times after autosave; do not treat a transient DOM position as persistence.
- **Preview:** inspect runtime errors and `window.__ONUN_MOTION__`. Test a forward seek and a backward seek to the same timestamp. Look for timers, autonomous tweens, nondeterministic randomness, and seek-suppressed callbacks when the repeated state differs.
- **Export:** check `runtime_status`, then actual `render_status`. A preview-ready flag, queue ID, or progress bar is not proof of a completed file. Capture real errors from the renderer and verify a completed artifact's dimensions, FPS, duration, and visual frames.

## Visual review

Review start, at least one active transition, the intended reading hold, and the last exported frame. Focus on hierarchy, timing, contrast, clipping, and whether the motion supports the brief. Use additional timestamps only when a specific concern calls for them. Distinguish a deliberate reference-based choice from a rendering defect.

When fixing a scene, patch only the affected layers/tracks or code. Use `project_batch` with the current revision for coordinated changes. Preserve unrelated canvas/media content. Read back and validate the result, then repeat the failing interaction or render; do not rerun unrelated expensive exports without cause.

## Local verification paths

When working in the OnunSpace repository, use its existing scripts and tests before creating new harnesses. `shared/motion.ts` defines validation, `sceneDocument.ts` defines preview semantics, and `server/render.ts` defines exported frames. The standard application test suite includes a tiny real Chromium/FFmpeg export and MCP stdio checks.

For interactive QA, create an isolated project with a unique `qa-*` ID, send writes only to that ID, and remove only its verified fixture files afterward. Never test destructive keyframe gestures in the user's active project. Existing repository smoke scripts should follow this rule; inspect a script before running an older version.

Do not reset user content to a sample scene to make a check pass. Do not run paid image/video generation to diagnose a local motion-render issue.

Report what was visibly or programmatically verified, the files produced, and any remaining unsupported behavior. Keep schema validity, visual review, deterministic playback, and successful encoding as separate claims.
