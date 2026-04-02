import { useEffect, useMemo, useRef, useState } from "react";
import AcUnit from "@mui/icons-material/AcUnit";
import Air from "@mui/icons-material/Air";
import Dehaze from "@mui/icons-material/Dehaze";
import Lightbulb from "@mui/icons-material/Lightbulb";
import PowerSettingsNew from "@mui/icons-material/PowerSettingsNew";
import WbSunny from "@mui/icons-material/WbSunny";
import { Alert, Box, Button, Card, CardContent, Container, FormControl, Grid, InputLabel, LinearProgress, ListItemIcon, MenuItem, Select, Slider, Stack, Switch, Tab, Tabs, TextField, Typography } from "@mui/material";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const modeOptions = ["Heat", "Cool", "Automatic", "Dry", "Fan"];
const fanOptions = ["Auto", "One", "Two", "Three", "Four", "Five"];
const modeLabels = { Heat: "Chauffage", Cool: "Refroidissement", Automatic: "Automatique", Dry: "Déshumidification", Fan: "Ventilation" };
const fanLabels = { Auto: "Auto", One: "Vitesse 1", Two: "Vitesse 2", Three: "Vitesse 3", Four: "Vitesse 4", Five: "Vitesse 5" };

/** Avec un axe temps + points PAC très denses, Recharts donne une largeur de barre ~0 : les barres deviennent invisibles. */
function makePrecipBarShape(minWidthPx) {
  return function PrecipBarShape(props) {
    const { fill, x, y, width, height } = props;
    if (height == null || !Number.isFinite(Number(height)) || Number(height) <= 0) return null;
    const w0 = Number(width);
    const w = Math.max(Number.isFinite(w0) ? w0 : 0, minWidthPx);
    const x0 = Number(x);
    const xAdj = Number.isFinite(x0) ? x0 + (Number.isFinite(w0) ? (w0 - w) / 2 : 0) : x;
    return <rect x={xAdj} y={y} width={w} height={height} fill={fill} fillOpacity={0.88} rx={2} ry={2} />;
  };
}

const precipBarShape = makePrecipBarShape(7);

function normalizeOperationMode(value) {
  const raw = String(value || "").trim();
  const up = raw.toUpperCase();
  if (up === "AUTO" || up === "AUTOMATIC") return "Automatic";
  if (up === "HEAT") return "Heat";
  if (up === "COOL") return "Cool";
  if (up === "DRY") return "Dry";
  if (up === "FAN") return "Fan";
  // MELCloud peut déjà renvoyer "Heat"/"Cool"/etc.
  if (modeOptions.includes(raw)) return raw;
  return "Automatic";
}

function normalizeFanSpeed(value) {
  const raw = String(value || "").trim();
  const up = raw.toUpperCase();
  // API MELCloud : AUTO / 0 → mode automatique ; l'UI utilise la valeur « Auto » (envoyée au back puis mappée en AUTO).
  if (up === "AUTO" || up === "0") return "Auto";
  if (up === "QUIET") return "Auto";
  if (up === "ONE" || up === "1") return "One";
  if (up === "TWO" || up === "2") return "Two";
  if (up === "THREE" || up === "3") return "Three";
  if (up === "FOUR" || up === "4") return "Four";
  if (up === "FIVE" || up === "5") return "Five";
  if (fanOptions.includes(raw)) return raw;
  return "One";
}

function normalizeDeviceFromApi(d) {
  if (!d) return d;
  return {
    ...d,
    operationMode: normalizeOperationMode(d.operationMode),
    fanSpeed: normalizeFanSpeed(d.fanSpeed),
  };
}

const modeIconComponent = {
  Heat: WbSunny,
  Cool: AcUnit,
  Automatic: Lightbulb,
  Dry: Dehaze,
  Fan: Air,
};

function ModeIcon({ mode, sx }) {
  const m = normalizeOperationMode(mode);
  const Icon = modeIconComponent[m] || Lightbulb;
  return <Icon sx={sx} aria-hidden />;
}

