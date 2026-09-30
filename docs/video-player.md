# Video playback

Use `VideoPlayer` from `src/components/media/VideoPlayer.tsx` for playable video media. Canvas nodes and the expanded media preview both use this component; the stylesheet is imported once by `src/main.tsx`.

```tsx
import { VideoPlayer } from './components/media/VideoPlayer';

<VideoPlayer
  src={videoUrl}
  title="My video"
  locale="en"
  preload="metadata"
/>
```

The player provides play/pause, seeking, time, mute, volume and fullscreen controls, with English and Portuguese labels and Solar Bold icons. Paused videos show only a centered play icon; playback reveals a compact control bar with the time and timeline on one row. The controls fade and move gently between these states, with hidden controls removed from keyboard navigation. Reduced-motion preferences disable those transitions. The player preserves the video's aspect ratio and uses `objectFit="contain"` by default. Pass `objectFit="cover"` when a fixed preview frame should crop the media.

Keyboard controls apply while focus is inside the player: Space, Enter or K toggles playback; M toggles mute; F toggles fullscreen; Left/Right seeks five seconds. Buttons retain their usual Space/Enter action, and sliders retain their native keyboard behavior. The canvas excludes player interactions from drag, double-click and editor shortcuts.

Playback begins on demand by default. `autoPlay` starts muted and respects reduced-motion preferences. The component handles metadata, waiting, playback errors and media-source changes, including metadata already available before React mounts. Browsers that only expose native video fullscreen use that platform's fullscreen viewer.

Library and reference-picker thumbnails remain passive video elements. For reference thumbnails rendered through `Artwork`, pass `thumbnail` to keep the small previews silent and free of playback controls. Motion composition playback remains controlled by its timeline. For new independently playable video surfaces, reuse `VideoPlayer` to keep the same controls and behavior.

The implementation has no dependency on the hosted Onun platform. Solar icon vectors and their attribution are included beside the component; see [third-party notices](../THIRD_PARTY_NOTICES.md).
