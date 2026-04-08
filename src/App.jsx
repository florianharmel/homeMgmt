import { useEffect, useMemo, useRef, useState } from "react";
import AcUnit from "@mui/icons-material/AcUnit";
import Air from "@mui/icons-material/Air";
import Dehaze from "@mui/icons-material/Dehaze";
import Lightbulb from "@mui/icons-material/Lightbulb";
import PowerSettingsNew from "@mui/icons-material/PowerSettingsNew";
import WbSunny from "@mui/icons-material/WbSunny";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  ListItemIcon,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

const TRACK_LINE_ANIM = { isAnimationActive: true, animationDuration: 560, animationEasing: "ease-in-out" };
const TRACK_BAR_ANIM = { isAnimationActive: true, animationDuration: 500, animationEasing: "ease-in-out" };

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
const SENSOR_LEGEND_ORDER = ["Température intérieure", "Consigne PAC", "Extérieure"];
const SWITCHBOT_COLOR_POOL = ["#f472b6", "#34d399", "#f87171", "#a78bfa", "#fb7185", "#22d3ee", "#facc15", "#4ade80"];

/** Libellés Recharts `name` → clé `chartSeriesVisible`. */
const LEGEND_VALUE_TO_KEY = {
  "Pluie (La Charmette)": "pluie",
  "Neige (La Charmette)": "neige",
  "Extérieure La Charmette": "sechilienne",
  "Extérieure Chamrousse": "chamrousse",
  "Température intérieure": "interieure",
  "Consigne PAC": "consigne",
  "Extérieure": "pacExterieure",
};

