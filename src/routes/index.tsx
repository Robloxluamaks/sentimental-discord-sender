import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

// Human-typing duration model: ~4 chars/second with realistic variance,
// clamped to feel natural even for very short or long messages.
function humanTypingMs(text: string) {
  const base = 400 + text.length * (180 + Math.random() * 120);
  const variance = base * (0.15 + Math.random() * 0.25);
  return Math.min(14000, Math.round(base + (Math.random() * 2 - 1) * variance));
}

function Index() {
  const send = useServerFn(sendDiscordMessage);
  const [token, setToken] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [targets, setTargets] = useState<Target[]>([newTarget()]);
  const [rounds, setRounds] = useState(1);
  const [minDelay, setMinDelay] = useState(8000);
  const [maxDelay, setMaxDelay] = useState(22000);
  const [roundDelay, setRoundDelay] = useState(180000);
  const [roundJitter, setRoundJitter] = useState(30);
  const [shuffle, setShuffle] = useState(true);
  const [typing, setTyping] = useState(true);
  const [humanTyping, setHumanTyping] = useState(true);
  const [longBreakEvery, setLongBreakEvery] = useState(8);
  const [longBreakMs, setLongBreakMs] = useState(120000);
  const [skipChance, setSkipChance] = useState(0);
  const [running, setRunning] = useState(false);
  const [stopFlag, setStopFlag] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState({ sent: 0, failed: 0 });
  const [status, setStatus] = useState<"idle" | "typing" | "sending" | "waiting">("idle");
  const [nextInMs, setNextInMs] = useState(0);

  useEffect(() => {
    if (nextInMs <= 0) return;
    const t = setInterval(() => setNextInMs((v) => Math.max(0, v - 250)), 250);
    return () => clearInterval(t);
  }, [nextInMs]);

  const wait = async (ms: number) => {
    setStatus("waiting");
    setNextInMs(ms);
    await new Promise((r) => setTimeout(r, ms));
    setNextInMs(0);
  };

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
      append("✗ TOKEN REQUIRED");
      return;
    }
    const valid = targets.filter((t) => t.channelId.trim() && t.message.trim());
    if (valid.length === 0) {
      append("✗ ADD AT LEAST ONE TARGET");
      return;
    }
    if (minDelay > maxDelay) {
      append("✗ MIN DELAY > MAX DELAY");
      return;
    }
    setRunning(true);
    setStopFlag(false);
    setStats({ sent: 0, failed: 0 });
    append(`▶ INIT · ${valid.length} target(s) × ${rounds} round(s)`);
    let sentCounter = 0;
    try {
      outer: for (let r = 0; r < rounds; r++) {
        const order = shuffle ? shuffled(valid) : valid;
        append(`── ROUND ${r + 1}/${rounds} ──`);
        for (let i = 0; i < order.length; i++) {
          if (stopFlag) break outer;
          const t = order[i];
          // Randomly skip to break patterns
          if (skipChance > 0 && Math.random() * 100 < skipChance) {
            append(`↷ skip #${t.channelId.slice(-6)} (pattern break)`);
            continue;
          }
          const tMs = humanTyping ? humanTypingMs(t.message) : 1500;
          if (typing) {
            setStatus("typing");
            append(`✎ typing #${t.channelId.slice(-6)} (~${(tMs / 1000).toFixed(1)}s)`);
          }
          try {
            setStatus("sending");
            const res = await send({
              data: {
                token,
                channelId: t.channelId,
                message: t.message,
                isBot,
                typing,
                typingMs: tMs,
              },
            });
            if (res.ok) {
              sentCounter++;
              setStats((s) => ({ ...s, sent: s.sent + 1 }));
              append(`✓ sent #${t.channelId.slice(-6)}`);
            } else {
              setStats((s) => ({ ...s, failed: s.failed + 1 }));
              append(`✗ #${t.channelId.slice(-6)} → ${res.status}: ${res.error.slice(0, 80)}`);
              if (res.status === 429) {
                const backoff = Math.max(30000, Math.round((res.retryAfter ?? 30) * 1000));
                append(`⏸ RATE LIMIT · cooling ${(backoff / 1000).toFixed(0)}s`);
                await wait(backoff);
              } else if (res.status === 401 || res.status === 403) {
                append("■ ABORT · token invalid or forbidden");
                break outer;
              }
            }
          } catch (err) {
            setStats((s) => ({ ...s, failed: s.failed + 1 }));
            append(`✗ ${err instanceof Error ? err.message : String(err)}`);
          }

          // Long break every N sends to mimic human breaks
          if (
            longBreakEvery > 0 &&
            sentCounter > 0 &&
            sentCounter % longBreakEvery === 0 &&
            !(r === rounds - 1 && i === order.length - 1)
          ) {
            const brk = jitter(longBreakMs, 40);
            append(`☕ LONG BREAK · ${(brk / 1000).toFixed(0)}s`);
            await wait(brk);
          }

          if (i < order.length - 1) {
            const w = Math.round(minDelay + Math.random() * (maxDelay - minDelay));
            await wait(w);
          }
        }
        if (r < rounds - 1) {
          const w = jitter(roundDelay, roundJitter);
          append(`⏱ ROUND PAUSE · ${(w / 1000).toFixed(1)}s`);
          await wait(w);
        }
      }
      append("■ CAMPAIGN COMPLETE");
    } finally {
      setRunning(false);
      setStopFlag(false);
      setStatus("idle");
      setNextInMs(0);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative mx-auto max-w-6xl px-6 py-10">
        {/* HEADER */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-primary">
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse-neon" />
              signal//outbound
            </div>
            <h1 className="mt-2 font-display text-5xl font-bold tracking-tight text-glow">
              GHOST<span className="text-primary">.</span>SEND
            </h1>
            <p className="mt-2 max-w-lg font-mono text-xs text-muted-foreground">
              multi-channel discord dispatcher · human-behavior emulation · rotating client fingerprints
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <Stat label="sent" value={stats.sent} tone="neon" />
            <Stat label="fail" value={stats.failed} tone="danger" />
            <StatusPill status={status} nextInMs={nextInMs} />
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* LEFT COLUMN */}
          <form onSubmit={onSubmit} className="space-y-6">
            {/* AUTH PANEL */}
            <Panel label="01 // auth">
              <div className="flex gap-2">
                <TokenTypeButton active={isBot} onClick={() => setIsBot(true)} label="BOT" hint="recommended" />
                <TokenTypeButton active={!isBot} onClick={() => setIsBot(false)} label="USER" hint="ToS risk" />
              </div>
              <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary focus:shadow-[0_0_0_1px_var(--color-primary)]"
                placeholder="•••••••••••••••••••"
                required
              />
            </Panel>

            {/* TARGETS PANEL */}
            <Panel
              label={`02 // targets [${targets.length}]`}
              action={
                <button
                  type="button"
                  onClick={addTarget}
                  className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                >
                  + add target
                </button>
              }
            >
              <div className="space-y-3">
                {targets.map((t, i) => (
                  <div
                    key={t.id}
                    className="group relative rounded-md border border-border bg-background/40 p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                        node_{String(i).padStart(2, "0")}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTarget(t.id)}
                        disabled={targets.length === 1}
                        className="font-mono text-[10px] uppercase tracking-wider text-destructive opacity-0 transition-opacity hover:underline disabled:opacity-0 group-hover:opacity-100"
                      >
                        purge
                      </button>
                    </div>
                    <input
                      value={t.channelId}
                      onChange={(e) => updateTarget(t.id, { channelId: e.target.value })}
                      className="w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      placeholder="channel_id"
                    />
                    <textarea
                      value={t.message}
                      onChange={(e) => updateTarget(t.id, { message: e.target.value })}
                      rows={2}
                      className="mt-2 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      placeholder="payload..."
                    />
                  </div>
                ))}
              </div>
            </Panel>

            {/* ANTI-DETECT PANEL */}
            <Panel label="03 // stealth profile">
              <div className="grid grid-cols-2 gap-3">
                <Field label="min delay (ms)" value={minDelay} onChange={setMinDelay} />
                <Field label="max delay (ms)" value={maxDelay} onChange={setMaxDelay} />
                <Field label="rounds" value={rounds} onChange={(v) => setRounds(Math.max(1, v))} />
                <Field label="round pause (ms)" value={roundDelay} onChange={setRoundDelay} />
                <Field label="round jitter %" value={roundJitter} onChange={(v) => setRoundJitter(Math.max(0, Math.min(100, v)))} />
                <Field label="skip chance %" value={skipChance} onChange={(v) => setSkipChance(Math.max(0, Math.min(50, v)))} />
                <Field label="long break every N" value={longBreakEvery} onChange={(v) => setLongBreakEvery(Math.max(0, v))} />
                <Field label="long break (ms)" value={longBreakMs} onChange={setLongBreakMs} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <Toggle checked={shuffle} onChange={setShuffle} label="shuffle order" />
                <Toggle checked={typing} onChange={setTyping} label="typing indicator" />
                <Toggle checked={humanTyping} onChange={setHumanTyping} label="human-typing time" />
              </div>
            </Panel>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={running}
                className="group relative flex-1 overflow-hidden rounded-md border border-primary bg-primary/10 px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                <span className="relative z-10">{running ? "▮▮ transmitting..." : "▶ execute campaign"}</span>
                {!running && <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />}
              </button>
              {running && (
                <button
                  type="button"
                  onClick={() => setStopFlag(true)}
                  className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 font-mono text-sm font-bold uppercase tracking-wider text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  ■ abort
                </button>
              )}
            </div>
          </form>

          {/* RIGHT COLUMN — TERMINAL */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="scanlines overflow-hidden rounded-md border border-border bg-background/80 shadow-[var(--shadow-panel)]">
              <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  ~ /ghost/session.log
                </span>
              </div>
              <ul className="h-[520px] overflow-auto p-4 font-mono text-[11px] leading-relaxed">
                {log.length === 0 && (
                  <li className="text-muted-foreground">
                    <span className="text-primary">$</span> awaiting command<span className="animate-blink">_</span>
                  </li>
                )}
                {log.map((line, i) => (
                  <li key={i} className={logColor(line)}>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-4 rounded-md border border-warn/30 bg-warn/5 p-3 font-mono text-[10px] leading-relaxed text-warn">
              ⚠ DISCLAIMER: no anti-detect is 100% safe. discord tracks IP, device fingerprint, and user reports. user tokens violate ToS. prefer bot tokens & keep volume low.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function logColor(line: string) {
  if (line.includes("✓")) return "text-primary";
  if (line.includes("✗") || line.includes("ABORT")) return "text-destructive";
  if (line.includes("⏸") || line.includes("☕") || line.includes("⏱")) return "text-warn";
  if (line.includes("✎") || line.includes("↷")) return "text-accent";
  if (line.includes("──") || line.includes("▶") || line.includes("■")) return "text-primary/80";
  return "text-muted-foreground";
}

function Panel({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card/60 p-5 backdrop-blur-sm shadow-[var(--shadow-panel)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-2 rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        checked
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-input text-muted-foreground hover:border-primary/30"
      }`}
    >
      <span>{label}</span>
      <span className={`h-2 w-2 rounded-full ${checked ? "bg-primary shadow-[0_0_8px_var(--color-primary)]" : "bg-muted-foreground/40"}`} />
    </button>
  );
}

function TokenTypeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-4 py-3 text-left transition-all ${
        active
          ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_var(--color-primary)]"
          : "border-border bg-input/50 hover:border-primary/40"
      }`}
    >
      <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{label}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{hint}</div>
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neon" | "danger" }) {
  return (
    <div
      className={`rounded-sm border px-3 py-2 text-right ${
        tone === "neon" ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <div className={`font-mono text-lg font-bold leading-none ${tone === "neon" ? "text-primary" : "text-destructive"}`}>
        {String(value).padStart(3, "0")}
      </div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusPill({ status, nextInMs }: { status: string; nextInMs: number }) {
  const map: Record<string, { label: string; color: string }> = {
    idle: { label: "STANDBY", color: "text-muted-foreground border-border" },
    typing: { label: "TYPING", color: "text-accent border-accent/40 bg-accent/10" },
    sending: { label: "TX", color: "text-primary border-primary/40 bg-primary/10" },
    waiting: {
      label: nextInMs > 0 ? `WAIT ${(nextInMs / 1000).toFixed(1)}s` : "WAIT",
      color: "text-warn border-warn/40 bg-warn/10",
    },
  };
  const s = map[status] ?? map.idle;
  return (
    <div className={`rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${s.color}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
      {s.label}
    </div>
  );
}
