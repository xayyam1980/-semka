// S7 Czytanie: the shared reading text, next to the tasks that use it.
import type { PublicStimulus } from "../../../shared/ipc";
import { Rich, type RichContext } from "./Rich";

export function ReadingPane({ text, ctx, lang }: { text: PublicStimulus; ctx: RichContext; lang?: string | undefined }) {
  const lines = text.lines ?? [];
  const poem = text.kind === "poem";
  const numbered = text.lineNumbering === "every" || text.lineNumbering === "every5";
  let verse = 0;
  return (
    <article className="reading-pane" lang={lang} aria-label={`Tekst: ${text.title ?? "tekst do zadań"}`} data-testid="reading-pane">
      {text.author && <p className="reading-author">{text.author}</p>}
      {text.title && <h2 className="reading-title">{text.title}</h2>}
      <div className={poem ? "reading-poem" : "reading-prose"}>
        {lines.map((l, i) => {
          if (poem && !l.trim()) return <div key={i} className="reading-stanza-break" />;
          verse += 1;
          const showNo = numbered && (text.lineNumbering === "every" || verse % 5 === 0);
          return (
            <div key={i} className="reading-line">
              {numbered && <span className="reading-no" aria-hidden={!showNo}>{showNo ? verse : ""}</span>}
              <Rich text={l} ctx={ctx} inline />
            </div>
          );
        })}
      </div>
      {text.source && <p className="reading-source">{text.source}</p>}
      {text.footnotes && text.footnotes.length > 0 && (
        <ol className="reading-footnotes">
          {text.footnotes.map((f) => (
            <li key={f.mark}>
              <sup>{f.mark}</sup> <Rich text={f.text} ctx={ctx} inline />
            </li>
          ))}
        </ol>
      )}
      {text.wordCount && <p className="reading-count tabular" lang={lang ? "pl" : undefined}>[{text.wordCount} wyrazów]</p>}
    </article>
  );
}

/** The reading text a task uses, if any (figures are separate stimuli). */
export function readingTextOf(stimulusIds: string[], stimuli: PublicStimulus[]): PublicStimulus | undefined {
  return stimuli.find((s) => stimulusIds.includes(s.id) && (s.kind === "text" || s.kind === "poem"));
}