function normalizeSwitchbotLabel(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function switchbotSeriesKey(deviceId) {
  return `switchbot_${String(deviceId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function sortLegendByOrder(entries, order) {
  const rank = (name) => {
    const i = order.indexOf(name);
    return i === -1 ? 1000 : i;
  };
  return [...entries].sort((a, b) => rank(a.value) - rank(b.value));
}

function TemperatureSplitLegend(props) {
  const { payload, chartSeriesVisible, onToggleSeries, legendValueToKey, switchbotSeriesKeys } = props;
  if (!payload?.length) return null;
  const isSwitchbotEntry = (entry) => {
    const key = entry?.dataKey;
    return Boolean(key && switchbotSeriesKeys?.has?.(String(key)));
  };
  const weather = sortLegendByOrder(
    payload.filter((e) => LEGEND_WEATHER.has(e.value)),
    WEATHER_LEGEND_ORDER,
  );
  const sensors = sortLegendByOrder(
    payload.filter((e) => !LEGEND_WEATHER.has(e.value) && !isSwitchbotEntry(e)),
    SENSOR_LEGEND_ORDER,
  );
  const switchbot = sortLegendByOrder(payload.filter((e) => isSwitchbotEntry(e)), []);
  const renderEntry = (entry) => {
    const c = entry.color;
    const isBar = entry.type === "rect" || entry.type === "square";
    const seriesKey = legendValueToKey?.[entry.value] || LEGEND_VALUE_TO_KEY[entry.value];
    const visible = seriesKey ? !!chartSeriesVisible?.[seriesKey] : true;
    const interactive = Boolean(seriesKey && onToggleSeries);
    return (
      <Box
        key={String(entry.dataKey ?? entry.value)}
        component={interactive ? "button" : "div"}
        type={interactive ? "button" : undefined}
        onClick={interactive ? () => onToggleSeries(seriesKey) : undefined}
        aria-pressed={interactive ? visible : undefined}
        sx={{
          display: "inline-flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 0.75,
          border: "none",
          background: "none",
          padding: 0,
          margin: 0,
          cursor: interactive ? "pointer" : "default",
          opacity: visible ? 1 : 0.38,
          transition: "opacity 0.18s ease",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          "&:hover": interactive
            ? {
                opacity: visible ? 0.88 : 0.52,
              }
            : undefined,
          "&:focus-visible": interactive
            ? {
                outline: "2px solid rgba(255,255,255,0.35)",
                outlineOffset: 2,
                borderRadius: 0.5,
              }
            : undefined,
        }}
      >
        {isBar ? (
          <Box sx={{ width: 14, height: 10, bgcolor: c, borderRadius: 0.5, flexShrink: 0, opacity: visible ? 0.95 : 0.55 }} />
        ) : (
          <Box component="span" sx={{ width: 14, height: 3, bgcolor: c, borderRadius: 0.5, display: "inline-block", flexShrink: 0, opacity: visible ? 1 : 0.55 }} />
        )}
        <Typography component="span" variant="caption" sx={{ color: "rgba(255,255,255,0.88)", whiteSpace: "nowrap" }}>
          {entry.value}
        </Typography>
      </Box>
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
      <Box sx={{ width: "100%" }}>
        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.42)", display: "block", mb: 0.75 }}>
          Cliquer sur une légende pour afficher ou masquer la série
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
          <Box sx={{ flex: { sm: "1 1 0" }, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.45)", fontWeight: 700, display: "block", mb: 0.5 }}>
              Météo
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} columnGap={1.5} rowGap={0.75}>
              {weather.map(renderEntry)}
            </Stack>
          </Box>
          <Box sx={{ flex: { sm: "1 1 0" }, minWidth: 0, textAlign: { sm: "right" } }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.45)", fontWeight: 700, display: "block", mb: 0.5 }}>
              Sondes
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
              {[...sensors, ...switchbot].map(renderEntry)}
            </Stack>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const followPeriods = [
  { id: "24h", label: "Dernières 24h" },
  { id: "3d", label: "3 derniers jours" },
  { id: "7d", label: "Dernière semaine" },
  { id: "30d", label: "Dernier mois" },
  { id: "90d", label: "3 derniers mois" },
];
const weatherTabs = []; // construit dynamiquement (dates) après fetch forecast

/** En production (Vercel), URL du backend Node (Render, Railway…). En dev, vide = proxy Vite vers /api. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE) return p;
  return `${API_BASE}${p}`;
}

function extendSeriesToDomain(rows, start, end) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const inside = rows.filter((r) => Number.isFinite(r?.ts) && r.ts >= start && r.ts <= end).sort((a, b) => a.ts - b.ts);
  if (!inside.length) return [];
  const out = [...inside];
  if (inside[0].ts > start) out.unshift({ ...inside[0], ts: start });
  if (inside[inside.length - 1].ts < end) out.push({ ...inside[inside.length - 1], ts: end });
  return out;
}

async function api(path, options = {}) {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options || {};

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(path), {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...fetchOptions,
    });

    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json() : { error: await res.text() };
    if (!res.ok) throw new Error(data?.error || "Erreur API");
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Timeout API");
    throw e;
  } finally {
    clearTimeout(t);
  }
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
  const [switchbotLive, setSwitchbotLive] = useState({ sensors: [], temps: {}, updatedAt: 0 });
  const [period, setPeriod] = useState("3d");
  const [meteoTab, setMeteoTab] = useState("");
  const [trackingTab, setTrackingTab] = useState("temperature");
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [error, setError] = useState("");
  const weatherScrollRef = useRef(null);
  /** Borne droite des graphiques de suivi (doit bouger avec l’heure réelle, pas seulement au changement de période). */
  const [chartNow, setChartNow] = useState(() => Date.now());
  const pauseGlobalRefreshUntilRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const switchbotSalonId = useMemo(() => {
    const sensors = Array.isArray(switchbotLive?.sensors) ? switchbotLive.sensors : [];
    for (const s of sensors) {
      if (normalizeSwitchbotLabel(s?.deviceName) === "etagere salon") return String(s?.deviceId || "");
    }
    return "";
  }, [switchbotLive]);

  const switchbotExterieurId = useMemo(() => {
    const sensors = Array.isArray(switchbotLive?.sensors) ? switchbotLive.sensors : [];
    for (const s of sensors) {
      if (normalizeSwitchbotLabel(s?.deviceName) === "exterieur") return String(s?.deviceId || "");
    }
    return "";
  }, [switchbotLive]);

  /** Courbes / barres affichées sur le graphique température (défaut : pas consigne, pas ext. PAC, pas Chamrousse). */
  const [chartSeriesVisible, setChartSeriesVisible] = useState({
    interieure: true,
    consigne: false,
    sechilienne: true,
    chamrousse: false,
    pacExterieure: false,
    pluie: true,
    neige: true,
  });

  useEffect(() => {
    document.title = "Clots de la Charmette";
  }, []);

  const refreshData = async () => {
    if (Date.now() < pauseGlobalRefreshUntilRef.current) return;
    if (refreshInFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    try {
      const s = await api("/api/session");
      setSession(s);
      if (!s?.authenticated) {
        setDevice(null);
        return;
      }

      // Device + historiques en parallèle : le serveur ne bloque plus /api/device sur tout le lot Open-Meteo.
      const [dRes, h, p, w, wh, sb] = await Promise.allSettled([
        api("/api/device"),
        api(`/api/history?period=${period}`),
        api(`/api/pac/trend?period=${period}`),
        api(`/api/pac/wifi-history?period=${period}`),
        api(`/api/weather/history?period=${period}`),
        api("/api/switchbot/live", { timeoutMs: 4000 }),
      ]);
      if (dRes.status === "fulfilled") {
        setDevice(dRes.value ? normalizeDeviceFromApi(dRes.value) : null);
      } else {
        const msg = String(dRes.reason?.message || "");
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
      if (sb.status === "fulfilled") setSwitchbotLive(sb.value || { sensors: [], temps: {}, updatedAt: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      refreshInFlightRef.current = false;
      setChartNow(Date.now());
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        queueMicrotask(() => {
          refreshData().catch(() => {});
        });
      }
    }
  };

  useEffect(() => {
    refreshData().catch((e) => setError(e.message));
    const t = setInterval(() => refreshData().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [period]);

  /** Fait avancer la borne droite du graphique même entre deux chargements de données. */
  useEffect(() => {
    const t = setInterval(() => setChartNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

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
    const range =
      period === "24h"
        ? 24 * 3600e3
        : period === "7d"
          ? 7 * 24 * 3600e3
          : period === "30d"
            ? 30 * 24 * 3600e3
            : period === "90d"
              ? 90 * 24 * 3600e3
              : 3 * 24 * 3600e3;
    return [chartNow - range, chartNow];
  }, [period, chartNow]);

  const tempData = useMemo(() => {
    const map = new Map();
    for (const p of history) {
      const sbTemps = p?.switchbotTemps && typeof p.switchbotTemps === "object" ? p.switchbotTemps : null;
      const salonTemp = switchbotSalonId && sbTemps ? Number(sbTemps[switchbotSalonId]) : NaN;
      const exterieurTemp = switchbotExterieurId && sbTemps ? Number(sbTemps[switchbotExterieurId]) : NaN;
      const row = {
        ts: p.ts,
        interieure: Number.isFinite(salonTemp) ? salonTemp : Number(p.indoorTemp),
        consigne: Number(p.targetTemp),
        pacOn: !!p.power,
        pacExterieure: Number.isFinite(exterieurTemp) ? exterieurTemp : null,
      };
      if (sbTemps) {
        for (const [deviceId, rawTemp] of Object.entries(sbTemps)) {
          const n = Number(rawTemp);
          row[switchbotSeriesKey(deviceId)] = Number.isFinite(n) ? n : null;
        }
      }
      map.set(p.ts, row);
    }
    const liveTs = Number(switchbotLive?.updatedAt);
    const liveTemps = switchbotLive?.temps && typeof switchbotLive.temps === "object" ? switchbotLive.temps : null;
    if (Number.isFinite(liveTs) && liveTs > 0 && liveTemps) {
      const row = map.get(liveTs) || { ts: liveTs };
      for (const [deviceId, rawTemp] of Object.entries(liveTemps)) {
        const n = Number(rawTemp);
        row[switchbotSeriesKey(deviceId)] = Number.isFinite(n) ? n : null;
      }
      if (switchbotSalonId) {
        const n = Number(liveTemps[switchbotSalonId]);
        if (Number.isFinite(n)) row.interieure = n;
      }
      if (switchbotExterieurId) {
        const n = Number(liveTemps[switchbotExterieurId]);
        row.pacExterieure = Number.isFinite(n) ? n : row.pacExterieure ?? null;
      }
      map.set(liveTs, row);
    }
    for (const p of pacTrend) {
      const cur = map.get(p.ts) || { ts: p.ts };
      map.set(p.ts, {
        ...cur,
        consigne: Number.isFinite(Number(p.targetTemp)) ? Number(p.targetTemp) : cur.consigne,
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
  }, [history, pacTrend, weatherHistory, period, switchbotLive, switchbotSalonId, switchbotExterieurId]);

  const wifiData = useMemo(() => wifiHistory.map((p) => ({ ts: p.ts, connectivite: p.connectivite ?? 100, rssi: p.rssi ?? null })), [wifiHistory]);

  const chartTempData = useMemo(() => {
    const [start, end] = periodDomain;
    const rows = tempData.filter((r) => Number.isFinite(r.ts) && r.ts <= chartNow);
    return extendSeriesToDomain(rows, start, end);
  }, [tempData, chartNow, periodDomain]);
  const chartWifiData = useMemo(() => {
    const [start, end] = periodDomain;
    const rows = wifiData.filter((r) => Number.isFinite(r.ts) && r.ts <= chartNow);
    return extendSeriesToDomain(rows, start, end);
  }, [wifiData, chartNow, periodDomain]);
  const switchbotSeries = useMemo(() => {
    const namesById = new Map((switchbotLive?.sensors || []).map((s) => [String(s.deviceId), s.deviceName || s.deviceId]));
    for (const p of history) {
      const devices = Array.isArray(p?.switchbotDevices) ? p.switchbotDevices : [];
      for (const d of devices) {
        const id = String(d?.deviceId || "");
        if (!id) continue;
        if (!namesById.has(id)) namesById.set(id, d?.deviceName || id);
      }
    }
    if (switchbotSalonId) namesById.delete(String(switchbotSalonId));
    if (switchbotExterieurId) namesById.delete(String(switchbotExterieurId));
    return Array.from(namesById.entries()).map(([deviceId, deviceName], idx) => ({
      deviceId,
      key: switchbotSeriesKey(deviceId),
      name: `${deviceName}`,
      color: SWITCHBOT_COLOR_POOL[idx % SWITCHBOT_COLOR_POOL.length],
    }));
  }, [switchbotLive, history, switchbotSalonId, switchbotExterieurId]);
  const switchbotSeriesKeys = useMemo(() => new Set(switchbotSeries.map((s) => s.key)), [switchbotSeries]);
  const legendValueToKey = useMemo(() => {
    const map = { ...LEGEND_VALUE_TO_KEY };
    for (const s of switchbotSeries) map[s.name] = s.key;
    return map;
  }, [switchbotSeries]);

  const pacOnRanges = useMemo(() => {
    const [start, end] = periodDomain;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

    // Work on a slice inside the visible period (chartTempData exclut tout point > maintenant).
    const rows = chartTempData
      .filter((r) => Number.isFinite(r?.ts) && r.ts >= start && r.ts <= end)
      .map((r) => ({ ts: r.ts, pacOn: typeof r.pacOn === "boolean" ? r.pacOn : null }))
      .sort((a, b) => a.ts - b.ts);

    const hasAnyPacOn = rows.some((r) => typeof r.pacOn === "boolean");
    if (!hasAnyPacOn) {
      // Sans historique fiable, ne pas peindre toute la fenêtre : petite bande à droite si la PAC est marquée marche.
      if (!device?.power) return [];
      const windowMs = 20 * 60 * 1000;
      return [{ x1: Math.max(start, end - windowMs), x2: end }];
    }

    const ranges = [];
    let lastState = null;
    let rangeStart = null;

    for (const r of rows) {
      if (typeof r.pacOn !== "boolean") continue;
      if (lastState === null) {
        lastState = r.pacOn;
        // Ne pas étendre jusqu’au début de la période : la plage commence au premier instant où l’état est connu.
        if (lastState) rangeStart = r.ts;
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
  }, [chartTempData, periodDomain, device?.power]);
  const tempYDomain = useMemo(() => {
    const vals = [];
    for (const p of chartTempData) {
      if (chartSeriesVisible.interieure && Number.isFinite(p.interieure)) vals.push(p.interieure);
      if (chartSeriesVisible.consigne && Number.isFinite(p.consigne)) vals.push(p.consigne);
      if (chartSeriesVisible.pacExterieure && Number.isFinite(p.pacExterieure)) vals.push(p.pacExterieure);
      if (chartSeriesVisible.sechilienne && Number.isFinite(p.sechilienne)) vals.push(p.sechilienne);
      if (chartSeriesVisible.chamrousse && Number.isFinite(p.chamrousse)) vals.push(p.chamrousse);
      for (const s of switchbotSeries) {
        if (!chartSeriesVisible[s.key]) continue;
        if (Number.isFinite(p[s.key])) vals.push(p[s.key]);
      }
    }
    if (!vals.length) return [0, 30];
    return [Math.floor(Math.min(...vals) - 1), Math.ceil(Math.max(...vals) + 1)];
  }, [chartTempData, chartSeriesVisible, switchbotSeries]);
  const wifiYDomain = useMemo(() => {
    const vals = chartWifiData.flatMap((p) => [p.connectivite, p.rssi]).filter((v) => Number.isFinite(v));
    if (!vals.length) return [-100, 100];
    return [Math.floor(Math.min(...vals) - 5), Math.ceil(Math.max(...vals) + 5)];
  }, [chartWifiData]);

  const axis = { tick: { fill: "rgba(255,255,255,0.72)", fontSize: 11 }, tickLine: false, axisLine: { stroke: "rgba(255,255,255,0.22)" } };
  const tooltip = {
    contentStyle: { background: "rgba(8,14,28,.95)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, color: "#fff" },
    labelStyle: { color: "#cbd5e1" },
    cursor: { stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 },
  };
  const lineWidth = 1.5;

  const xScaleConfig = useMemo(() => {
    const [start, end] = periodDomain;
    const hourMs = 60 * 60 * 1000;

    const buildTicks = (stepMs) => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const ticks = [];
      for (let t = start; t <= end; t += stepMs) ticks.push(t);
      if (!ticks.length || ticks[ticks.length - 1] < end) ticks.push(end);
      return ticks;
    };

    if (period === "24h") {
      const ticks = buildTicks(hourMs);
      const first = ticks[0];
      const last = ticks[ticks.length - 1];
      return {
        ticks,
        tickFormatter: (v) => {
          if (v === first || v === last) return `${String(new Date(v).getHours()).padStart(2, "0")}h`;
          return new Date(v).getHours() % 2 === 0 ? `${String(new Date(v).getHours()).padStart(2, "0")}h` : "";
        },
        tickCount: undefined,
      };
    }
    if (period === "3d" || period === "7d") {
      const steps = period === "3d" ? 3 : 7;
      const ticks = Array.from({ length: steps + 1 }, (_, i) => start + (i * (end - start)) / steps);
      return {
        ticks,
        tickFormatter: (v) =>
          new Date(v).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }),
        tickCount: undefined,
      };
    }
    if (period === "30d" || period === "90d") {
      return {
        ticks: undefined,
        tickFormatter: (v) =>
          new Date(v).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }),
        tickCount: period === "90d" ? 12 : 10,
      };
    }
    return {
      ticks: undefined,
      tickFormatter: (v) =>
        new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
      tickCount: 10,
    };
  }, [period, periodDomain]);

  const xAxisMinTickGap = useMemo(() => {
    if (period === "24h") return 12;
    if (period === "3d") return 16;
    if (period === "7d") return 22;
    return 28;
  }, [period]);

  useEffect(() => {
    if (!switchbotSeries.length) return;
    setChartSeriesVisible((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of switchbotSeries) {
        if (Object.prototype.hasOwnProperty.call(next, s.key)) continue;
        next[s.key] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [switchbotSeries]);

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
  const pilotageIndoorTemp = useMemo(() => {
    const liveTemps = switchbotLive?.temps && typeof switchbotLive.temps === "object" ? switchbotLive.temps : null;
    if (switchbotSalonId && liveTemps) {
      const n = Number(liveTemps[switchbotSalonId]);
      if (Number.isFinite(n)) return n;
    }
    return Number(device?.indoorTemp);
  }, [switchbotLive, switchbotSalonId, device?.indoorTemp]);

  const pilotageOutdoorTemp = useMemo(() => {
    const liveTemps = switchbotLive?.temps && typeof switchbotLive.temps === "object" ? switchbotLive.temps : null;
    if (!switchbotExterieurId || !liveTemps) return NaN;
    return Number(liveTemps[switchbotExterieurId]);
  }, [switchbotLive, switchbotExterieurId]);

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
                        {Number.isFinite(Number(pilotageIndoorTemp)) ? Number(pilotageIndoorTemp).toFixed(1) : "--"}
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
                  {Number.isFinite(Number(pilotageOutdoorTemp)) && (
                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", display: "block" }}>
                        Extérieure
                      </Typography>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {Number(pilotageOutdoorTemp).toFixed(1)}
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
                    <ComposedChart data={chartTempData} margin={{ top: 10, right: 4, left: 0, bottom: 6 }}>
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
                      <CartesianGrid strokeDasharray="2 4" stroke="rgba(148,163,184,0.28)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={periodDomain}
                        {...axis}
                        ticks={xScaleConfig.ticks}
                        tickFormatter={xScaleConfig.tickFormatter}
                        tickCount={xScaleConfig.tickCount}
                        interval={0}
                        minTickGap={xAxisMinTickGap}
                        tickMargin={8}
                      />
                      <YAxis yAxisId="temp" domain={tempYDomain} {...axis} />
                      <YAxis
                        yAxisId="precip"
                        orientation="right"
                        hide
                        domain={[0, (max) => Math.ceil((Number(max) || 0) + 1)]}
                      />
                      <Tooltip content={renderCleanTooltip(false)} {...tooltip} />
                      <Legend
                        content={(legendProps) => (
                          <TemperatureSplitLegend
                            {...legendProps}
                            chartSeriesVisible={chartSeriesVisible}
                            legendValueToKey={legendValueToKey}
                            switchbotSeriesKeys={switchbotSeriesKeys}
                            onToggleSeries={(key) =>
                              setChartSeriesVisible((v) => ({ ...v, [key]: !v[key] }))
                            }
                          />
                        )}
                        wrapperStyle={{ width: "100%" }}
                      />
                      <Bar
                        name="Pluie (La Charmette)"
                        dataKey="sechiliennePrecipitation"
                        yAxisId="precip"
                        stackId="precipLaCharmette"
                        fill="rgba(96,165,250,0.85)"
                        shape={precipBarShape}
                        {...TRACK_BAR_ANIM}
                        hide={!chartSeriesVisible.pluie}
                      />
                      <Bar
                        name="Neige (La Charmette)"
                        dataKey="sechilienneSnowfall"
                        yAxisId="precip"
                        stackId="precipLaCharmette"
                        fill="rgba(226,232,240,0.80)"
                        shape={precipBarShape}
                        {...TRACK_BAR_ANIM}
                        hide={!chartSeriesVisible.neige}
                      />

                      <Line
                        yAxisId="temp"
                        name="Extérieure La Charmette"
                        type="monotone"
                        dataKey="sechilienne"
                        stroke="#60a5fa"
                        strokeWidth={lineWidth}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        connectNulls
                        {...TRACK_LINE_ANIM}
                        hide={!chartSeriesVisible.sechilienne}
                      />
                      <Line
                        yAxisId="temp"
                        name="Extérieure Chamrousse"
                        type="monotone"
                        dataKey="chamrousse"
                        stroke="#c084fc"
                        strokeWidth={lineWidth}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        connectNulls
                        {...TRACK_LINE_ANIM}
                        hide={!chartSeriesVisible.chamrousse}
                      />
                      <Line
                        yAxisId="temp"
                        name="Température intérieure"
                        type="monotone"
                        dataKey="interieure"
                        stroke="#2ed4bf"
                        strokeWidth={lineWidth}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        connectNulls
                        {...TRACK_LINE_ANIM}
                        hide={!chartSeriesVisible.interieure}
                      />
                      <Line
                        yAxisId="temp"
                        name="Consigne PAC"
                        type="monotone"
                        dataKey="consigne"
                        stroke="#f59e0b"
                        strokeWidth={lineWidth}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        connectNulls
                        {...TRACK_LINE_ANIM}
                        hide={!chartSeriesVisible.consigne}
                      />
                      <Line
                        yAxisId="temp"
                        name="Extérieure"
                        type="monotone"
                        dataKey="pacExterieure"
                        stroke="#38bdf8"
                        strokeWidth={lineWidth}
                        dot={false}
                        activeDot={{ r: 2.5 }}
                        connectNulls
                        {...TRACK_LINE_ANIM}
                        hide={!chartSeriesVisible.pacExterieure}
                      />
                      {switchbotSeries.map((s) => (
                        <Line
                          key={s.key}
                          yAxisId="temp"
                          name={s.name}
                          type="monotone"
                          dataKey={s.key}
                          stroke={s.color}
                          strokeWidth={lineWidth}
                          dot={false}
                          activeDot={{ r: 2.5 }}
                          connectNulls
                          {...TRACK_LINE_ANIM}
                          hide={!chartSeriesVisible[s.key]}
                        />
                      ))}
                    </ComposedChart>
                  ) : (
                    <LineChart data={chartWifiData} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="rgba(148,163,184,0.28)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={periodDomain}
                        {...axis}
                        ticks={xScaleConfig.ticks}
                        tickFormatter={xScaleConfig.tickFormatter}
                        tickCount={xScaleConfig.tickCount}
                        interval={0}
                        minTickGap={xAxisMinTickGap}
                        tickMargin={8}
                      />
                      <YAxis domain={wifiYDomain} {...axis} />
                      <Tooltip content={renderCleanTooltip(true)} {...tooltip} />
                      <Legend />
                      <Line name="Connectivite (%)" type="monotone" dataKey="connectivite" stroke="#22c55e" strokeWidth={lineWidth} dot={false} activeDot={{ r: 2.5 }} connectNulls {...TRACK_LINE_ANIM} />
                      <Line name="Signal RSSI (dBm)" type="monotone" dataKey="rssi" stroke="#ef4444" strokeWidth={lineWidth} dot={false} activeDot={{ r: 2.5 }} connectNulls {...TRACK_LINE_ANIM} />
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
