/**
 * Remielle desktop pet — DSH plugin, node half.
 *
 * 1. Registers the `remielle` session projection (per-session phase machine).
 * 2. Serves pet assets (GIF/PNG) under /plugins/remielle-dsh/assets/.
 *
 *   working   <- turn/start, step/start, tool/call (the agent is busy)
 *   waiting   <- approval/asked, turn/end(blocked)  (needs the human)
 *   celebrate <- turn/end(completed)                (a turn finished well)
 *   failed    <- turn/end(error)                    (a turn errored)
 *   idle      <- everything else                    (no live work)
 *
 * The expect → "waiting for confirmation" countdown is a browser-side concern.
 */
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const MIME = { ".gif": "image/gif", ".png": "image/png" };

const remielleSchema = z.object({
  phase: z.enum(["working", "waiting", "celebrate", "failed", "idle"]),
});

/** Pure transition: previous state + one committed event → next state. */
function applyRemielle(state, event) {
  switch (event.type) {
    case "turn/start":
    case "step/start":
    case "tool/call":
      if (state.phase === "working") return state;
      return { phase: "working" };
    case "approval/asked":
      return { phase: "waiting" };
    case "turn/end": {
      const kind = event.reason && event.reason.kind;
      if (kind === "completed") return { phase: "celebrate" };
      if (kind === "error") return { phase: "failed" };
      if (kind === "blocked") return { phase: "waiting" };
      return { phase: "idle" };
    }
    default:
      return state;
  }
}

/** Host plugin body. */
export function apply(ctx) {
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: "remielle",
      schema: remielleSchema,
      init: () => ({ phase: "idle" }),
      apply: applyRemielle,
      view: (state) => state,
      stateVersion: 1,
    });
  });

  ctx.inject(["webServer"], (webCtx) => {
    webCtx.webServer.register({
      kind: "prefix",
      path: "/plugins/remielle-dsh/assets",
      handler: async (req, res) => {
        const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
        const rel = pathname.slice("/plugins/remielle-dsh/assets/".length);
        const ext = extname(rel).toLowerCase();
        if (!(ext in MIME)) {
          res.writeHead(404);
          res.end();
          return;
        }
        // Reject traversal: forbid any path escape above ASSET_ROOT.
        const safe = normalize(rel);
        if (safe.includes("..") || safe.startsWith("/")) {
          res.writeHead(404);
          res.end();
          return;
        }
        try {
          const body = await readFile(join(ASSET_ROOT, safe));
          res.writeHead(200, {
            "content-type": MIME[ext],
            "cache-control": "no-cache",
          });
          res.end(body);
        } catch {
          res.writeHead(404);
          res.end();
        }
      },
    });
  });
}
