"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import BaseballIcon from "./icons/baseball.ico";
import RegensburgLogo from "./icons/Regensburg.jpeg";
import { supabase } from "../lib/supabaseClient";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

/* ---------- Types ---------- */
type Athlete = { id: string; name: string; team?: string | null };
type Session = { id: string; athlete_id: string; date?: string | null; video_url?: string | null; notes?: string | null };
type Phase = { session_id: string; name: string; start_ms: number; end_ms: number };
type LODRow = { t_ms: number; value: number };
type MetricMeta = { metric: string; display_name?: string | null; unit?: string | null; category?: string | null; color?: string | null };

type RowSeriesLOD = { metric: string; level: number; t_ms?: number[]; values?: number[] };
type RowSeriesLODJson = { metric: string; level: number; data?: { t_ms?: number[]; values?: number[] } };
type RowTimeseriesLOD = { metric: string; level: number; t_ms: number; value: number };

/* ---------- Helpers ---------- */
function getYouTubeId(urlRaw: string | null | undefined): string | null {
  const s = (urlRaw ?? "").trim();
  if (!s) return null;
  let m = s.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i); if (m) return m[1];
  m = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/i); if (m) return m[1];
  m = s.match(/embed\/([A-Za-z0-9_-]{6,})/i); if (m) return m[1];
  return null;
}
function normalizeYouTubeUrl(urlRaw: string | null | undefined): string {
  const id = getYouTubeId(urlRaw);
  return id ? `https://www.youtube.com/watch?v=${id}` : (urlRaw ?? "");
}
function smooth(values: number[], w = 5) {
  if (w <= 0) return values;
  const out: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const s = Math.max(0, i - w), e = Math.min(values.length, i + w + 1);
    let sum = 0; for (let j = s; j < e; j++) sum += values[j];
    out[i] = sum / (e - s);
  }
  return out;
}
function interpAt(series: LODRow[], t_ms: number): number | null {
  if (!series?.length) return null;
  if (t_ms <= series[0].t_ms) return series[0].value;
  if (t_ms >= series[series.length - 1].t_ms) return series[series.length - 1].value;
  let lo = 0, hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t_ms <= t_ms) lo = mid; else hi = mid;
  }
  const a = series[lo], b = series[hi];
  const r = (t_ms - a.t_ms) / (b.t_ms - a.t_ms);
  return a.value + r * (b.value - a.value);
}
function sliceSeries(series: LODRow[], start: number, end: number) {
  return series.filter(r => r.t_ms >= start && r.t_ms <= end);
}
function phaseStats(series: LODRow[], p: Phase) {
  const seg = sliceSeries(series, p.start_ms, p.end_ms);
  if (!seg.length) return { mean: null as number | null, peak: null as number | null, ttp_ms: null as number | null };
  let sum = 0, peak = -Infinity, peakT = seg[0].t_ms;
  for (const r of seg) { sum += r.value; if (r.value > peak) { peak = r.value; peakT = r.t_ms; } }
  return { mean: sum / seg.length, peak, ttp_ms: peakT - p.start_ms };
}

/* ---------- Palette ---------- */
const PALETTE = ["#60a5fa", "#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185", "#f97316", "#84cc16", "#06b6d4"];

