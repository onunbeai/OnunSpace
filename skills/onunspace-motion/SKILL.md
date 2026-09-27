---
name: onunspace-motion
description: Create, edit, and refine editable OnunSpace Motion compositions through its local MCP, including layers, keyframes, and deterministic HTML/CSS/GSAP scenes. Use for actual OnunSpace motion work, not general website animation.
---

# OnunSpace Motion

Work in the requested OnunSpace project. Preserve its canvas, media, unrelated layers, and existing visual direction. Creating a motion composition does not imply changing the editor interface or the separate Onun website.

## Read the live scene first

Discover the connected OnunSpace MCP tools. Call `runtime_status`, then `project_get` for the intended project and read `onun://motion-contract`. If only the local checkout is available, inspect `shared/motion.ts`, `src/features/motion/sceneDocument.ts`, and `docs/local-runtime.md` before editing. Never infer a project ID from a screenshot title. Use `projects_list` when the project is not known.

Use the brief and current scene to choose composition, duration, resolution, typography, and rhythm. Preserve existing dimensions/FPS unless the request changes them. The editor's pink selection color is not a requirement for every generated scene. Respect the user's artwork and brand palette.

## Choose the editable representation

- Prefer native `layers` and `keyframes` for text, shapes, orbs, and labels that the user will adjust visually.
- Use `customCode` for compositions that genuinely need HTML/CSS/GSAP. Custom code replaces the native visual scene; native layer controls do not author that custom DOM. Do not mix both representations and imply both are visibly active.
- Before replacing an existing composition with a different representation, keep its source in the project backup when the user requested preservation. `project_backup_create` creates a real portable ZIP; `project_export` alone contains JSON and may reference external assets.

Read [the authoring contract](references/authoring.md) for timing, keyframe, custom-code, and batch details.

## Edit and verify

Use stable layer IDs. Group related changes into `project_batch` with the revision from `project_get`; a failed batch saves nothing. On a revision conflict, reread and reapply the intended changes to the current scene. Do not retry a stale whole-project replacement.

Design the motion as readable states and transitions: establish hierarchy, entrance, movement, hold, and exit as the brief requires. Keep important text readable during the hold. Use meaningful timing differences rather than moving every object continuously. Frame the composition at its actual output ratio and check overlap, clipping, and legibility.

Read back the saved scene and run `project_validate`. Inspect the preview at start, active transitions, main hold, and the last rendered frame. Scrub backward and forward to confirm repeatable state. A valid JSON schema is not visual proof.

Export when requested using `render_create`; poll `render_status` until completion or failure and report the actual artifact. Local motion editing/rendering uses no provider credits. `generation_create` is a separate, billable provider action and must match the user's request.

Report the changed composition, its duration/size, and verified preview/export result concisely. Do not claim a completed video from a queued job.
