import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendDiscordMessage, fetchEmojiMap, type EmojiMap } from "@/lib/discord.functions";

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

type Target = {
  id: string;
  name: string;
  channelId: string;
  message: string;
  delaySec: number;
  loop: boolean;
};

const newTarget = (): Target => ({
  id: Math.random().toString(36).slice(2, 9),
  name: "campaign",
  channelId: "",
  message: "",
  delaySec: 60,
  loop: true,
});

function jitter(base: number, jitterPct: number) {
  const delta = base * (jitterPct / 100);
  // Jitter is additive only — never below the configured delay.
  return Math.max(0, Math.round(base + Math.random() * delta));
}

type StealthLevel = "low" | "balanced" | "max";
const STEALTH: Record<
  StealthLevel,
  { label: string; blurb: string; typing: boolean; humanTyping: boolean; jitterPct: number }
> = {
  low:      { label: "Fast",        blurb: "Sends quickly with minimal delay. Higher risk on user tokens.",           typing: false, humanTyping: false, jitterPct: 8 },
  balanced: { label: "Balanced",    blurb: "Typing indicator + up to +12% extra delay. Good default.",                 typing: true,  humanTyping: false, jitterPct: 12 },
  max:      { label: "Max Stealth", blurb: "Realistic typing time based on message length + up to +15% extra delay.", typing: true,  humanTyping: true,  jitterPct: 15 },
};

// Human-typing duration model: ~4 chars/second with realistic variance,
// clamped to feel natural even for very short or long messages.
function humanTypingMs(text: string) {
  const base = 400 + text.length * (180 + Math.random() * 120);
  const variance = base * (0.15 + Math.random() * 0.25);
  return Math.min(14000, Math.round(base + (Math.random() * 2 - 1) * variance));
}

type StoredConfig = {
  isBot: boolean;
  stealth: StealthLevel;
  targets: Target[];
  savedToken: string | null;
};
const PROFILES_KEY = "ghost-send:profiles";
const SESSION_KEY = "ghost-send:session";