export default function Page() {
  /* ---- Theme ---- */
  const bg = "#0b1020";
  const panel = "#121a2e";
  const text = "#e2e8f0";
  const subtle = "#cbd5e1";

  /* ---- Tabs ---- */
  type TabKey = "main" | "improve" | "exercises";
  const [tab, setTab] = useState<TabKey>("main");

  /* ---- Auth header ---- */
  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);
  const [signingOut, startSignout] = useTransition();
  const signOut = useCallback(() => {
    startSignout(async () => { await supabase.auth.signOut(); location.href = "/login"; });
  }, []);

  /* ---- Selection state ---- */
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [athleteId, setAthleteId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [autoLevel, setAutoLevel] = useState<number | null>(null);

  const [metrics, setMetrics] = useState<string[]>([]);
  const [metricQuery, setMetricQuery] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [smoothOn, setSmoothOn] = useState(false);

  const [series, setSeries] = useState<Record<string, LODRow[]>>({});
  const [phases, setPhases] = useState<Phase[]>([]);
  const [videoUrl, setVideoUrl] = useState("");

  const [metaMap, setMetaMap] = useState<Record<string, MetricMeta>>({});

  /* ---- Phase editor ---- */
  const [editPhases, setEditPhases] = useState(false);
  const [draftPhase, setDraftPhase] = useState<{ x0?: number; x1?: number } | null>(null);
  const [draftName, setDraftName] = useState("");

  /* ---- Cursor ---- */
  const [cursorMs, setCursorMs] = useState(0);

  /* ---- Cards tray ---- */
  const [trayMetrics, setTrayMetrics] = useState<string[]>([]);

  /* ---- URL params ---- */
  const paramsRef = useRef<{ a?: string; s?: string; m?: string[]; smooth?: boolean } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    paramsRef.current = {
      a: p.get("a") || undefined,
      s: p.get("s") || undefined,
      m: (p.get("m") || "").split(",").filter(Boolean),
      smooth: p.get("smooth") === "1",
    };
    if (paramsRef.current.smooth != null) setSmoothOn(paramsRef.current.smooth);
  }, []);

  /* ---- Load athletes ---- */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("athletes").select("*").order("name");
      const list = (data || []) as Athlete[];
      setAthletes((prev) => (prev.length === list.length ? prev : list));
      const fromUrl = paramsRef.current?.a;
      setAthleteId(fromUrl && list.some((a) => a.id === fromUrl) ? fromUrl : list[0]?.id || "");
    })();
  }, []);

  /* ---- Load sessions ---- */
  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id,athlete_id,date,video_url,notes")
        .eq("athlete_id", athleteId)
        .order("date", { ascending: false });
      const rows = (data || []) as Session[];
      setSessions(rows);
      const fromUrl = paramsRef.current?.s;
      setSessionId(fromUrl && rows.some((s) => s.id === fromUrl) ? fromUrl : rows[0]?.id || "");
    })();
  }, [athleteId]);

  /* ---- Improvement metrics (demo pick) ---- */
  const improvementMetrics = useMemo(() => {
    if (!metrics.length) return [] as string[];
    const shuffled = [...metrics].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(3, shuffled.length));
  }, [metrics]);

  /* ---- Load metrics, phases, video & LOD metadata ---- */
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      let metNames: string[] = [];
      let levels: number[] = [];

      const res1 = await supabase
        .from("series_lod")
        .select("metric,level")
        .eq("session_id", sessionId);

      if (!res1.error && res1.data?.length) {
        const rows = res1.data as unknown as Pick<RowSeriesLOD, "metric" | "level">[];
        metNames = [...new Set(rows.map((d) => d.metric))];
        levels = [...new Set(rows.map((d) => d.level))];
      } else {
        const res2 = await supabase
          .from("series_lod_json")
          .select("metric,level")
          .eq("session_id", sessionId);
        if (!res2.error && res2.data?.length) {
          const rows = res2.data as unknown as Pick<RowSeriesLODJson, "metric" | "level">[];
          metNames = [...new Set(rows.map((d) => d.metric))];
          levels = [...new Set(rows.map((d) => d.level))];
        } else {
          const res3 = await supabase
            .from("timeseries_lod")
            .select("metric,level")
            .eq("session_id", sessionId);
          if (!res3.error && res3.data?.length) {
            const rows = res3.data as unknown as Pick<RowTimeseriesLOD, "metric" | "level">[];
            metNames = [...new Set(rows.map((d) => d.metric))];
            levels = [...new Set(rows.map((d) => d.level))];
          }
        }
      }

      metNames.sort((a, b) => a.localeCompare(b));
      setMetrics(metNames);

      const urlMs = paramsRef.current?.m || [];
      const initial = urlMs.filter((m) => metNames.includes(m));
      const first = initial.length ? initial : metNames.slice(0, Math.min(1, metNames.length));
      setSelectedMetrics(first);
      setTrayMetrics(first);

      setAutoLevel(levels.length ? Math.max(...levels) : null);

      const ph = await supabase.from("phases").select("*").eq("session_id", sessionId);
      if (!ph.error && ph.data) setPhases(ph.data as Phase[]);

      const sess = sessions.find((s) => s.id === sessionId);
      setVideoUrl(normalizeYouTubeUrl(sess?.video_url));
      setCursorMs(0);
      setEditPhases(false);
      setDraftPhase(null); setDraftName("");
    })();
  }, [sessionId, sessions]);

  /* ---- Metric metadata ---- */
  useEffect(() => {
    if (metrics.length === 0) { setMetaMap({}); return; }
    (async () => {
      const { data, error } = await supabase.from("metrics_meta").select("*").in("metric", metrics);
      if (!error && data) {
        const map: Record<string, MetricMeta> = {};
        (data as MetricMeta[]).forEach((m) => { map[m.metric] = m; });
        setMetaMap(map);
      } else setMetaMap({});
    })();
  }, [metrics]);

  /* ---- Keep tray in sync with selection ---- */
  useEffect(() => {
    setTrayMetrics(prev => prev.filter(m => selectedMetrics.includes(m)));
  }, [selectedMetrics]);

  /* ---- Add newly selected metrics to tray ---- */
  useEffect(() => {
    if (selectedMetrics.length === 0) return;
    setTrayMetrics(prev => Array.from(new Set([...prev, ...selectedMetrics])));
  }, [selectedMetrics]);

  /* ---- Visible metrics ---- */
  const visibleMetrics = useMemo(
    () => Array.from(new Set([...selectedMetrics, ...(tab === "improve" ? improvementMetrics : [])])),
    [selectedMetrics, improvementMetrics, tab]
  );

  /* ---- Load series data ---- */
  useEffect(() => {
    if (!sessionId || visibleMetrics.length === 0) { setSeries({}); return; }

    (async () => {
      let out: Record<string, LODRow[]> = {};
      let ok = false;

      if (autoLevel != null) {
        const res = await supabase
          .from("series_lod")
          .select("metric,t_ms,values")
          .eq("session_id", sessionId)
          .eq("level", autoLevel)
          .in("metric", visibleMetrics);

        if (!res.error && res.data?.length) {
          const rows = res.data as unknown as RowSeriesLOD[];
          for (const row of rows) {
            const xs = row.t_ms ?? [];
            const ys = row.values ?? [];
            const arr: LODRow[] = [];
            const n = Math.min(xs.length, ys.length);
            for (let i = 0; i < n; i++) arr.push({ t_ms: xs[i], value: ys[i] });
            out[row.metric] = arr;
          }
          ok = true;
        }
      }

      if (!ok && autoLevel != null) {
        const res2 = await supabase
          .from("series_lod_json")
          .select("metric,data")
          .eq("session_id", sessionId)
          .eq("level", autoLevel)
          .in("metric", visibleMetrics);

        if (!res2.error && res2.data?.length) {
          const rows = res2.data as unknown as RowSeriesLODJson[];
          out = {};
          for (const row of rows) {
            const xs = row.data?.t_ms ?? [];
            const ys = row.data?.values ?? [];
            const arr: LODRow[] = [];
            const n = Math.min(xs.length, ys.length);
            for (let i = 0; i < n; i++) arr.push({ t_ms: xs[i], value: ys[i] });
            out[row.metric] = arr;
          }
          ok = true;
        }
      }

      if (!ok) {
        const res3 = await supabase
          .from("timeseries_lod")
          .select("metric,t_ms,value,level")
          .eq("session_id", sessionId)
          .in("metric", visibleMetrics)
          .order("t_ms");

        if (!res3.error && res3.data?.length) {
          const rows = res3.data as unknown as RowTimeseriesLOD[];
          const byLevel: Record<string, number> = {};
          for (const row of rows) {
            const L = row.level;
            if (byLevel[row.metric] == null || L > byLevel[row.metric]) byLevel[row.metric] = L;
          }
          const byMetric: Record<string, LODRow[]> = {};
          for (const row of rows) {
            if (row.level === byLevel[row.metric]) {
              (byMetric[row.metric] ||= []).push({ t_ms: row.t_ms, value: row.value });
            }
          }
          out = byMetric;
        }
      }

      setSeries(out);
    })();
  }, [sessionId, visibleMetrics, autoLevel]);

  /* ---- Debounced search ---- */
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(metricQuery.toLowerCase()), 120);
    return () => clearTimeout(t);
  }, [metricQuery]);

  /* ---- Derived ---- */
  const filteredMetrics = useMemo(() => metrics.filter((m) => m.toLowerCase().includes(debouncedQuery)), [metrics, debouncedQuery]);

  const maxMs = useMemo(() => {
    let max = 0; Object.values(series).forEach((arr) => { if (arr?.length) max = Math.max(max, arr[arr.length - 1].t_ms); });
    return max;
  }, [series]);

  const ytId = useMemo(() => getYouTubeId(videoUrl), [videoUrl]);
  const canPlay = useMemo(() => !!ytId && /^https?:\/\//i.test(videoUrl), [ytId, videoUrl]);
  const ytEmbedSrc = useMemo(() => (ytId ? `https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1&playsinline=1&autoplay=1&mute=1&loop=1&playlist=${ytId}&controls=1` : ""), [ytId]);

  /* ---- Cards ---- */
  const pinnedCards = useMemo(() => {
    const colorFor: Record<string, string> = {};
    let idx = 0; for (const m of trayMetrics) { colorFor[m] = metaMap[m]?.color || PALETTE[idx % PALETTE.length]; idx++; }
    return trayMetrics.map((metric) => {
      const active = selectedMetrics.includes(metric);
      const arr = series[metric] || [];
      const value = active ? interpAt(arr, cursorMs) : null;
      const meta = metaMap[metric];
      const label = meta?.display_name ? `${meta.display_name}${meta?.unit ? ` [${meta.unit}]` : ""}` : `${metric}${meta?.unit ? ` [${meta.unit}]` : ""}`;
      return { metric, label, color: colorFor[metric], active, value };
    });
  }, [trayMetrics, selectedMetrics, series, cursorMs, metaMap]);

  const toggleMetric = useCallback((metric: string) => {
    setSelectedMetrics((sel) => (sel.includes(metric) ? sel.filter((m) => m !== metric) : [...sel, metric]));
  }, []);
  const removeMetric = useCallback((metric: string) => {
    setSelectedMetrics((sel) => sel.filter((m) => m !== metric));
    setTrayMetrics((tray) => tray.filter((m) => m !== metric));
  }, []);

  /* ---- Save phase ---- */
  const savePhase = useCallback(async () => {
    if (!draftPhase || !draftName || !sessionId) return;
    const start_ms = Math.round(Math.min(draftPhase.x0!, draftPhase.x1!) * 1000);
    const end_ms = Math.round(Math.max(draftPhase.x0!, draftPhase.x1!) * 1000);
    await supabase.from("phases").insert({ session_id: sessionId, name: draftName, start_ms, end_ms });
    const { data } = await supabase.from("phases").select("*").eq("session_id", sessionId);
    setPhases((data || []) as Phase[]);
    setDraftPhase(null); setDraftName("");
  }, [draftPhase, draftName, sessionId]);

  /* ---- Plot ---- */
  const plotData = useMemo(() => {
    const colorFor: Record<string, string> = {};
    let idx = 0; for (const m of selectedMetrics) { colorFor[m] = metaMap[m]?.color || PALETTE[idx++ % PALETTE.length]; }
    return Object.entries(series).map(([metric, arr]) => {
      if (!selectedMetrics.includes(metric)) return null;
      const x = arr.map((r) => r.t_ms / 1000.0);
      const yBase = arr.map((r) => r.value);
      const y = smoothOn ? smooth(yBase, 5) : yBase;
      const label = metaMap[metric]?.display_name || metric;
      const unit = metaMap[metric]?.unit;
      return { x, y, name: unit ? `${label} [${unit}]` : label, mode: "lines", type: "scattergl" as const, line: { width: 2 } };
    }).filter(Boolean) as unknown[];
  }, [series, smoothOn, metaMap, selectedMetrics]);

  type RelayoutEvent = Partial<{ shapes: Array<Partial<{ x0: number; x1: number }>> }>;
  type HoverPoint = { x: number };
  type HoverEvent = { points?: HoverPoint[] };

  const shapes = useMemo(() => {
    const rects = (phases || []).map((p) => ({
      type: "rect", xref: "x", yref: "paper",
      x0: p.start_ms / 1000.0, x1: p.end_ms / 1000.0, y0: 0, y1: 1,
      fillcolor: "rgba(59,130,246,0.18)", line: { width: 0 },
    }));
    // Fix: Use type assertion to bypass TypeScript's strict typing
    rects.push({
      type: "line", 
      x0: cursorMs / 1000.0, 
      x1: cursorMs / 1000.0, 
      y0: 0, 
      y1: 1, 
      xref: "x", 
      yref: "paper", 
      line: { color: "#e5e7eb", width: 2, dash: "dash" } as any
    } as any);
    if (editPhases && draftPhase?.x0 != null && draftPhase?.x1 != null) {
      rects.push({
        type: "rect", 
        xref: "x", 
        yref: "paper", 
        x0: Math.min(draftPhase.x0, draftPhase.x1), 
        x1: Math.max(draftPhase.x0, draftPhase.x1), 
        y0: 0, 
        y1: 1, 
        fillcolor: "rgba(244,114,182,0.15)", 
        line: { color: "#f472b6", width: 1, dash: "dot" } as any
      } as any);
    }
    return rects;
  }, [phases, cursorMs, editPhases, draftPhase]);

  const annotations = useMemo(() => (phases || []).map((p) => ({
    x: (p.start_ms + p.end_ms) / 2000, y: 1.04, xref: "x", yref: "paper", text: p.name, showarrow: false, font: { size: 10, color: "#cbd5e1" },
  })), [phases]);

  /* ---- DEMO export (Main tab only; no files written) ---- */
  const exportDemo = useCallback(() => {
    const msg = `Demo export:
- Chart PNG (would be generated) for session ${sessionId || "-"}
- Per-phase stats CSV (mean, peak, TTP) for metrics: ${selectedMetrics.join(", ") || "-"}
No files are saved in demo mode.`;
    alert(msg);
    console.log(msg);
  }, [sessionId, selectedMetrics]);

  /* ---- Hover throttle ---- */
  const rAF = useRef<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  const onHover = useCallback((ev: HoverEvent) => {
    if (rAF.current != null) return;
    rAF.current = requestAnimationFrame(() => {
      if (rAF.current) cancelAnimationFrame(rAF.current);
      rAF.current = null;
      const pt = ev?.points && ev.points[0];
      if (pt && Number.isFinite(pt.x)) {
        setCursorMs(Math.max(0, Math.round(Number(pt.x) * 1000)));
      }
    });
  }, []);

  /* ---- Improvement cards (demo) ---- */
  const improvementCards = useMemo(() => {
    return (tab === "improve" ? improvementMetrics : []).map((metric, idx) => {
      const arr = series[metric] || [];
      const x = arr.map((r) => r.t_ms / 1000.0);
      const athlete = smoothOn ? smooth(arr.map((r) => r.value), 5) : arr.map((r) => r.value);
      const prof = smooth(athlete, 9).map((v) => v * (0.95 + (idx * 0.02))); // demo
      const label = metaMap[metric]?.display_name || metric;
      const unit = metaMap[metric]?.unit;
      const title = unit ? `${label} [${unit}]` : label;
      const pstats = phases.map(p => {
        const segAth = phaseStats(arr, p);
        return { phase: p.name, mean: segAth.mean, peak: segAth.peak, ttp_ms: segAth.ttp_ms };
      });
      return { metric, title, x, athlete, prof, pstats };
    });
  }, [tab, improvementMetrics, series, metaMap, smoothOn, phases]);

  /* ---- Exercises (images in /public/exercises) ---- */
  const exerciseRows = useMemo(() => [
    { id: "cmj", img: "/exercises/cmj.jpg", name: "Countermovement Jump (CMJ)", desc: "Hands on hips. Emphasize full depth, stiff ankle on take-off, and quiet landing. 3 × 5.", target: "Explosive concentric power, SSC utilization, landing mechanics." },
    { id: "medball-rot-throw", img: "/exercises/medicine-ball-throw.jpg", name: "Medicine Ball Rotational Throw", desc: "Explosive side-rotation into wall. 3 × 6/side. Cue hip–shoulder separation and braced front leg.", target: "Sequencing, pelvis–torso disassociation, rotational power." },
    { id: "single-leg-stepdown", img: "/exercises/single-leg-stepdown.png", name: "Single-Leg Step-Down", desc: "Controlled eccentric lowering from small box. Knee tracks over toes, neutral pelvis. 3 × 8–10/side.", target: "Frontal-plane stability, valgus control, deceleration." },
  ], []);

  return (
    <main style={{ background: bg, minHeight: "100vh", color: text }}>
      {/* Header */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 16px 8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src={BaseballIcon} alt="Baseball" width={24} height={24} style={{ borderRadius: 6, opacity: 0.95 }} />
          <h1 style={{ margin: 0, fontWeight: 800, letterSpacing: 0.2 }}>Athlete Viewer</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {userEmail && <span style={{ fontSize: 13, color: "#94a3b8" }}>{userEmail}</span>}
          {userEmail && <button onClick={signOut} disabled={signingOut} title="Sign out" style={{ background: "#334155", color: text, border: "1px solid #475569", padding: "6px 10px", borderRadius: 8 }}>Sign out</button>}
          <Image src={RegensburgLogo} alt="Regensburg" width={160} height={54} style={{ objectFit: "contain", opacity: 0.85 }} priority />
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 16px 24px 16px" }}>
        {/* Tabs – single row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, whiteSpace: "nowrap", overflowX: "auto" }}>
          <button onClick={() => setTab("main")} style={{ background: tab === "main" ? "#1f2a44" : "#0f172a", color: text, border: `1px solid ${tab === "main" ? "#3b82f6" : "#1f2937"}`, padding: "6px 10px", borderRadius: 8, fontWeight: 700, fontSize: 13 }}>Main Page</button>
          <button onClick={() => setTab("improve")} style={{ background: tab === "improve" ? "#1f2a44" : "#0f172a", color: text, border: `1px solid ${tab === "improve" ? "#3b82f6" : "#1f2937"}`, padding: "6px 10px", borderRadius: 8, fontWeight: 700, fontSize: 13 }}>Areas Of Improvement</button>
          <button onClick={() => setTab("exercises")} style={{ background: tab === "exercises" ? "#1f2a44" : "#0f172a", color: text, border: `1px solid ${tab === "exercises" ? "#3b82f6" : "#1f2937"}`, padding: "6px 10px", borderRadius: 8, fontWeight: 700, fontSize: 13 }}>Applied Exercises</button>

          {/* Demo export button – main tab only */}
          {tab === "main" && (
            <button onClick={exportDemo} style={{ marginLeft: "auto", background: "#22c55e", color: "#0b1020", border: "none", padding: "6px 10px", borderRadius: 8, fontWeight: 800, fontSize: 13 }}>
              Export PNG + CSV (Demo)
            </button>
          )}
        </div>

        {/* ===== MAIN TAB ===== */}
        {tab === "main" && (
          <>
            {/* Controls */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12, background: panel, padding: 12, borderRadius: 12, boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset" }}>
              <div>
                <div style={{ color: subtle, fontSize: 12, marginBottom: 6 }}>Athlete</div>
                <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} style={{ width: "100%", background: "#0f172a", color: text, border: "1px solid #1f2937", padding: "8px 10px", borderRadius: 8 }}>
                  {athletes.map((a) => <option key={a.id} value={a.id} style={{ background: "#0f172a", color: text }}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ color: subtle, fontSize: 12, marginBottom: 6 }}>Session</div>
                <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ width: "100%", background: "#0f172a", color: text, border: "1px solid #1f2937", padding: "8px 10px", borderRadius: 8 }}>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id} style={{ background: "#0f172a", color: text }}>
                      {(s.date ? new Date(s.date).toISOString().slice(0, 10) : "–")} · {s.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Main grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 2.6fr", gap: 12 }}>
              {/* LEFT PANEL */}
              <div style={{ background: panel, borderRadius: 12, padding: 12, boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset" }}>
                <div style={{ color: subtle, fontSize: 12, marginBottom: 6 }}>Metrics (overlay)</div>

                <input
                  placeholder="Search metrics…"
                  value={metricQuery}
                  onChange={(e) => setMetricQuery(e.target.value)}
                  style={{ width: "100%", marginBottom: 8, background: "#0f172a", color: text, border: "1px solid #1f2937", padding: 8, borderRadius: 8 }}
                />

                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <button onClick={() => { setSelectedMetrics([]); setSeries({}); }} style={{ background: "#334155", color: text, border: "1px solid #475569", padding: "6px 10px", borderRadius: 8 }}>Clear All</button>
                  <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: subtle }}>
                    <input type="checkbox" checked={smoothOn} onChange={(e) => setSmoothOn(e.target.checked)} /> Smooth
                  </label>
                </div>

                <select
                  multiple
                  value={selectedMetrics}
                  onChange={(e) => {
                    const options = Array.from(e.target.selectedOptions).map((o) => o.value);
                    setSelectedMetrics(options);
                  }}
                  style={{ width: "100%", height: 160, background: "#0f172a", color: text, border: "1px solid #1f2937", padding: 8, borderRadius: 8, marginBottom: 10 }}
                >
                  {filteredMetrics.map((m) => {
                    const meta = metaMap[m];
                    const label = meta?.display_name ? `${meta.display_name}${meta?.unit ? ` [${meta.unit}]` : ""}` : m;
                    return <option key={m} value={m} style={{ background: "#0f172a", color: text }}>{label}</option>;
                  })}
                </select>

                {/* Time slider */}
                <div style={{ color: subtle, fontSize: 12, marginBottom: 6 }}>
                  Time cursor: <span style={{ color: text }}>{(cursorMs / 1000).toFixed(3)} s</span>
                </div>
                <input type="range" min={0} max={Math.max(0, maxMs)} step={10} value={cursorMs} onChange={(e) => setCursorMs(Number(e.target.value))} style={{ width: "100%", marginBottom: 10 }} />

                {/* Video */}
                <div style={{ marginTop: 10, background: "#000000", borderRadius: 12, overflow: "hidden", border: "1px solid #1f2937" }}>
                  {canPlay ? (
                    <iframe title="YouTube" width="100%" height="360" src={ytEmbedSrc} loading="lazy" frameBorder={0} allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
                  ) : (<div style={{ padding: 16, color: subtle }}>No valid video URL.</div>)}
                </div>
              </div>

              {/* RIGHT PANEL */}
              <div style={{ background: panel, borderRadius: 12, padding: 12, boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset" }}>
                <Plot
                  data={plotData}
                  onRelayout={(e: RelayoutEvent) => {
                    if (!editPhases) return;
                    const shapes = e.shapes ?? [];
                    const s = shapes[shapes.length - 1];
                    if (s && typeof s.x0 === "number" && typeof s.x1 === "number") {
                      setDraftPhase({ x0: s.x0, x1: s.x1 });
                    }
                  }}
                  onHover={onHover}
                  layout={{
                    height: 560, margin: { l: 54, r: 14, t: 12, b: 96 },
                    paper_bgcolor: panel, plot_bgcolor: "#0e162a", font: { color: text },
                    xaxis: { title: "Time (s)", gridcolor: "#203055", zerolinecolor: "#203055", showspikes: true, spikethickness: 1, spikecolor: "#93c5fd", spikemode: "across+marker", fixedrange: !editPhases },
                    yaxis: { title: "Value", gridcolor: "#203055", zerolinecolor: "#203055", fixedrange: !editPhases },
                    hovermode: "x unified", shapes, annotations, showlegend: false,
                    uirevision: `${sessionId}-${selectedMetrics.join(",")}-${smoothOn ? "s" : "r"}-${editPhases ? "edit" : "view"}`
                  }}
                  config={{ responsive: true, displaylogo: false, scrollZoom: false, displayModeBar: editPhases, modeBarButtonsToAdd: editPhases ? ["drawrect", "eraseshape"] : [], modeBarButtonsToRemove: ["zoom2d","pan2d","select2d","lasso2d","autoScale2d","resetScale2d","toImage","hoverclosest","hovercompare","toggleSpikelines"] }}
                  style={{ width: "100%" }}
                />

				{/* Metric cards – draggable re-order + red × in top-right */}
				{pinnedCards.length > 0 && (
				  <div
					style={{
					  marginTop: 10,
					  display: "grid",
					  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
					  gap: 8,
					}}
				  >
					{pinnedCards.map((p, i) => (
					  <div
						key={p.metric}
						title={p.active ? "Click to hide" : "Click to show"}
						onClick={() => toggleMetric(p.metric)}
						draggable
						onDragStart={(e) => {
						  dragIndex.current = i;
						  e.dataTransfer.effectAllowed = "move";
						}}
						onDragOver={(e) => {
						  e.preventDefault();
						  e.dataTransfer.dropEffect = "move";
						}}
						onDrop={() => {
						  const from = dragIndex.current;
						  dragIndex.current = null;
						  if (from == null || from === i) return;
						  setTrayMetrics((arr) => {
							const next = arr.slice();
							const [m] = next.splice(from, 1);
							next.splice(i, 0, m);
							return next;
						  });
						}}
						style={{
						  position: "relative",
						  background: p.active ? "#0f172a" : "#0d1427",
						  border: `1px solid ${p.active ? "#27304d" : "#1e263f"}`,
						  opacity: p.active ? 1 : 0.45,
						  borderRadius: 12,
						  padding: "10px 12px",
						  cursor: "grab",
						  transition:
							"transform 120ms ease, background 120ms ease, border-color 120ms ease, opacity 120ms ease",
						}}
						onMouseEnter={(e) => {
						  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
						}}
						onMouseLeave={(e) => {
						  (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
						}}
					  >
						{/* red × in top-right */}
						<button
						  aria-label="Remove metric"
						  title="Remove"
						  onClick={(ev) => {
							ev.stopPropagation();
							removeMetric(p.metric);
						  }}
						  style={{
							position: "absolute",
							top: 6,
							right: 6,
							width: 22,
							height: 22,
							display: "grid",
							placeItems: "center",
							background: "transparent",
							border: "none",
							color: "#dc2626",
							cursor: "pointer",
							fontSize: 16,
							fontWeight: 900,
							lineHeight: 1,
							zIndex: 10,
						  }}
						>
						  ×
						</button>

						<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
						  <span
							style={{
							  width: 10,
							  height: 10,
							  borderRadius: 999,
							  background: p.color,
							}}
						  />
						  <div
							style={{
							  fontSize: 12,
							  color: subtle,
							  overflow: "hidden",
							  textOverflow: "ellipsis",
							  whiteSpace: "nowrap",
							}}
						  >
							{p.label}
						  </div>
						</div>
						<div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>
						  {p.value == null ? "–" : p.value.toFixed(4)}
						</div>
					  </div>
					))}
				  </div>
				)}

                {/* Phase editor */}
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #1f2937", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", color: subtle }}>
                      <input type="checkbox" checked={editPhases} onChange={(e) => { setEditPhases(e.target.checked); setDraftPhase(null); setDraftName(""); }} />
                      Edit phases (draw rectangle with the toolbar)
                    </label>
                    {editPhases && (
                      <>
                        <input placeholder="Phase name (e.g., Stance)" value={draftName} onChange={(e) => setDraftName(e.target.value)} style={{ background: "#0f172a", color: text, border: "1px solid #1f2937", padding: "6px 10px", borderRadius: 8, minWidth: 200 }} />
                        <button onClick={savePhase} disabled={!draftPhase || !draftName} style={{ background: !draftPhase || !draftName ? "#334155" : "#22c55e", color: "#0b1020", border: "none", padding: "8px 12px", borderRadius: 10, fontWeight: 700, cursor: !draftPhase || !draftName ? "not-allowed" : "pointer" }}>Save phase</button>
                        {draftPhase && <span style={{ color: subtle, fontSize: 12 }}>draft: {Math.min(draftPhase.x0!, draftPhase.x1!).toFixed(3)}s → {Math.max(draftPhase.x0!, draftPhase.x1!).toFixed(3)}s</span>}
                      </>
                    )}
                  </div>
                </div>

                {/* Per-phase stats table */}
                {phases.length > 0 && selectedMetrics.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Per-phase stats</div>
                    <div style={{ overflowX: "auto", border: "1px solid #1f2937", borderRadius: 10 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "#0f172a" }}>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #1f2937" }}>Metric</th>
                            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #1f2937" }}>Phase</th>
                            <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>Mean</th>
                            <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>Peak</th>
                            <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>TTP (ms)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMetrics.flatMap(metric => {
                            const arr = series[metric] || [];
                            return phases.map(p => {
                              const st = phaseStats(arr, p);
                              return (
                                <tr key={`${metric}-${p.name}-${p.start_ms}`} style={{ borderBottom: "1px solid #0f172a" }}>
                                  <td style={{ padding: 8 }}>{metaMap[metric]?.display_name || metric}</td>
                                  <td style={{ padding: 8 }}>{p.name}</td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{st.mean == null ? "–" : st.mean.toFixed(4)}</td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{st.peak == null ? "–" : st.peak.toFixed(4)}</td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{st.ttp_ms == null ? "–" : st.ttp_ms}</td>
                                </tr>
                              );
                            });
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ===== AREAS OF IMPROVEMENT TAB ===== */}
        {tab === "improve" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ background: panel, padding: 12, borderRadius: 12, border: "1px solid #1f2937" }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.2, marginBottom: 6 }}>Areas Of Improvement</div>
              <div style={{ color: subtle, fontSize: 13 }}>Two-up layout; each card includes a professional reference and per-phase stats.</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {improvementCards.map(({ metric, title, x, athlete, prof, pstats }) => (
                <div key={metric} style={{ background: panel, borderRadius: 12, border: "1px solid #1f2937", padding: 12, display: "flex", flexDirection: "column", minHeight: 520 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 0.2, marginBottom: 8 }}>{title}</div>

                  <div style={{ width: "100%", marginBottom: 10 }}>
                    <Plot
                      data={[
                        { x, y: athlete, mode: "lines", type: "scattergl" as const, name: "Athlete Data", line: { width: 2 } },
                        { x, y: prof,    mode: "lines", type: "scattergl" as const, name: "Professional Data", line: { width: 2, dash: "dot" } },
                      ]}
                      layout={{
                        height: 260,
                        margin: { l: 48, r: 12, t: 6, b: 44 },
                        paper_bgcolor: panel,
                        plot_bgcolor: "#0e162a",
                        font: { color: text, size: 12 },
                        xaxis: { title: "Time (s)", gridcolor: "#203055", zerolinecolor: "#203055", fixedrange: true },
                        yaxis: { title: "Value", gridcolor: "#203055", zerolinecolor: "#203055", fixedrange: true },
                        showlegend: false,
                      }}
                      config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ["toImage","select2d","lasso2d","zoom2d","pan2d","resetScale2d"],
                      }}
                      style={{ width: "100%" }}
                    />
                  </div>

                  {/* Legend */}
                  <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 14, height: 3, background: "#60a5fa", display: "inline-block" }} /> <span style={{ fontSize: 12, color: subtle }}>Athlete Data</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 14, height: 0, borderTop: "2px dotted #a78bfa", display: "inline-block" }} /> <span style={{ fontSize: 12, color: subtle }}>Professional Data</span>
                    </div>
                  </div>

                  {/* Per-phase stats for this metric */}
                  {pstats.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>Per-phase stats</div>
                      <div style={{ overflowX: "auto", border: "1px solid #1f2937", borderRadius: 10 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#0f172a" }}>
                              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #1f2937" }}>Phase</th>
                              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>Mean</th>
                              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>Peak</th>
                              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #1f2937" }}>TTP (ms)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pstats.map(ps => (
                              <tr key={ps.phase} style={{ borderBottom: "1px solid #0f172a" }}>
                                <td style={{ padding: 8 }}>{ps.phase}</td>
                                <td style={{ padding: 8, textAlign: "right" }}>{ps.mean == null ? "–" : ps.mean.toFixed(4)}</td>
                                <td style={{ padding: 8, textAlign: "right" }}>{ps.peak == null ? "–" : ps.peak.toFixed(4)}</td>
                                <td style={{ padding: 8, textAlign: "right" }}>{ps.ttp_ms == null ? "–" : ps.ttp_ms}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Reasons box */}
                  <div style={{ marginTop: "auto" }}>
                    <div style={{ fontSize: 12, color: subtle, marginBottom: 6, fontWeight: 700 }}>Reasons why:</div>
                    <div style={{ background: "#0f172a", border: "1px solid #27304d", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5, color: "#d1d5db" }}>
                      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer faucibus arcu sed venenatis laoreet. Phasellus facilisis, nulla non luctus aliquam.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== APPLIED EXERCISES TAB ===== */}
        {tab === "exercises" && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ background: panel, padding: 12, borderRadius: 12, border: "1px solid #1f2937" }}>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 0.2, marginBottom: 6 }}>Applied Exercises</div>
              <div style={{ color: subtle, fontSize: 13 }}>Clearer images with larger previews and centered names.</div>
            </div>

            <div style={{ border: "1px solid #1f2937", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#0f172a" }}>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #1f2937", width: 420 }}>Exercise</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #1f2937" }}>Description</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #1f2937", width: 360 }}>Targets</th>
                  </tr>
                </thead>
                <tbody>
                  {exerciseRows.map((ex, idx) => (
                    <tr key={ex.id} style={{ background: idx % 2 ? "#0c1428" : "#0b1020" }}>
                      {/* Exercise column */}
                      <td style={{ padding: 10, verticalAlign: "top" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 400, height: 300, background: "#0f172a", border: "1px solid #27304d", borderRadius: 8, display: "grid", placeItems: "center", overflow: "hidden" }}>
                            <Image
                              src={ex.img}
                              alt={ex.name}
                              width={400}
                              height={300}
                              style={{ objectFit: "contain", width: "100%", height: "100%" }}
                            />
                          </div>
                          <div style={{ marginTop: 12, fontWeight: 800, fontSize: 20, textAlign: "center" }}>{ex.name}</div>
                        </div>
                      </td>

                      {/* Description */}
                      <td style={{ padding: 10, color: subtle, lineHeight: 1.5 }}>{ex.desc}</td>

                      {/* Targets */}
                      <td style={{ padding: 10, color: subtle }}>{ex.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        select, select option { background-color: #0f172a !important; color: #e2e8f0 !important; }
        select:focus { outline: 2px solid #3b82f6; outline-offset: 1px; }
        input[type="range"] { accent-color: #60a5fa; }
        .modebar-btn, .modebar-group * { filter: invert(1) hue-rotate(180deg) brightness(0.9); }
      `}</style>
    </main>
  );
}