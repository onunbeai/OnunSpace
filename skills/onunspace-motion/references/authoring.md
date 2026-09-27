# Authoring contract

The live MCP resource and installed source take precedence over this compact guide.

## Native scene

Geometry uses pixels, time uses seconds, opacity uses 0–1, and rotation uses degrees. A keyframe's X/Y values are absolute scene positions; the renderer converts them to offsets from the layer's base position. Scale is a factor around the layer's center.

Each layer has a unique ID, type (`text`, `shape`, `orb`, `label`), geometry, color, start/end, base transform, easing, and a keyframe array. Colors are six-digit hex. Keep keyframes sorted. Use one keyframe per time for a given layer and merge its transform properties rather than adding ambiguous duplicate-time entries. Each keyframe can store `x`, `y`, `scale`, `rotation`, and `opacity`. Use per-keyframe `ease` only when the live contract supports it; omitted easing falls back to the layer's easing.

Changing layer timing does not rescale its keyframes automatically. When shortening a scene, update layer ends and affected keyframe times in the same atomic change. Preserve relative timing when moving a group. Keep keys within 0–duration and on the intended frame grid (`round(time * fps) / fps`).

Current limits: 200 layers, 100 keyframes per layer, 0.1–120 seconds, integer FPS 1–60, integer dimensions 64–4096, and at most 8,847,360 pixels. The runtime resource is authoritative if these limits change.

Supported native easing values currently include `none`, `power2.out`, `power3.inOut`, `expo.out`, and `back.out(1.4)`. Choose from the live contract instead of inventing easing identifiers.

## Atomic MCP edits

`project_batch` takes `{projectId, expectedRevision, operations}`. Useful operations:

- `{op: 'layer.patch', id, patch}` updates only the intended fields.
- `{op: 'layer.upsert', layer}` supplies a complete layer.
- `{op: 'keyframes.replace', layerId, keyframes}` replaces that track's full array; retain unchanged keys explicitly.
- `{op: 'scene.replace', scene}` replaces the complete composition.
- `{op: 'code.replace', html, css, js}` replaces custom code.

The batch is limited to 200 operations and validated before saving. Prefer one batch for coordinated edits to several tracks. Do not send a saved preview selection or timeline playhead as project content; these are editor state.

## Deterministic custom code

The isolated scene supplies `sceneRoot`, GSAP, and a paused `timeline`. Use scoped selectors and attach every animation to that timeline. Set explicit initial states with `timeline.set` at time 0; use explicit positions and durations for tweens.

Do not create a second autoplay timeline, use timers, read wall-clock time, load remote scripts, or depend on unseeded randomness. Callback-only DOM mutations may not reproduce when the renderer suppresses events during seeks. Prefer tweened properties and timeline sets. Avoid infinite repeats; the scene has a fixed duration.

The engine invokes `window.__ONUN_MOTION__.seek(time)` and waits for readiness. For QA, seeking `t1`, then `t2`, then `t1` must reproduce the same scene. The last exported frame is `(ceil(duration * fps) - 1) / fps`, not necessarily exactly `duration`.

The sandbox has no filesystem or general network access. Use available local/data assets and existing bundled fonts; inspect the preview for missing media. Backup portability requires imported or supported public HTTPS media. Do not promise audio, alpha-channel export, multi-scene sequencing, or arbitrary external modules unless the running version actually supports them.