const LEGEND_WEATHER = new Set(["Pluie (La Charmette)", "Neige (La Charmette)", "Extérieure La Charmette", "Extérieure Chamrousse"]);
const WEATHER_LEGEND_ORDER = ["Pluie (La Charmette)", "Neige (La Charmette)", "Extérieure La Charmette", "Extérieure Chamrousse"];
const PAC_LEGEND_ORDER = ["Température réelle PAC", "Consigne PAC", "Extérieure (PAC)"];

function sortLegendByOrder(entries, order) {
  const rank = (name) => {
    const i = order.indexOf(name);
    return i === -1 ? 1000 : i;
  };
  return [...entries].sort((a, b) => rank(a.value) - rank(b.value));
}

function TemperatureSplitLegend(props) {
  const { payload } = props;
  if (!payload?.length) return null;
  const weather = sortLegendByOrder(
    payload.filter((e) => LEGEND_WEATHER.has(e.value)),
    WEATHER_LEGEND_ORDER,
  );
  const pac = sortLegendByOrder(
    payload.filter((e) => !LEGEND_WEATHER.has(e.value)),
    PAC_LEGEND_ORDER,
  );
  const renderEntry = (entry) => {
    const c = entry.color;
    const isBar = entry.type === "rect" || entry.type === "square";
    return (
      <Stack key={String(entry.dataKey ?? entry.value)} direction="row" alignItems="center" spacing={0.75}>
        {isBar ? (
          <Box sx={{ width: 14, height: 10, bgcolor: c, borderRadius: 0.5, opacity: 0.9 }} />
        ) : (
          <Box component="span" sx={{ width: 14, height: 3, bgcolor: c, borderRadius: 0.5, display: "inline-block" }} />
        )}
        <Typography component="span" variant="caption" sx={{ color: "rgba(255,255,255,0.88)", whiteSpace: "nowrap" }}>
          {entry.value}
        </Typography>
      </Stack>
    );
  };
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        justifyContent: "space-between",
        alignItems: { xs: "stretch", sm: "flex-start" },
        gap: 1.5,
        width: "100%",
        py: 0.5,
      }}
    >
      <Box>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.45)", fontWeight: 700, display: "block", mb: 0.5 }}>
          Météo
        </Typography>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} columnGap={1.5} rowGap={0.75}>
          {weather.map(renderEntry)}
        </Stack>
      </Box>
      <Box sx={{ textAlign: { sm: "right" } }}>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.45)", fontWeight: 700, display: "block", mb: 0.5 }}>
          PAC
        </Typography>
        <Stack
          direction="row"
          flexWrap="wrap"
          useFlexGap
          spacing={1}
          columnGap={1.5}
          rowGap={0.75}
          sx={{ justifyContent: { xs: "flex-start", sm: "flex-end" } }}
        >
          {pac.map(renderEntry)}
        </Stack>
      </Box>
    </Box>
  );
}

const followPeriods = [
  { id: "24h", label: "Dernières 24h" },
  { id: "3d", label: "3 derniers jours" },
  { id: "7d", label: "Dernière semaine" },
  { id: "30d", label: "Dernier mois" },
  { id: "365d", label: "Dernière année" },
];
const weatherTabs = []; // construit dynamiquement (dates) après fetch forecast

