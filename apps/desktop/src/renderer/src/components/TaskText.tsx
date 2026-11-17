import type { ResponseValue } from "@osemka/schema";
import { useMemo } from "react";
import type { PublicTask } from "../../../shared/ipc";
import { Rich, type RichContext } from "./Rich";

/** Task instruction; answer slots ([[A|B]]) show the option chosen for that slot. */
export function TaskText({ task, values, ctx }: { task: PublicTask; values: Record<string, ResponseValue | null>; ctx: RichContext }) {
  const it = task.items[0]!;
  const r = it.response;
  const v = values[it.id];
  const slotCtx = useMemo<RichContext>(() => {
    if (r.type !== "choice_with_reason") return ctx;
    const chosen = v?.type === "choices" ? v.value : {};
    return {
      ...ctx,
      slotText: (a) => {
        const part = r.choices.some((o) => o.id === a) ? "choice" : "reason";
        const id = chosen[part];
        const opt = [...r.choices, ...r.reasons].find((o) => o.id === id);
        return opt ? (opt.text.includes("$") ? opt.id : opt.text) : "";
      },
    };
  }, [ctx, r, v]);
  return <Rich text={task.instruction} ctx={slotCtx} />;
}
