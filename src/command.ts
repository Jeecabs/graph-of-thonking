import { BorderedLoader, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { actions, type Query } from "./operations.js";

function parseQuery(input: string): Query {
  const parts = input.trim().split(/\s+/);
  if (parts.length < 1) throw new Error("Choose a Thonking action.");
  const [action] = parts;
  if (!action || !actions.some(known => known === action)) throw new Error(`Unknown action. Choose: ${actions.join(", ")}`);
  return { action: action as Query["action"], target: input.trim().slice(action.length).trim() || undefined };
}

export async function chooseQuery(input: string, ctx: ExtensionCommandContext): Promise<Query | undefined> {
  if (input.trim()) return parseQuery(input);
  if (!ctx.hasUI) return { action: "status" };
  const chosen = await ctx.ui.select("Graph of Thonking", [...actions]);
  if (!chosen) return;
  if (["map", "situ", "tests", "review", "quality", "status"].includes(chosen)) return parseQuery(chosen);
  const target = await ctx.ui.input(`Thonking ${chosen}: target`);
  if (!target?.trim()) return;
  return parseQuery(`${chosen} ${target}`);
}

export async function withLoader<T>(ctx: ExtensionCommandContext, action: string, task: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (ctx.mode !== "tui") return task(ctx.signal);
  const result = await ctx.ui.custom<T | Error>((tui, theme, _keys, done) => {
    const loader = new BorderedLoader(tui, theme, `Thonking ${action}`);
    // Keep the dialog until the cancelled process exits, before cache cleanup can start.
    loader.onAbort = () => {};
    void task(loader.signal).then(done, error => done(error instanceof Error ? error : new Error(String(error))));
    return loader;
  });
  if (result instanceof Error) throw result;
  return result;
}