/** En production (Vercel), URL du backend Node (Render, Railway…). En dev, vide = proxy Vite vers /api. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return p;
  return `${API_BASE}${p}`;
}

async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), { headers: { "Content-Type": "application/json" }, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur API");
  return data;
}

export default function App() {
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [session, setSession] = useState(null);
  const [device, setDevice] = useState(null);
  const [history, setHistory] = useState([]);
  const [pacTrend, setPacTrend] = useState([]);
  const [weatherHistory, setWeatherHistory] = useState([]);
  const [wifiHistory, setWifiHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [period, setPeriod] = useState("3d");
  const [meteoTab, setMeteoTab] = useState("");
  const [trackingTab, setTrackingTab] = useState("temperature");
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [error, setError] = useState("");
  const weatherScrollRef = useRef(null);
  const nowRef = useRef(Date.now());
  const pauseGlobalRefreshUntilRef = useRef(0);

  useEffect(() => {
    document.title = "Clots de la Charmette";
  }, []);

  const refreshData = async () => {
    if (Date.now() < pauseGlobalRefreshUntilRef.current) return;
    nowRef.current = Date.now();
    const [s, d, h, p, w, wh] = await Promise.allSettled([
      api("/api/session"),
      api("/api/device"),
      api(`/api/history?period=${period}`),
      api(`/api/pac/trend?period=${period}`),
      api(`/api/pac/wifi-history?period=${period}`),
      api(`/api/weather/history?period=${period}`),
    ]);
    if (s.status === "fulfilled") setSession(s.value);
    if (d.status === "fulfilled") {
      setDevice(normalizeDeviceFromApi(d.value));
    } else if (d.status === "rejected") {
      const msg = String(d.reason?.message || "");
      if (msg.includes("Session MELCloud") || msg.includes("expirée") || msg.includes("Refresh token")) {
        setSession({ authenticated: false, email: null });
        setDevice(null);
        setError(msg);
      }
    }
    if (h.status === "fulfilled") setHistory(h.value.points || []);
    if (p.status === "fulfilled") setPacTrend(p.value.points || []);
    if (w.status === "fulfilled") setWifiHistory(w.value.points || []);
    if (wh.status === "fulfilled") setWeatherHistory(wh.value.points || []);
    if (s.status === "fulfilled" && s.value && !s.value.authenticated) {
      setDevice(null);
    }
  };

  useEffect(() => {
    refreshData().catch((e) => setError(e.message));
    const t = setInterval(() => refreshData().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [period]);

  useEffect(() => {
    api("/api/weather/forecast?horizon=4")
      .then(setForecast)
      .catch((e) => setError(e.message));
  }, []);

  const handleLogin = async () => {
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
      await refreshData();
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateControl = async (payload) => {
    // Optimistic UI: apply immediately, then reconcile with backend response.
    if (device) {
      setDevice((d) => (d ? normalizeDeviceFromApi({ ...d, ...payload }) : d));
    }
    setControlBusy(true);
    // Évite un refresh global qui tomberait "pile" pendant/après un control.
    pauseGlobalRefreshUntilRef.current = Date.now() + 8000;
    try {
      const out = await api("/api/device/control", { method: "POST", body: JSON.stringify(payload) });
      if (out?.device) setDevice(normalizeDeviceFromApi(out.device));
      setError("");
      // Keep history/graphs on their normal 30s refresh cadence (avoid reloading everything per click).
    } catch (e) {
      setError(e.message);
      // Best-effort resync of the device only (avoid full refresh).
      api("/api/device").then((dv) => setDevice(normalizeDeviceFromApi(dv))).catch(() => {});
    } finally {
      setControlBusy(false);
    }
  };

  const periodDomain = useMemo(() => {
    const now = nowRef.current || Date.now();
    const range = period === "24h" ? 24 * 3600e3 : period === "7d" ? 7 * 24 * 3600e3 : period === "30d" ? 30 * 24 * 3600e3 : period === "365d" ? 365 * 24 * 3600e3 : 3 * 24 * 3600e3;
    return [now - range, now];
  }, [period]);

  const tempData = useMemo(() => {
    const map = new Map();
    for (const p of history) {
      const ot = Number(p.outdoorTemp);
      map.set(p.ts, {
        ts: p.ts,
        interieure: Number(p.indoorTemp),
        consigne: Number(p.targetTemp),
        pacOn: !!p.power,
        pacExterieure: Number.isFinite(ot) ? ot : null,
      });
    }
    for (const p of pacTrend) {
      const cur = map.get(p.ts) || { ts: p.ts };
      const otTrend = Number(p.outdoorTemp);
      map.set(p.ts, {
        ...cur,
        interieure: Number.isFinite(Number(p.indoorTemp)) ? Number(p.indoorTemp) : cur.interieure,
        consigne: Number.isFinite(Number(p.targetTemp)) ? Number(p.targetTemp) : cur.consigne,
        pacExterieure: Number.isFinite(otTrend) ? otTrend : cur.pacExterieure ?? null,
      });
    }
    for (const p of weatherHistory) {
      const cur = map.get(p.ts) || { ts: p.ts };
      map.set(p.ts, {
        ...cur,
        sechilienne: p.sechilienneTemp ?? null,
        chamrousse: p.chamrousseTemp ?? null,
        sechiliennePrecipitation: Number.isFinite(Number(p.sechiliennePrecipitation)) ? Number(p.sechiliennePrecipitation) : 0,
        sechilienneSnowfall: Number.isFinite(Number(p.sechilienneSnowfall)) ? Number(p.sechilienneSnowfall) : 0,
        chamroussePrecipitation: p.chamroussePrecipitation ?? null,
        chamrousseSnowfall: p.chamrousseSnowfall ?? null,
      });
    }
    const rows = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
    const cleaned = rows.map((r, i) => {
      if (r.interieure !== 0) return r;
      const prev = rows[i - 1]?.interieure;
      const next = rows[i + 1]?.interieure;
      if ((Number.isFinite(prev) && prev !== 0) || (Number.isFinite(next) && next !== 0)) {
        return { ...r, interieure: null };
      }
      return r;
    });

    const windowSize = period === "24h" ? 2 : period === "3d" ? 3 : 4;
    return cleaned.map((r, i) => {
      const vals = [];
      for (let j = Math.max(0, i - windowSize); j <= Math.min(cleaned.length - 1, i + windowSize); j += 1) {
        const v = cleaned[j].interieure;
        if (Number.isFinite(v)) vals.push(v);
      }
      if (!vals.length) return r;
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { ...r, interieure: Math.round(avg * 10) / 10 };
    });
  }, [history, pacTrend, weatherHistory, period]);

  const wifiData = useMemo(() => wifiHistory.map((p) => ({ ts: p.ts, connectivite: p.connectivite ?? 100, rssi: p.rssi ?? null })), [wifiHistory]);

  const pacOnRanges = useMemo(() => {
    const [start, end] = periodDomain;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

    // Work on a slice inside the visible period (tempData can include a bit outside due to merges).
    const rows = tempData
      .filter((r) => Number.isFinite(r?.ts) && r.ts >= start && r.ts <= end)
      .map((r) => ({ ts: r.ts, pacOn: typeof r.pacOn === "boolean" ? r.pacOn : null }))
      .sort((a, b) => a.ts - b.ts);

    const hasAnyPacOn = rows.some((r) => typeof r.pacOn === "boolean");
    if (!hasAnyPacOn) {
      // Fallback: if we don't have historical ON/OFF yet, tint based on current device state.
      return device?.power ? [{ x1: start, x2: end }] : [];
    }

    const ranges = [];
    let lastState = null;
    let rangeStart = null;

    for (const r of rows) {
      if (typeof r.pacOn !== "boolean") continue;
      if (lastState === null) {
        lastState = r.pacOn;
        if (lastState) rangeStart = start;
        continue;
      }
      if (r.pacOn === lastState) continue;
      // State changed at r.ts
      if (lastState && rangeStart !== null) {
        ranges.push({ x1: rangeStart, x2: r.ts });
      }
      lastState = r.pacOn;
      rangeStart = lastState ? r.ts : null;
    }

    if (lastState && rangeStart !== null) {
      ranges.push({ x1: rangeStart, x2: end });
    }
    return ranges.filter((x) => x.x2 > x.x1);
  }, [tempData, periodDomain, device?.power]);
  const tempYDomain = useMemo(() => {
    const vals = tempData
      .flatMap((p) => [p.interieure, p.consigne, p.pacExterieure, p.sechilienne, p.chamrousse])
      .filter((v) => Number.isFinite(v));
    if (!vals.length) return [0, 30];
    return [Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)];
  }, [tempData]);
  const wifiYDomain = useMemo(() => {
    const vals = wifiData.flatMap((p) => [p.connectivite, p.rssi]).filter((v) => Number.isFinite(v));
    if (!vals.length) return [-100, 100];
    return [Math.floor(Math.min(...vals) - 5), Math.ceil(Math.max(...vals) + 5)];
  }, [wifiData]);

  const axis = { tick: { fill: "rgba(255,255,255,0.72)", fontSize: 12 }, tickLine: false, axisLine: { stroke: "rgba(255,255,255,0.25)" } };
  const tooltip = { contentStyle: { background: "rgba(8,14,28,.95)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, color: "#fff" }, labelStyle: { color: "#cbd5e1" } };
  const lineWidth = 2;

  const xScaleConfig = useMemo(() => {
    if (period === "24h") {
      return {
        tickFormatter: (v) => `${String(new Date(v).getHours()).padStart(2, "0")}h`,
        ticks: 9,
      };
    }
    if (period === "3d" || period === "7d" || period === "30d") {
      return {
        tickFormatter: (v) =>
          new Date(v).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }),
        ticks: period === "30d" ? 10 : 8,
      };
    }
    return {
      tickFormatter: (v) =>
        new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      ticks: 10,
    };
  }, [period]);

  const renderCleanTooltip = (isWifi = false) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = new Date(label);
    return (
      <Box sx={{ background: "rgba(8,14,28,.95)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 2, px: 1.5, py: 1 }}>
        <Typography variant="caption" sx={{ color: "#cbd5e1", display: "block", mb: 0.5 }}>
          {d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })} {d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </Typography>
        {payload.map((p) => (
          <Typography key={p.dataKey} variant="body2" sx={{ color: p.color }}>
            {p.name}: {Number.isFinite(Number(p.value)) ? Number(p.value).toFixed(1) : "--"}
            {isWifi ? (p.dataKey === "rssi" ? " dBm" : " %") : p.dataKey?.toLowerCase().includes("precipitation") ? " mm" : p.dataKey?.toLowerCase().includes("snowfall") ? " cm" : "°C"}
          </Typography>
        ))}
        {!isWifi && payload?.[0]?.payload && (
          <Typography variant="caption" sx={{ color: "#cbd5e1", display: "block", mt: 0.5 }}>
            Pluie/Neige La Charmette: {payload[0].payload.sechiliennePrecipitation ?? 0} mm / {payload[0].payload.sechilienneSnowfall ?? 0} cm
          </Typography>
        )}
      </Box>
    );
  };

  const forecastDailyRows = useMemo(() => {
    const s = forecast?.sechilienne || [];
    const c = forecast?.chamrousse || [];
    const rows = s.map((d, i) => ({ date: d.date, sech: d, cham: c[i] }));
    return rows.slice(0, 4);
  }, [forecast]);

  const dayParts = useMemo(() => {
    const parts = forecast?.parts;
    if (!parts) return null;
    return {
      sech: parts.sechilienne,
      cham: parts.chamrousse,
    };
  }, [forecast]);

  const weatherTabsDynamic = useMemo(() => {
    const dates = forecastDailyRows.map((r) => r.date).filter(Boolean);
    return dates.map((d) => ({
      id: d,
      label: new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }),
    }));
  }, [forecastDailyRows]);

  useEffect(() => {
    if (!meteoTab && weatherTabsDynamic.length) setMeteoTab(weatherTabsDynamic[0].id);
  }, [meteoTab, weatherTabsDynamic]);

  const meteoSlots = useMemo(
    () => [
      { id: "morning", label: "Matin" },
      { id: "afternoon", label: "Après-midi" },
      { id: "evening", label: "Soir" },
    ],
    [],
  );

  const isAuthenticated = !!session?.authenticated;
  if (!isAuthenticated) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Card><CardContent><Stack spacing={2}>
          <Typography variant="h5" fontWeight={700}>Connexion MELCloud</Typography>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email MELCloud" value={credentials.email} onChange={(e) => setCredentials((s) => ({ ...s, email: e.target.value }))} />
          <TextField label="Mot de passe MELCloud" type="password" value={credentials.password} onChange={(e) => setCredentials((s) => ({ ...s, password: e.target.value }))} />
          <Button variant="contained" onClick={handleLogin}>Se connecter</Button>
        </Stack></CardContent></Card>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h4" fontWeight={700}>Clots de la Charmette</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 6 }} sx={{ display: "flex" }}>
            <Card sx={{ height: "100%", width: "100%" }}><CardContent sx={{ height: "100%" }}>
              <Typography variant="h6" gutterBottom>Pilotage de la pompe a chaleur</Typography>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>
                    {device?.isConnected ? "Connectée" : "Déconnectée"}
                  </Typography>
                </Stack>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)" }}>
                    Température actuelle
                  </Typography>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                    <Stack direction="row" alignItems="baseline" spacing={1}>
                      <Typography variant="h2" sx={{ fontWeight: 800, lineHeight: 1 }}>
                        {Number.isFinite(Number(device?.indoorTemp)) ? Number(device.indoorTemp).toFixed(1) : "--"}
                      </Typography>
                      <Typography variant="h4" sx={{ opacity: 0.9 }}>
                        °C
                      </Typography>
                    </Stack>
                    <Box
                      component="span"
                      title={modeLabels[device?.operationMode] || "Mode"}
                      sx={{ display: "flex", alignItems: "center", color: "rgba(255,255,255,0.92)" }}
                    >
                      {device?.power ? (
                        <ModeIcon mode={device?.operationMode} sx={{ fontSize: 38 }} />
                      ) : (
                        <PowerSettingsNew sx={{ fontSize: 38, opacity: 0.72 }} aria-hidden />
                      )}
                    </Box>
                  </Stack>
                  {Number.isFinite(Number(device?.outdoorTemp)) && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", display: "block" }}>
                        Extérieure (sonde PAC)
                      </Typography>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {Number(device.outdoorTemp).toFixed(1)}
                        </Typography>
                        <Typography variant="body1" sx={{ opacity: 0.85 }}>
                          °C
                        </Typography>
                      </Stack>
                    </Box>
                  )}
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography>Marche / Arret</Typography>
                  <Switch disabled={controlBusy} checked={!!device?.power} onChange={(e) => updateControl({ power: e.target.checked })} />
                </Stack>
                <FormControl fullWidth>
                  <InputLabel id="pac-mode-label">Mode</InputLabel>
                  <Select
                    labelId="pac-mode-label"
                    label="Mode"
                    value={device?.operationMode || "Automatic"}
                    disabled={controlBusy}
                    onChange={(e) => updateControl({ operationMode: e.target.value })}
                    MenuProps={{ disableScrollLock: true, disablePortal: false }}
                  >
                    {modeOptions.map((m) => (
                      <MenuItem key={m} value={m}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <ModeIcon mode={m} sx={{ fontSize: 22 }} />
                        </ListItemIcon>
                        {modeLabels[m]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Box>
                  <Typography>Temperature cible: {device?.targetTemp ?? "--"}°C</Typography>
                  <Slider disabled={controlBusy} value={device?.targetTemp ?? 21} min={16} max={31} step={0.5} onChangeCommitted={(_, v) => updateControl({ setTemperature: v })} />
                </Box>
                <FormControl fullWidth>
                  <InputLabel id="pac-fan-label">Ventilation</InputLabel>
                  <Select
                    labelId="pac-fan-label"
                    label="Ventilation"
                    value={device?.fanSpeed || "One"}
                    disabled={controlBusy}
                    onChange={(e) => updateControl({ setFanSpeed: e.target.value })}
                    MenuProps={{ disableScrollLock: true, disablePortal: false }}
                  >
                    {fanOptions.map((m) => <MenuItem key={m} value={m}>{fanLabels[m]}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }} sx={{ display: "flex" }}>
            <Card sx={{ height: "100%", width: "100%" }}>
              <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <Typography variant="h6" gutterBottom>Meteo des Clots</Typography>
              <Tabs value={meteoTab} onChange={(_, v) => setMeteoTab(v)} sx={{ mb: 1 }}>
                {weatherTabsDynamic.map((t) => <Tab key={t.id} label={t.label} value={t.id} />)}
              </Tabs>
              <Box sx={{ height: { xs: "auto", md: 330 }, display: "flex", flex: 1, minHeight: 0 }}>
                <Grid container spacing={1} sx={{ width: "100%", m: 0, alignItems: "stretch" }}>
                  {dayParts &&
                    meteoSlots.map((slot) => {
                      const sech = dayParts.sech?.[meteoTab]?.[slot.id];
                      const cham = dayParts.cham?.[meteoTab]?.[slot.id];
                      return (
                        <Grid key={slot.id} size={{ xs: 12, md: 4 }} sx={{ display: "flex" }}>
                          <Card variant="outlined" sx={{ width: "100%", height: "100%" }}>
                            <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                              <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.9 }}>
                                {slot.label}
                              </Typography>

                              <Grid container spacing={1.5} sx={{ flex: 1, alignContent: "flex-start" }}>
                                <Grid size={{ xs: 12 }}>
                                  <Box sx={{ p: 1, borderRadius: 2, bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>🏠 La Charmette</Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.9, display: "flex", alignItems: "center", gap: 0.75 }}>
                                        <Box component="span" sx={{ fontSize: 34, lineHeight: 1 }}>{sech?.weatherIcon}</Box>
                                        <Box component="span">{sech?.weatherLabel}</Box>
                                      </Typography>
                                    </Stack>
                                    <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1 }}>
                                      <Typography variant="h4" sx={{ lineHeight: 1, fontWeight: 800 }}>
                                        {Number.isFinite(sech?.tempMax) ? Math.round(sech.tempMax) : "--"}°
                                      </Typography>
                                      <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
                                        {Number.isFinite(sech?.tempMin) ? Math.round(sech.tempMin) : "--"}°
                                      </Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                                        Pluie: <b>{Number.isFinite(sech?.precipitationMm) ? Math.round(sech.precipitationMm) : 0}</b> mm
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                                        Neige: <b>{Number.isFinite(sech?.snowfallCm) ? Math.round(sech.snowfallCm) : 0}</b> cm
                                      </Typography>
                                    </Stack>
                                  </Box>
                                </Grid>

                                <Grid size={{ xs: 12 }}>
                                  <Box sx={{ p: 1, borderRadius: 2, bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                      <Typography variant="body2" sx={{ fontWeight: 700 }}>🏔️ Chamrousse</Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.9, display: "flex", alignItems: "center", gap: 0.75 }}>
                                        <Box component="span" sx={{ fontSize: 34, lineHeight: 1 }}>{cham?.weatherIcon}</Box>
                                        <Box component="span">{cham?.weatherLabel}</Box>
                                      </Typography>
                                    </Stack>
                                    <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1 }}>
                                      <Typography variant="h4" sx={{ lineHeight: 1, fontWeight: 800 }}>
                                        {Number.isFinite(cham?.tempMax) ? Math.round(cham.tempMax) : "--"}°
                                      </Typography>
                                      <Typography variant="subtitle1" sx={{ opacity: 0.9 }}>
                                        {Number.isFinite(cham?.tempMin) ? Math.round(cham.tempMin) : "--"}°
                                      </Typography>
                                    </Stack>
                                    <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                                        Pluie: <b>{Number.isFinite(cham?.precipitationMm) ? Math.round(cham.precipitationMm) : 0}</b> mm
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.9 }}>
                                        Neige: <b>{Number.isFinite(cham?.snowfallCm) ? Math.round(cham.snowfallCm) : 0}</b> cm
                                      </Typography>
                                    </Stack>
                                  </Box>
                                </Grid>
                              </Grid>
                            </CardContent>
                          </Card>
                        </Grid>
                      );
                    })}
                </Grid>
              </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Card><CardContent>
              <Typography variant="h6" gutterBottom>Suivi</Typography>
              <Tabs value={trackingTab} onChange={(_, v) => setTrackingTab(v)} sx={{ mb: 1 }}>
                <Tab label="Temperature" value="temperature" />
                <Tab label="Connectivite" value="connectivite" />
              </Tabs>
              <Tabs value={period} onChange={(_, v) => setPeriod(v)} sx={{ mb: 1 }}>
                {followPeriods.map((p) => <Tab key={p.id} label={p.label} value={p.id} />)}
              </Tabs>
              <Box sx={{ width: "100%", minHeight: 330, height: 330 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={320} minHeight={240}>
                  {trackingTab === "temperature" ? (
                    <ComposedChart data={tempData} margin={{ top: 10, right: 18, left: 0, bottom: 6 }}>
                      {/* Fond plus clair sur toute la hauteur du tracé quand la PAC est allumée (sous grille + courbes) */}
                      {pacOnRanges.map((r) => (
                        <ReferenceArea
                          key={`pac-on-${Math.round(r.x1)}-${Math.round(r.x2)}`}
                          yAxisId="temp"
                          x1={r.x1}
                          x2={r.x2}
                          y1={tempYDomain[0]}
                          y2={tempYDomain[1]}
                          fill="rgba(255,255,255,0.11)"
                          strokeOpacity={0}
                          ifOverflow="extendDomain"
                        />
                      ))}
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ts" type="number" domain={periodDomain} {...axis} tickFormatter={xScaleConfig.tickFormatter} tickCount={xScaleConfig.ticks} interval="preserveStartEnd" />
                      <YAxis yAxisId="temp" domain={tempYDomain} {...axis} />
                      <YAxis
                        yAxisId="precip"
                        orientation="right"
                        domain={[0, (max) => Math.ceil((Number(max) || 0) + 1)]}
                        tick={{ fill: "rgba(255,255,255,0.72)", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "rgba(255,255,255,0.25)" }}
                      />
                      <Tooltip content={renderCleanTooltip(false)} />
                      <Legend content={<TemperatureSplitLegend />} wrapperStyle={{ width: "100%" }} />
                      <Bar
                        name="Pluie (La Charmette)"
                        dataKey="sechiliennePrecipitation"
                        yAxisId="precip"
                        stackId="precipLaCharmette"
                        fill="rgba(96,165,250,0.85)"
                        shape={precipBarShape}
                        isAnimationActive={false}
                      />
                      <Bar
                        name="Neige (La Charmette)"
                        dataKey="sechilienneSnowfall"
                        yAxisId="precip"
                        stackId="precipLaCharmette"
                        fill="rgba(226,232,240,0.80)"
                        shape={precipBarShape}
                        isAnimationActive={false}
                      />

                      <Line yAxisId="temp" name="Extérieure La Charmette" type="monotone" dataKey="sechilienne" stroke="#60a5fa" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line yAxisId="temp" name="Extérieure Chamrousse" type="monotone" dataKey="chamrousse" stroke="#c084fc" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line yAxisId="temp" name="Température réelle PAC" type="monotone" dataKey="interieure" stroke="#2ed4bf" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line yAxisId="temp" name="Consigne PAC" type="monotone" dataKey="consigne" stroke="#f59e0b" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line yAxisId="temp" name="Extérieure (PAC)" type="monotone" dataKey="pacExterieure" stroke="#38bdf8" strokeWidth={lineWidth} dot={false} connectNulls />
                    </ComposedChart>
                  ) : (
                    <LineChart data={wifiData} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ts" type="number" domain={periodDomain} {...axis} tickFormatter={xScaleConfig.tickFormatter} tickCount={xScaleConfig.ticks} interval="preserveStartEnd" />
                      <YAxis domain={wifiYDomain} {...axis} />
                      <Tooltip content={renderCleanTooltip(true)} />
                      <Legend />
                      <Line name="Connectivite (%)" type="monotone" dataKey="connectivite" stroke="#22c55e" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line name="Signal RSSI (dBm)" type="monotone" dataKey="rssi" stroke="#ef4444" strokeWidth={lineWidth} dot={false} connectNulls />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </Box>
            </CardContent></Card>
          </Grid>
        </Grid>
      </Stack>
    </Container>
  );
}
