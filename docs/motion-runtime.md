# Motion runtime

The visual editor and local renderer use the same HTML document generator in `src/features/motion/sceneDocument.ts`. GSAP is installed locally and injected inline, together with the bundled Inter font. Rendering needs neither a WebContainer nor a remote service.

## Scene contract

`shared/motion.ts` defines `MotionScene`, `MotionLayer`, `MotionKeyframe`, and validation. A scene has an explicit width, height, FPS, duration, background color, and ordered layers. Layers support text, labels, outlined shapes, and shaded orbs. Their position, scale, rotation, and opacity are animated with timestamped keyframes. Optional `keyframe.ease` controls the transition into that keyframe; omitted easing falls back to `layer.ease`.

The editor supports layer creation, duplication, visibility, text and transform editing, direct position dragging, playback, frame scrubbing, and keyframe creation/deletion. Shift/Ctrl/Cmd-click or drag a marquee to select multiple keyframes on one or several tracks. Dragging, Delete, easing changes and left/right arrows apply to the group in one undo step; Shift-arrow moves ten frames. Escape clears the selection. Undo/redo clears stale keyframe selection so subsequent edits cannot target another key by index.

The composition is a free viewport on a plain editor background, with no surrounding card, dots, border or stage shadow. Sidebars and timeline remain fixed floating panels with gaps. H selects the hand tool, V selects the selection tool, and holding Space temporarily enables panning away from inputs/buttons. Middle-button dragging pans over the composition. The wheel zooms around the pointer; Shift-wheel pans horizontally. Fit restores the centered composition. Navigation does not change layer geometry. The inspector becomes a toggleable panel at narrow widths.

MCP callers should use the scene/layer/keyframe tools provided by the local server. Scene validation rejects duplicate layer IDs, non-finite values, oversized scenes, and invalid easing names before a job is accepted.

## HTML / CSS / JavaScript scenes

A scene can contain `customCode: { html, css, js }`. These scenes replace the visual layer composition. The code editor and MCP accept the same contract.

JavaScript receives `sceneRoot`, `sceneData`, `gsap`, and a paused GSAP `timeline`. Animate using that timeline. Example:

```js
timeline.from('.headline', { y: 80, opacity: 0, duration: 1.2, ease: 'expo.out' }, 0);
timeline.to('.orb', { rotation: 180, duration: 6, ease: 'none' }, 0);
```

The runtime exposes `window.__ONUN_MOTION__ = { ready, duration, seek, timeline }`. A `seek(time)` call restores the timeline's initial state and evaluates it at the requested time. Use finite, deterministic code; do not use independent timers, CSS animations, random values, or wall-clock time. Assets must be embedded as data URLs. Third-party scripts, network calls, module imports, and font downloads are blocked.

The editor runs authored code in an iframe with `sandbox="allow-scripts"` and no same-origin permission. It communicates using narrowly scoped postMessage events and checks the frame source. The renderer uses a new isolated Chromium context with all network requests blocked and the same restrictive content security policy. This is browser isolation, not an operating-system sandbox for hostile infinite-loop code.

Each generated preview document mounts a fresh iframe, including when the embedded font finishes loading. This prevents a reused `srcDoc` document from retaining an empty layout in the embedded browser. Load and ready events restore the current playhead; completing font/image loading preserves the latest requested time. Preview bounds are cleared when the document changes and zero-size bounds are ignored.

## Local render

`server/render.ts` exports `RenderQueue`. It runs one job at a time and accepts up to four outstanding jobs. Cancellation interrupts the encoder and browser; incomplete output is removed. The queue exposes frame counts, encoding state, progress, completion, and failures. A job has a fifteen-minute timeout. Job metadata is held in memory; restarting the runtime loses the active queue. Completed video files remain in the configured export directory.

Each frame is sampled at `frameIndex / fps`, captured as a lossless PNG, and streamed directly to FFmpeg with backpressure. No intermediate image sequence is written to disk. MP4 uses H.264, YUV420p, fast-start metadata, and CRF 16 in high quality. WebM uses VP9. Draft rendering defaults to at most 960 pixels wide and faster encoding. Export currently has no audio, alpha channel, or multi-scene sequencing.

Limits: 120 seconds, 60 FPS, 8.8 megapixels, 200 layers, 100 keyframes per layer, one running render. Output dimensions must be even. These are workload limits, not claims that every combination has been benchmarked.

FFmpeg is resolved from `ONUN_FFMPEG_PATH`, common macOS/Linux locations, or PATH. Chromium uses `ONUN_CHROMIUM_PATH`, a standard Google Chrome installation on macOS if present, or Playwright's installed browser. On a clean machine run `npx playwright install chromium` and install FFmpeg before exporting.

## Verification

- `node --import tsx --test tests/motion.test.ts` checks frame timestamps, scene validation, resolution bounds, and script isolation escaping.
- `node --import tsx scripts/motion-render-smoke.mjs` checks repeated GSAP state, the initial frame, runtime errors, and a real five-frame MP4 export.
- `node scripts/motion-ui-smoke.mjs` checks editor behavior at 1600×1000, 1024×768, and 390×844 against the running development server.
- `node scripts/motion-selection-regression.mjs` verifies dialog shortcut isolation, selection after undo and insertion using an isolated QA project.
- `.figma-app/evidence/motion-multiselect/report.json` records group selection/movement/easing, undo, marquee, viewport navigation and responsive panel geometry. This harness blocks API mutations.

The tested nine-layer composition has identical computed layer states after repeated seeks. Chromium screenshots may differ by one RGB level at text edges because of antialiasing; byte-identical screenshots are not claimed. Supplied references are interpreted as a dark editor composition, with Onun typography and pink accent applied deliberately.

Official references: [GSAP timeline](https://gsap.com/docs/v3/GSAP/Timeline/), [Playwright screenshots](https://playwright.dev/docs/screenshots), [FFmpeg formats](https://ffmpeg.org/ffmpeg-formats.html).
