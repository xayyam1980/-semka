// Simulation: the whole CKE recording plays once from the start of the exam, like in the exam room: no pause, no
// going back. Its position follows the clock (time since the exam started), so reopening the app resumes it.
import { useEffect, useRef, useState } from "react";
import type { PublicStimulus } from "../../../shared/ipc";
import { useSettings } from "../settings";
import { useRecording } from "./useRecording";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function RecordingBar({ sessionId, asset, startedAtLocal, stimuli, taskNumberOf }: {
  sessionId: string;
  asset: string;
  /** When the exam started, on this window's clock (ms). */
  startedAtLocal: number;
  stimuli: PublicStimulus[];
  taskNumberOf: (stimulusId: string) => number | undefined;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState<number>();
  const [pos, setPos] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const { settings } = useSettings();
  const [volume, setVolume] = useState(settings?.defaultVolume ?? 1);
  const src = useRecording(sessionId, !!asset);
  const elapsed = () => (Date.now() - startedAtLocal) / 1000;

  const start = async () => {
    const a = audio.current;
    if (!a || !a.duration) return;
    const t = elapsed();
    if (t >= a.duration) return setPos(a.duration);
    a.currentTime = t;
    try {
      await a.play();
      setBlocked(false);
    } catch {
      setBlocked(true); // the window did not allow playing without a click
    }
  };

  // Keep the recording on the exam clock (a paused or throttled window catches up).
  useEffect(() => {
    const id = setInterval(() => {
      const a = audio.current;
      if (!a || !a.duration || a.paused) return;
      if (Math.abs(a.currentTime - elapsed()) > 2 && elapsed() < a.duration) a.currentTime = elapsed();
    }, 1000);
    return () => clearInterval(id);
  });

  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);

  const done = duration !== undefined && pos >= duration - 0.5;
  const current = stimuli.find((s) => s.audio && pos >= s.audio.startSec && pos < s.audio.endSec);
  const now = current ? taskNumberOf(current.id) : undefined;

  return (
    <div className="recording" data-testid="recording">
      <audio
        ref={audio}
        src={src ?? undefined}
        preload="auto"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          void start();
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onEnded={(e) => setPos(e.currentTarget.duration)}
        onPause={(e) => {
          // Pausing is not allowed; only the end of the file or a blocked autoplay stops it.
          if (!e.currentTarget.ended && elapsed() < (duration ?? Infinity)) void start();
        }}
      />
      <span className="font-bold">🎧 Nagranie</span>
      {blocked ? (
        <button className="btn primary" onClick={() => void start()} data-testid="recording-start">
          ▶ Włącz nagranie
        </button>
      ) : (
        <span className="text-sm">{done ? "zakończone" : now ? `zadanie ${now}` : duration ? "trwa" : "ładowanie…"}</span>
      )}
      <div className="recording-progress" aria-hidden>
        <div style={{ width: `${duration ? Math.min(100, (pos / duration) * 100) : 0}%` }} />
      </div>
      <span className="tabular text-sm">
        {fmt(pos)} / {duration ? fmt(duration) : "–:––"}
      </span>
      <label className="flex items-center gap-1 text-sm">
        Głośność
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Głośność nagrania" />
      </label>
    </div>
  );
}
