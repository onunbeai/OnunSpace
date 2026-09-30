import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactEventHandler,
} from "react";
import {
  Maximize,
  Minimize,
  PauseFilled,
  PlayFilled,
  RefreshCw,
  Volume,
  VolumeMuted,
} from "./VideoPlayerIcons";

export type VideoPlayerProps = {
  src: string;
  title: string;
  poster?: string;
  locale?: "pt" | "en";
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  preload?: "none" | "metadata" | "auto";
  width?: number;
  height?: number;
  objectFit?: "contain" | "cover";
  className?: string;
  style?: CSSProperties;
  onLoadedMetadata?: ReactEventHandler<HTMLVideoElement>;
  onError?: ReactEventHandler<HTMLVideoElement>;
};

function timeLabel(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(value % 60).padStart(2, "0")}`;
}

// A new source gets fresh playback state, including blob URLs in the Studio.
export const VideoPlayer = memo(function VideoPlayer(props: VideoPlayerProps) {
  return <Player key={props.src} {...props} />;
});

function Player({
  src,
  title,
  poster,
  locale = "pt",
  autoPlay = false,
  muted = false,
  loop = false,
  preload = "metadata",
  width,
  height,
  objectFit = "contain",
  className = "",
  style,
  onLoadedMetadata,
  onError,
}: VideoPlayerProps) {
  const shell = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLVideoElement>(null);
  const interacted = useRef(false);
  const lastVolume = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setMuted] = useState(muted || autoPlay);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [ratio, setRatio] = useState(width && height ? width / height : 16 / 9);
  const text = (pt: string, en: string) => (locale === "en" ? en : pt);
  const playLabel = playing
    ? text("Pausar vídeo", "Pause video")
    : text("Reproduzir vídeo", "Play video");
  const silent = isMuted || volume === 0;
  const soundLabel = silent
    ? text("Ativar som", "Unmute")
    : text("Silenciar vídeo", "Mute video");

  useEffect(() => {
    // SSR may load metadata before React attaches the media event handlers.
    const video = media.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setCurrentTime(video.currentTime);
    setVolume(video.volume);
    setMuted(video.muted);
    setPlaying(!video.paused && !video.ended);
    if (video.videoWidth && video.videoHeight)
      setRatio(video.videoWidth / video.videoHeight);
  }, []);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (preference.matches) element.pause();
      else if (autoPlay && !interacted.current) {
        // Autoplay is always silent. The visitor enables sound explicitly.
        element.muted = true;
        void element.play().catch(() => {
          /* The play button remains available. */
        });
      }
    };
    update();
    preference.addEventListener("change", update);
    return () => {
      preference.removeEventListener("change", update);
      element.pause();
    };
  }, [autoPlay]);

  useEffect(() => {
    const video = media.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    setCanFullscreen(
      Boolean(document.fullscreenEnabled || video?.webkitEnterFullscreen),
    );
    const update = () =>
      setFullscreen(document.fullscreenElement === shell.current);
    const begin = () => setFullscreen(true);
    const end = () => setFullscreen(false);
    document.addEventListener("fullscreenchange", update);
    video?.addEventListener("webkitbeginfullscreen", begin);
    video?.addEventListener("webkitendfullscreen", end);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      video?.removeEventListener("webkitbeginfullscreen", begin);
      video?.removeEventListener("webkitendfullscreen", end);
    };
  }, []);

  const syncMetadata = () => {
    const video = media.current;
    if (!video) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    if (video.videoWidth && video.videoHeight)
      setRatio(video.videoWidth / video.videoHeight);
  };
  const startPlayback = async () => {
    const video = media.current;
    if (!video) return;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      shell.current?.contains(focused) &&
      (focused.classList.contains("onun-video-player__start") ||
        focused.closest(".onun-video-player__error"))
    )
      shell.current.focus({ preventScroll: true });
    interacted.current = true;
    setNotice("");
    if (failed) {
      setFailed(false);
      video.load();
    }
    try {
      await video.play();
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setNotice(
        text(
          "Não foi possível iniciar o vídeo. Tente novamente.",
          "Could not start the video. Try again.",
        ),
      );
    }
  };
  const togglePlayback = () => {
    interacted.current = true;
    if (media.current?.paused) void startPlayback();
    else media.current?.pause();
  };
  const seek = (seconds: number) => {
    const video = media.current;
    if (!video || !duration) return;
    const next = Math.max(0, Math.min(duration, seconds));
    video.currentTime = next;
    setCurrentTime(next);
  };
  const toggleSound = () => {
    const video = media.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = lastVolume.current || 1;
      video.muted = false;
    } else video.muted = true;
  };
  const changeVolume = (next: number) => {
    const video = media.current;
    if (!video) return;
    video.volume = next;
    video.muted = next === 0;
  };
  const toggleFullscreen = async () => {
    const video = media.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
        })
      | null;
    try {
      if (document.fullscreenElement === shell.current)
        await document.exitFullscreen();
      else if (fullscreen && video?.webkitExitFullscreen)
        video.webkitExitFullscreen();
      else if (document.fullscreenEnabled && shell.current?.requestFullscreen)
        await shell.current.requestFullscreen();
      else video?.webkitEnterFullscreen?.();
    } catch {
      setNotice(
        text(
          "Tela cheia indisponível neste navegador.",
          "Fullscreen is unavailable in this browser.",
        ),
      );
    }
  };
  const handleKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("input, textarea, select") ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    // Buttons own Enter/Space, while media shortcuts stay within this player.
    const key = event.key.toLowerCase();
    if ((key === " " || key === "enter") && target.closest("button")) return;
    if ([" ", "enter", "k"].includes(key)) togglePlayback();
    else if (key === "m") toggleSound();
    else if (key === "f" && canFullscreen) void toggleFullscreen();
    else if (key === "arrowleft") seek((media.current?.currentTime ?? 0) - 5);
    else if (key === "arrowright") seek((media.current?.currentTime ?? 0) + 5);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={shell}
      className={`onun-video-player ${className}`}
      style={{ aspectRatio: ratio, ...style }}
      role="group"
      aria-label={title}
      tabIndex={0}
      onKeyDown={handleKeys}
    >
      <video
        ref={media}
        className="onun-video-player__media"
        src={src}
        poster={poster}
        width={width}
        height={height}
        style={{ objectFit }}
        muted={muted || autoPlay}
        loop={loop}
        playsInline
        preload={preload}
        aria-label={title}
        tabIndex={-1}
        onClick={togglePlayback}
        onLoadedMetadata={(event) => {
          syncMetadata();
          onLoadedMetadata?.(event);
        }}
        onDurationChange={syncMetadata}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onPlay={() => {
          setPlaying(true);
          setNotice("");
        }}
        onPlaying={() => {
          setPlaying(true);
          setWaiting(false);
        }}
        onPause={() => {
          const focused = document.activeElement;
          if (
            focused instanceof HTMLElement &&
            shell.current?.contains(focused) &&
            focused.closest(".onun-video-player__dock")
          )
            shell.current.focus({ preventScroll: true });
          setPlaying(false);
          setWaiting(false);
        }}
        onEnded={() => {
          setPlaying(false);
          setWaiting(false);
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onError={(event) => {
          setFailed(true);
          setPlaying(false);
          setWaiting(false);
          onError?.(event);
        }}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          setVolume(video.volume);
          setMuted(video.muted);
          if (video.volume > 0) lastVolume.current = video.volume;
        }}
      />
      {!playing && !failed && (
        <button
          className="onun-video-player__start"
          type="button"
          aria-label={`${text("Reproduzir", "Play")}: ${title}`}
          onClick={() => void startPlayback()}
        >
          <PlayFilled size={36} aria-hidden="true" />
        </button>
      )}
      {waiting && playing && (
        <span className="onun-video-player__loading" role="status">
          <span aria-hidden="true" />
          <span className="onun-video-player__sr">
            {text("Carregando vídeo…", "Loading video…")}
          </span>
        </span>
      )}
      {failed && (
        <div className="onun-video-player__error" role="status">
          <p>
            {text(
              "Não foi possível carregar o vídeo.",
              "Could not load the video.",
            )}
          </p>
          <button type="button" onClick={() => void startPlayback()}>
            <RefreshCw size={16} aria-hidden="true" />
            {text("Tentar novamente", "Try again")}
          </button>
        </div>
      )}
      {notice && (
        <p className="onun-video-player__notice" role="status">
          {notice}
        </p>
      )}
      <div
        className="onun-video-player__dock"
        aria-hidden={!playing}
        inert={!playing}
        role="group"
        aria-label={text("Controles do vídeo", "Video controls")}
      >
        <button
          className="onun-video-player__button onun-video-player__play"
          type="button"
          onClick={togglePlayback}
          aria-label={playLabel}
          title={playLabel}
        >
          {playing ? (
            <PauseFilled size={15} aria-hidden="true" />
          ) : (
            <PlayFilled size={15} aria-hidden="true" />
          )}
        </button>
        <div className="onun-video-player__timeline">
          <span className="onun-video-player__time" aria-hidden="true">
            {timeLabel(currentTime)} <span>/ {timeLabel(duration)}</span>
          </span>
          <input
            className="onun-video-player__range"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration)}
            disabled={!duration || failed}
            aria-label={text("Posição do vídeo", "Video position")}
            aria-valuetext={`${timeLabel(currentTime)} ${text("de", "of")} ${timeLabel(duration)}`}
            style={
              {
                "--video-progress": `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
              } as CSSProperties
            }
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
        </div>
        <div className="onun-video-player__sound">
          <button
            className="onun-video-player__button"
            type="button"
            onClick={toggleSound}
            aria-label={soundLabel}
            title={soundLabel}
          >
            {silent ? (
              <VolumeMuted size={17} aria-hidden="true" />
            ) : (
              <Volume size={17} aria-hidden="true" />
            )}
          </button>
          <input
            className="onun-video-player__range onun-video-player__volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={silent ? 0 : volume}
            aria-label="Volume"
            aria-valuetext={`${Math.round((silent ? 0 : volume) * 100)}%`}
            style={
              {
                "--video-progress": `${(silent ? 0 : volume) * 100}%`,
              } as CSSProperties
            }
            onChange={(event) =>
              changeVolume(Number(event.currentTarget.value))
            }
          />
        </div>
        {canFullscreen && (
          <button
            className="onun-video-player__button"
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={
              fullscreen
                ? text("Sair da tela cheia", "Exit fullscreen")
                : text("Tela cheia", "Fullscreen")
            }
            title={
              fullscreen
                ? text("Sair da tela cheia", "Exit fullscreen")
                : text("Tela cheia", "Fullscreen")
            }
          >
            {fullscreen ? (
              <Minimize size={16} aria-hidden="true" />
            ) : (
              <Maximize size={16} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
