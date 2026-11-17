// Listening in practice and review: this task's part of the CKE recording, played like in the exam (announcement,
// time to read the questions, each text twice), with pause, seek and "skip the reading time".
// In a simulation the whole recording plays once instead (RecordingBar).
import { useEffect, useRef, useState } from "react";
import type { PublicStimulus } from "../../../shared/ipc";
import { useSettings } from "../settings";
import { useRecording } from "./useRecording";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function listeningOf(stimulusIds: string[], stimuli: PublicStimulus[]): PublicStimulus | undefined {
  return stimuli.find((s) => stimulusIds.includes(s.id) && s.kind === "audio" && s.audio);
}

export function ListeningPlayer({ sessionId, stimulus, available }: { sessionId: string; stimulus: PublicStimulus; available: boolean }) {
  const seg = stimulus.audio!;
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(seg.startSec);
  const length = seg.endSec - seg.startSec;
  const src = useRecording(sessionId, available);
  const { settings } = useSettings();
  const [rate, setRate] = useState<number>(settings?.defaultPlaybackRate ?? 1);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, src]);

  // A new task (another segment of the same file): stop and go back to its start.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.pause();
    setPlaying(false);
    setPos(seg.startSec);
    if (a.readyState > 0) a.currentTime = seg.startSec;
  }, [seg.startSec, seg.endSec]);

  if (src === undefined) return <div className="listening text-muted">Ładowanie nagrania…</div>;
  if (!available || !stimulus.asset || !src)
    return (
      <div className="listening" data-testid="listening-missing">
        <b>Nagranie</b> nie jest dostępne na tym komputerze. Zadanie możesz rozwiązać po przeczytaniu transkrypcji po sprawdzeniu.
      </div>
    );

  const seek = (t: number) => {
    const a = audio.current!;
    a.currentTime = Math.min(seg.endSec, Math.max(seg.startSec, t));
    setPos(a.currentTime);
  };
  const toggle = async () => {
    const a = audio.current!;
    if (playing) return a.pause();
    if (a.currentTime < seg.startSec || a.currentTime >= seg.endSec - 0.2) a.currentTime = seg.startSec;
    await a.play();
  };
  const inReadingTime = seg.playsStartSec !== undefined && pos < seg.playsStartSec - 1;

  return (
    <div className="listening" data-testid="listening">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = seg.startSec;
          e.currentTarget.volume = settings?.defaultVolume ?? 1;
          e.currentTarget.playbackRate = rate;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (t >= seg.endSec) {
            e.currentTarget.pause();
            e.currentTarget.currentTime = seg.endSec;
          }
          setPos(Math.min(t, seg.endSec));
        }}
      />
      <button className="btn primary" onClick={() => void toggle()} data-testid="listen-toggle" aria-label={playing ? "Zatrzymaj nagranie" : "Odtwórz nagranie"}>
        {playing ? "❚❚ Pauza" : pos > seg.startSec + 0.5 && pos < seg.endSec - 0.5 ? "▶ Wznów" : "▶ Odtwórz"}
      </button>
      <input
        type="range"
        className="listening-bar"
        min={0}
        max={length}
        step={0.5}
        value={pos - seg.startSec}
        onChange={(e) => seek(seg.startSec + Number(e.target.value))}
        aria-label="Pozycja w nagraniu"
      />
      <span className="tabular text-sm text-muted">
        {fmt(pos - seg.startSec)} / {fmt(length)}
      </span>
      <label className="flex items-center gap-1 text-sm">
        Tempo
        <select className="rounded-md border border-line bg-surface px-1.5 py-1" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Tempo nagrania" data-testid="listen-rate">
          <option value={0.75}>0,75×</option>
          <option value={0.9}>0,9×</option>
          <option value={1}>1×</option>
        </select>
      </label>
      {inReadingTime && (
        <button className="btn ghost" onClick={() => seek(seg.playsStartSec!)} data-testid="listen-skip">
          Pomiń czas na zapoznanie się z zadaniem
        </button>
      )}
      <p className="w-full text-sm text-muted">Jak na egzaminie: polecenie, czas na przeczytanie pytań, potem każdy tekst dwa razy.</p>
    </div>
  );
}
