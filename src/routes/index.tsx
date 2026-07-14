import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendDiscordMessage } from "@/lib/discord.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discord Auto Sender — Campaigns" },
      { name: "description", content: "Send Discord messages to multiple channels with anti-detection: random delays, typing indicators, shuffling." },
      { property: "og:title", content: "Discord Auto Sender — Campaigns" },
      { property: "og:description", content: "Multi-channel Discord message sender with anti-detection." },
    ],
  }),
  component: Index,
});

type Target = { id: string; channelId: string; message: string };

const newTarget = (): Target => ({
  id: Math.random().toString(36).slice(2, 9),
  channelId: "",
  message: "",
});

function jitter(base: number, jitterPct: number) {
  const delta = base * (jitterPct / 100);
  return Math.max(0, Math.round(base + (Math.random() * 2 - 1) * delta));
}

function shuffled<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Index() {
  const send = useServerFn(sendDiscordMessage);
  const [token, setToken] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [targets, setTargets] = useState<Target[]>([newTarget()]);
  const [rounds, setRounds] = useState(1);
  const [minDelay, setMinDelay] = useState(4000);
  const [maxDelay, setMaxDelay] = useState(9000);
  const [roundDelay, setRoundDelay] = useState(60000);
  const [roundJitter, setRoundJitter] = useState(30);
  const [shuffle, setShuffle] = useState(true);
  const [typing, setTyping] = useState(true);
  const [running, setRunning] = useState(false);
  const [stopFlag, setStopFlag] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));

  const updateTarget = (id: string, patch: Partial<Target>) =>
    setTargets((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTarget = () => setTargets((ts) => [...ts, newTarget()]);
  const removeTarget = (id: string) =>
    setTargets((ts) => (ts.length > 1 ? ts.filter((t) => t.id !== id) : ts));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (!token.trim()) {
      append("✗ Token required");
      return;
    }
    const valid = targets.filter((t) => t.channelId.trim() && t.message.trim());
    if (valid.length === 0) {
      append("✗ Add at least one channel + message");
      return;
    }
    if (minDelay > maxDelay) {
      append("✗ Min delay > max delay");
      return;
    }
    setRunning(true);
    setStopFlag(false);
    append(`▶ Starting: ${valid.length} target(s) × ${rounds} round(s)`);
    try {
      outer: for (let r = 0; r < rounds; r++) {
        const order = shuffle ? shuffled(valid) : valid;
        append(`— Round ${r + 1}/${rounds}`);
        for (let i = 0; i < order.length; i++) {
          if (stopFlag) break outer;
          const t = order[i];
          try {
            const res = await send({
              data: { token, channelId: t.channelId, message: t.message, isBot, typing },
            });
            append(
              res.ok
                ? `✓ #${t.channelId.slice(-6)} (${i + 1}/${order.length})`
                : `✗ #${t.channelId.slice(-6)} → ${res.status}: ${res.error}`,
            );
            if (!res.ok && res.status === 429) {
              append("⏸ Rate limited — pausing 30s");
              await new Promise((r) => setTimeout(r, 30000));
            }
          } catch (err) {
            append(`✗ ${err instanceof Error ? err.message : String(err)}`);
          }
          if (i < order.length - 1) {
            const wait = minDelay + Math.random() * (maxDelay - minDelay);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        if (r < rounds - 1) {
          const wait = jitter(roundDelay, roundJitter);
          append(`⏱ Round pause ${(wait / 1000).toFixed(1)}s`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      append("■ Done");
    } finally {
      setRunning(false);
      setStopFlag(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Discord Auto Sender</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Run campaigns across multiple channels with anti-detection (random delays, typing, shuffle).
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={isBot} onChange={() => setIsBot(true)} />
              Bot token
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!isBot} onChange={() => setIsBot(false)} />
              User token
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Your Discord token"
              required
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Targets ({targets.length})</label>
              <button
                type="button"
                onClick={addTarget}
                className="rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"
              >
                + Add
              </button>
            </div>
            {targets.map((t, i) => (
              <div key={t.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Target #{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeTarget(t.id)}
                    disabled={targets.length === 1}
                    className="text-destructive hover:underline disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
                <input
                  value={t.channelId}
                  onChange={(e) => updateTarget(t.id, { channelId: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Channel ID"
                />
                <textarea
                  value={t.message}
                  onChange={(e) => updateTarget(t.id, { message: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Message"
                />
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="text-sm font-medium">Anti-detection</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs">Min delay (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={minDelay}
                  onChange={(e) => setMinDelay(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Max delay (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={maxDelay}
                  onChange={(e) => setMaxDelay(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Rounds</label>
                <input
                  type="number"
                  min={1}
                  value={rounds}
                  onChange={(e) => setRounds(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Round pause (ms)</label>
                <input
                  type="number"
                  min={0}
                  value={roundDelay}
                  onChange={(e) => setRoundDelay(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs">Round jitter (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={roundJitter}
                  onChange={(e) => setRoundJitter(Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
                Shuffle order each round
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={typing} onChange={(e) => setTyping(e.target.checked)} />
                Send typing indicator
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={running}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {running ? "Running..." : "Start campaign"}
            </button>
            {running && (
              <button
                type="button"
                onClick={() => setStopFlag(true)}
                className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                Stop
              </button>
            )}
          </div>
        </form>

        {log.length > 0 && (
          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Log</h2>
            <ul className="space-y-1 text-xs font-mono text-muted-foreground max-h-64 overflow-auto">
              {log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Note: Using user (self) tokens violates Discord's Terms of Service and may result in bans. Anti-detection reduces but does not eliminate risk. Prefer bot tokens.
        </p>
      </div>
    </div>
  );
}