function Index() {
  const send = useServerFn(sendDiscordMessage);
  const loadEmojis = useServerFn(fetchEmojiMap);
  const [token, setToken] = useState("");
  const [isBot, setIsBot] = useState(true);
  const [targets, setTargets] = useState<Target[]>([newTarget()]);
  const [stealth, setStealth] = useState<StealthLevel>("balanced");
  const [emojiMap, setEmojiMap] = useState<EmojiMap>({});
  const [emojisLoading, setEmojisLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const waitAbortersRef = useRef<Set<() => void>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState({ sent: 0, failed: 0 });

  // ── CONFIG SYSTEM ─────────────────────────────────────────────
  // Saves named profiles to localStorage. Token is opt-in per save.
  const [profiles, setProfiles] = useState<Record<string, StoredConfig>>({});
  const [profileName, setProfileName] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [includeToken, setIncludeToken] = useState(false);
  const hydratedRef = useRef(false);

  // Load registry + last session on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) setProfiles(JSON.parse(raw));
      const last = localStorage.getItem(SESSION_KEY);
      if (last) applyConfig(JSON.parse(last));
    } catch {}
    hydratedRef.current = true;
  }, []);

  // Autosave current working session (never includes token).
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const snap: StoredConfig = { isBot, stealth, targets, savedToken: null };
      localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
    } catch {}
  }, [isBot, stealth, targets]);

  const applyConfig = (c: StoredConfig) => {
    if (typeof c.isBot === "boolean") setIsBot(c.isBot);
    if (c.stealth) setStealth(c.stealth);
    if (Array.isArray(c.targets) && c.targets.length) {
      setTargets(c.targets.map((t: Target) => ({ ...newTarget(), ...t, id: Math.random().toString(36).slice(2, 9) })));
    }
    if (typeof c.savedToken === "string" && c.savedToken) setToken(c.savedToken);
  };

  const persistProfiles = (next: Record<string, StoredConfig>) => {
    setProfiles(next);
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(next)); } catch {}
  };

  const onSaveProfile = () => {
    const name = profileName.trim();
    if (!name) { append("✗ profile name required"); return; }
    const cfg: StoredConfig = {
      isBot, stealth, targets,
      savedToken: includeToken && token ? token : null,
    };
    persistProfiles({ ...profiles, [name]: cfg });
    setSelectedProfile(name);
    append(`✓ saved profile "${name}"${includeToken ? " (with token)" : ""}`);
  };

  const onLoadProfile = () => {
    const cfg = profiles[selectedProfile];
    if (!cfg) { append("✗ no profile selected"); return; }
    applyConfig(cfg);
    append(`✓ loaded profile "${selectedProfile}"`);
  };

  const onDeleteProfile = () => {
    if (!selectedProfile || !profiles[selectedProfile]) return;
    const next = { ...profiles };
    delete next[selectedProfile];
    persistProfiles(next);
    append(`■ deleted profile "${selectedProfile}"`);
    setSelectedProfile("");
  };

  const onExportProfiles = () => {
    const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghost-send-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    append(`⇡ exported ${Object.keys(profiles).length} profile(s)`);
  };

  const onImportProfiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const parsed = JSON.parse(txt) as Record<string, StoredConfig>;
        persistProfiles({ ...profiles, ...parsed });
        append(`⇣ imported ${Object.keys(parsed).length} profile(s)`);
      } catch {
        append("✗ invalid config file");
      }
    });
    e.target.value = "";
  };

  const wait = async (ms: number) => {
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        waitAbortersRef.current.delete(abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(t);
        waitAbortersRef.current.delete(abort);
        resolve();
      };
      waitAbortersRef.current.add(abort);
    });
  };

  const abortAll = () => {
    stopRef.current = true;
    for (const a of Array.from(waitAbortersRef.current)) a();
    append("■ ABORT REQUESTED");
  };

  const append = (line: string) =>
    setLog((l) => [`[${new Date().toLocaleTimeString()}] ${line}`, ...l].slice(0, 200));

  const updateTarget = (id: string, patch: Partial<Target>) =>
    setTargets((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const addTarget = () => setTargets((ts) => [...ts, newTarget()]);
  const removeTarget = (id: string) =>
    setTargets((ts) => (ts.length > 1 ? ts.filter((t) => t.id !== id) : ts));

  const onLoadEmojis = async () => {
    if (!token.trim()) {
      append("✗ TOKEN REQUIRED to fetch emojis");
      return;
    }
    setEmojisLoading(true);
    append("⇣ scanning guilds for custom emojis...");
    try {
      const res = await loadEmojis({ data: { token, isBot } });
      if (res.ok) {
        setEmojiMap(res.map);
        append(`✓ loaded ${res.emojiCount} emoji(s) from ${res.guildCount} guild(s)`);
      } else {
        append(`✗ emoji scan → ${res.status}: ${res.error.slice(0, 80)}`);
      }
    } catch (err) {
      append(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEmojisLoading(false);
    }
  };

  const runCampaign = async (t: Target) => {
    const tag = t.name.trim() || `#${t.channelId.slice(-6)}`;
    const preset = STEALTH[stealth];
    do {
      if (stopRef.current) break;
      const tMs = preset.humanTyping ? humanTypingMs(t.message) : 1500;
      if (preset.typing) append(`✎ [${tag}] typing (~${(tMs / 1000).toFixed(1)}s)`);
      try {
        const res = await send({
          data: {
            token,
            channelId: t.channelId,
            message: t.message,
            isBot,
            typing: preset.typing,
            typingMs: tMs,
            emojiMap: Object.keys(emojiMap).length ? emojiMap : undefined,
          },
        });
        if (res.ok) {
          setStats((s) => ({ ...s, sent: s.sent + 1 }));
          append(`✓ [${tag}] sent`);
        } else {
          setStats((s) => ({ ...s, failed: s.failed + 1 }));
          append(`✗ [${tag}] ${res.status}: ${res.error.slice(0, 80)}`);
          if (res.status === 429) {
            const backoff = Math.max(30000, Math.round((res.retryAfter ?? 30) * 1000));
            append(`⏸ [${tag}] rate limit · cooling ${(backoff / 1000).toFixed(0)}s`);
            await wait(backoff);
          } else if (res.status === 401 || res.status === 403) {
            append(`■ [${tag}] token invalid/forbidden — aborting all`);
            stopRef.current = true;
            for (const a of Array.from(waitAbortersRef.current)) a();
            return;
          }
        }
      } catch (err) {
        setStats((s) => ({ ...s, failed: s.failed + 1 }));
        append(`✗ [${tag}] ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!t.loop || stopRef.current) break;
      const baseMs = Math.max(1000, t.delaySec * 1000);
      const w = jitter(baseMs, preset.jitterPct);
      append(`⏱ [${tag}] next in ${(w / 1000).toFixed(1)}s`);
      await wait(w);
    } while (t.loop && !stopRef.current);
    append(`■ [${tag}] stopped`);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running) return;
    if (!token.trim()) { append("✗ TOKEN REQUIRED"); return; }
    const valid = targets.filter((t) => t.channelId.trim() && t.message.trim());
    if (valid.length === 0) { append("✗ ADD AT LEAST ONE CAMPAIGN"); return; }
    setRunning(true);
    stopRef.current = false;
    setStats({ sent: 0, failed: 0 });
    append(`▶ launching ${valid.length} campaign(s) · stealth: ${STEALTH[stealth].label}`);
    try {
      await Promise.all(valid.map((t) => runCampaign(t)));
      append("■ all campaigns stopped");
    } finally {
      setRunning(false);
      stopRef.current = false;
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
            <StatusPill running={running} />
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
              label={`02 // campaigns [${targets.length}]`}
              action={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onLoadEmojis}
                    disabled={emojisLoading}
                    className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    title="Fetch custom emojis from all your servers (Nitro needed for cross-server use with a user token)"
                  >
                    {emojisLoading
                      ? "⇣ scanning..."
                      : Object.keys(emojiMap).length > 0
                        ? `☺ ${Object.keys(emojiMap).length} emoji`
                        : "⇣ load emoji"}
                  </button>
                  <button
                    type="button"
                    onClick={addTarget}
                    className="rounded-sm border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                  >
                    + add campaign
                  </button>
                </div>
              }
            >
              <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                each campaign runs independently in its own loop with its own delay.
                use <span className="text-accent">:emoji_name:</span> in a message — custom emojis auto-resolve after loading.
              </p>
              <div className="space-y-3">
                {targets.map((t, i) => (
                  <div
                    key={t.id}
                    className="group relative rounded-md border border-border bg-background/40 p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                          #{String(i + 1).padStart(2, "0")}
                        </span>
                        <input
                          value={t.name}
                          onChange={(e) => updateTarget(t.id, { name: e.target.value })}
                          className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-foreground outline-none hover:border-border focus:border-primary"
                          placeholder="campaign name"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTarget(t.id)}
                        disabled={targets.length === 1}
                        className="font-mono text-[10px] uppercase tracking-wider text-destructive opacity-0 transition-opacity hover:underline disabled:opacity-0 group-hover:opacity-100"
                      >
                        purge
                      </button>
                    </div>
                    <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">channel id</label>
                    <input
                      value={t.channelId}
                      onChange={(e) => updateTarget(t.id, { channelId: e.target.value })}
                      className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      placeholder="e.g. 123456789012345678"
                    />
                    <label className="mt-2 block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">message</label>
                    <textarea
                      value={t.message}
                      onChange={(e) => updateTarget(t.id, { message: e.target.value })}
                      rows={2}
                      className="mt-1 w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                      placeholder="what to send..."
                    />
                    <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-3">
                      <div>
                        <label className="block font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                          delay before next send (seconds)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={t.delaySec}
                          onChange={(e) => updateTarget(t.id, { delaySec: Math.max(1, Number(e.target.value) || 1) })}
                          className="mt-1 w-full rounded-sm border border-border bg-input px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                        />
                      </div>
                      <label className="flex items-center gap-2 rounded-sm border border-border bg-input px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={t.loop}
                          onChange={(e) => updateTarget(t.id, { loop: e.target.checked })}
                          className="accent-primary"
                        />
                        loop
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* STEALTH — plain-english preset */}
            <Panel label="03 // stealth level">
              <p className="mb-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                controls how human-like each send looks. applies to all campaigns.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(STEALTH) as StealthLevel[]).map((k) => {
                  const p = STEALTH[k];
                  const active = stealth === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setStealth(k)}
                      className={`rounded-md border p-3 text-left transition-all ${
                        active
                          ? "border-primary bg-primary/10 shadow-[0_0_20px_-8px_var(--color-primary)]"
                          : "border-border bg-input/50 hover:border-primary/40"
                      }`}
                    >
                      <div className={`font-mono text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>
                        {p.label}
                      </div>
                      <div className="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                        {p.blurb}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                each campaign loops on its own delay until you hit <span className="text-destructive">abort</span>.
                keep this tab open — closing it stops everything.
              </p>
            </Panel>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={running}
                className="group relative flex-1 overflow-hidden rounded-md border border-primary bg-primary/10 px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-primary transition-all hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                <span className="relative z-10">{running ? "▮▮ running..." : "▶ start campaigns"}</span>
                {!running && <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-primary/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />}
              </button>
              {running && (
                <button
                  type="button"
                  onClick={abortAll}
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

function StatusPill({ running }: { running: boolean }) {
  const s = running
    ? { label: "RUNNING", color: "text-primary border-primary/40 bg-primary/10" }
    : { label: "STANDBY", color: "text-muted-foreground border-border" };
  return (
    <div className={`rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-wider ${s.color}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
      {s.label}
    </div>
  );
}
