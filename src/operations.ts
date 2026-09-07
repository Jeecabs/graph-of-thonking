import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const actions = ["map", "search", "pack", "recall", "expand", "outline", "callers", "callees", "uses", "impact", "verify", "graph", "situ", "tests", "review", "quality", "delta", "trace", "help", "status"] as const;
export const QuerySchema = Type.Object({
  action: StringEnum(actions),
  target: Type.Optional(Type.String({ minLength: 1, maxLength: 16000, description: "Task, symbol selector, graph expression, claim, trace file, or committed delta range. Depends on action." })),
  root: Type.Optional(Type.String({ minLength: 1, description: "Local checkout directory. Defaults to Pi cwd. No remote URLs." })),
  budget: Type.Optional(Type.Integer({ minimum: 256, maximum: 32000, description: "Token target for map/search/pack/recall/review/trace. Default 6000. Not a tokenizer guarantee." })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Row window for graph/quality. Map symbol cap. Recall document cap." })),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "Row offset for graph/quality/review." })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 300000, description: "Deadline in milliseconds. Default 60000." })),
}, { additionalProperties: false });
export type Query = Static<typeof QuerySchema>;

interface Operation {
  flag?: string;
  target: "required" | "optional" | "none";
  knobs?: Partial<Record<"budget" | "limit" | "offset", { flag: string; default?: number }>>;
  extras?: string[];
}
const budget = { flag: "token-budget", default: 6000 };
const maxTokens = { flag: "max-tokens", default: 6000 };
const limit = { flag: "limit" };
const offset = { flag: "offset" };
const operations: Record<Query["action"], Operation> = {
  map: { target: "none", knobs: { budget: maxTokens, limit: { flag: "top-k", default: 80 } } },
  search: { flag: "for", target: "required", knobs: { budget } },
  pack: { flag: "pack-task", target: "required", knobs: { budget } },
  recall: { flag: "recall", target: "required", knobs: { budget: maxTokens, limit: { flag: "top-k" } } },
  expand: { flag: "expand", target: "required" },
  outline: { flag: "outline", target: "required", extras: ["--top-k=0"] },
  callers: { flag: "callers", target: "required" },
  callees: { flag: "callees", target: "required" },
  uses: { flag: "uses", target: "required" },
  impact: { flag: "impact", target: "required" },
  verify: { flag: "verify", target: "required" },
  graph: { flag: "graph-query", target: "required", knobs: { limit, offset } },
  situ: { flag: "situ", target: "optional" },
  tests: { flag: "test-gate", target: "optional" },
  review: { flag: "pr-context", target: "optional", knobs: { budget, offset } },
  quality: { flag: "quality-panel", target: "none", knobs: { limit, offset } },
  delta: { flag: "quality-delta", target: "required" },
  trace: { flag: "from-trace", target: "required", knobs: { budget } },
  help: { flag: "help-task", target: "required" },
  status: { target: "none" },
};

function validateTarget(query: Query, operation: Operation): void {
  if (operation.target === "required" && !query.target?.trim()) throw new Error(`${query.action} requires target.`);
  if (operation.target === "none" && query.target !== undefined) throw new Error(`${query.action} does not accept target.`);
  if (query.target?.includes("\0")) throw new Error("target must not contain a NUL byte.");
  if (query.action === "delta" && query.target?.includes("...")) throw new Error("delta requires a commit or A..B range, not a three-dot range.");
}

function knobArgs(query: Query, operation: Operation): string[] {
  const args: string[] = [];
  for (const name of ["budget", "limit", "offset"] as const) {
    const knob = operation.knobs?.[name];
    if (query[name] !== undefined && !knob) throw new Error(`${name} is not supported for ${query.action}. Narrow the target instead.`);
    if (!knob) continue;
    const value = query[name] ?? knob.default;
    if (value !== undefined) args.push(`--${knob.flag}=${value}`);
  }
  return args;
}

export function buildArgs(query: Query, root: string): string[] {
  const operation = operations[query.action];
  validateTarget(query, operation);
  const knobs = knobArgs(query, operation);
  if (query.action === "status") return ["--version"];
  const args = [root];
  if (operation.flag) args.push(`--${operation.flag}${query.target ? `=${query.target}` : ""}`);
  return [...args, ...knobs, ...(operation.extras ?? [])];
}

export function outcome(action: Query["action"], code: number): "report" | "obligations" | "regressions" | "error" {
  if (code === 0) return "report";
  if (action === "tests" && code === 4) return "obligations";
  if (action === "delta" && code === 2) return "regressions";
  return "error";
}
