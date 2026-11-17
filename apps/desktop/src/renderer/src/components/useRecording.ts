// The session recording as a blob URL, loaded once per session over IPC and shared by all players.
import { useEffect, useState } from "react";

const cache = new Map<string, Promise<string | null>>();

export function useRecording(sessionId: string, wanted: boolean): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!wanted) return setUrl(null);
    let p = cache.get(sessionId);
    if (!p) {
      p = window.osemka.getRecording(sessionId).then((bytes) => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/mpeg" })) : null));
      cache.set(sessionId, p);
    }
    let live = true;
    void p.then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [sessionId, wanted]);
  return url;
}
