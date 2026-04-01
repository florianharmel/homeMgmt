import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, Container, FormControl, Grid, InputLabel, LinearProgress, MenuItem, Select, Slider, Stack, Switch, Tab, Tabs, TextField, Typography } from "@mui/material";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const modeOptions = ["HEAT", "COOL", "AUTO", "DRY", "FAN"];
const fanOptions = ["AUTO", "QUIET", "0", "1", "2", "3", "4", "5"];
const modeLabels = { HEAT: "Chauffage", COOL: "Refroidissement", AUTO: "Auto", DRY: "Déshumidification", FAN: "Ventilation" };
const fanLabels = { AUTO: "Auto", QUIET: "Silencieux", 0: "Auto", 1: "Vitesse 1", 2: "Vitesse 2", 3: "Vitesse 3", 4: "Vitesse 4", 5: "Vitesse 5" };
const followPeriods = [
  { id: "24h", label: "Dernières 24h" },
  { id: "3d", label: "3 derniers jours" },
  { id: "7d", label: "Dernière semaine" },
  { id: "30d", label: "Dernier mois" },
  { id: "365d", label: "Dernière année" },
];
const weatherTabs = [
  { id: "today", label: "Aujourd'hui" },
  { id: "tomorrow", label: "Demain" },
  { id: "3d", label: "3 jours" },
  { id: "weekend", label: "Week-end à venir" },
  { id: "15d", label: "15 prochains jours" },
];

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
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
  const [meteoTab, setMeteoTab] = useState("3d");
  const [trackingTab, setTrackingTab] = useState("temperature");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const weatherScrollRef = useRef(null);

  useEffect(() => {
    document.title = "Clots de la Charmette";
  }, []);

  const refreshData = async () => {
    const [s, d, h, p, w, wh] = await Promise.allSettled([
      api("/api/session"),
      api("/api/device"),
      api(`/api/history?period=${period}`),
      api(`/api/pac/trend?period=${period}`),
      api(`/api/pac/wifi-history?period=${period}`),
      api(`/api/weather/history?period=${period}`),
    ]);
    if (s.status === "fulfilled") setSession(s.value);
    if (d.status === "fulfilled") setDevice(d.value);
    if (h.status === "fulfilled") setHistory(h.value.points || []);
    if (p.status === "fulfilled") setPacTrend(p.value.points || []);
    if (w.status === "fulfilled") setWifiHistory(w.value.points || []);
    if (wh.status === "fulfilled") setWeatherHistory(wh.value.points || []);
  };

  useEffect(() => {
    refreshData().catch((e) => setError(e.message));
    const t = setInterval(() => refreshData().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [period]);

  useEffect(() => {
    api("/api/weather/forecast?horizon=15")
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
    try {
      await api("/api/device/control", { method: "POST", body: JSON.stringify(payload) });
      await refreshData();
    } catch (e) {
      setError(e.message);
    }
  };

  const periodDomain = useMemo(() => {
    const now = Date.now();
    const range = period === "24h" ? 24 * 3600e3 : period === "7d" ? 7 * 24 * 3600e3 : period === "30d" ? 30 * 24 * 3600e3 : period === "365d" ? 365 * 24 * 3600e3 : 3 * 24 * 3600e3;
    return [now - range, now];
  }, [period]);

  const tempData = useMemo(() => {
    const map = new Map();
    for (const p of history) map.set(p.ts, { ts: p.ts, interieure: Number(p.indoorTemp), consigne: Number(p.targetTemp) });
    for (const p of pacTrend) {
      const cur = map.get(p.ts) || { ts: p.ts };
      map.set(p.ts, { ...cur, interieure: Number.isFinite(Number(p.indoorTemp)) ? Number(p.indoorTemp) : cur.interieure, consigne: Number.isFinite(Number(p.targetTemp)) ? Number(p.targetTemp) : cur.consigne });
    }
    for (const p of weatherHistory) {
      const cur = map.get(p.ts) || { ts: p.ts };
      map.set(p.ts, {
        ...cur,
        sechilienne: p.sechilienneTemp ?? null,
        chamrousse: p.chamrousseTemp ?? null,
        sechiliennePrecipitation: p.sechiliennePrecipitation ?? null,
        sechilienneSnowfall: p.sechilienneSnowfall ?? null,
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
  const tempYDomain = useMemo(() => {
    const vals = tempData.flatMap((p) => [p.interieure, p.consigne, p.sechilienne, p.chamrousse]).filter((v) => Number.isFinite(v));
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
    if (period === "3d" || period === "7d") {
      return {
        tickFormatter: (v) =>
          new Date(v).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" }),
        ticks: 8,
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
            {isWifi ? (p.dataKey === "rssi" ? " dBm" : " %") : "°C"}
          </Typography>
        ))}
        {!isWifi && payload?.[0]?.payload && (
          <Typography variant="caption" sx={{ color: "#cbd5e1", display: "block", mt: 0.5 }}>
            Pluie/Neige Séchilienne: {payload[0].payload.sechiliennePrecipitation ?? 0} mm / {payload[0].payload.sechilienneSnowfall ?? 0} cm
          </Typography>
        )}
      </Box>
    );
  };

  const forecastRows = useMemo(() => {
    const s = forecast?.sechilienne || [];
    const c = forecast?.chamrousse || [];
    const rows = s.map((d, i) => ({ date: d.date, sech: d, cham: c[i] }));
    if (meteoTab === "today") return rows.slice(0, 1);
    if (meteoTab === "tomorrow") return rows.slice(1, 2);
    if (meteoTab === "3d") return rows.slice(0, 3);
    if (meteoTab === "15d") return rows.slice(0, 15);
    // weekend
    const idx = rows.findIndex((r, i) => i >= 3 && [0, 6].includes(new Date(r.date).getDay()));
    return idx >= 0 ? rows.slice(idx, idx + 2) : [];
  }, [forecast, meteoTab]);

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
                <Stack direction="row" spacing={1}><Chip label={device?.name || "PAC"} /><Chip color={device?.isConnected ? "success" : "error"} label={device?.isConnected ? "Connectee" : "Deconnectee"} /></Stack>
                <Stack direction="row" spacing={1} alignItems="center"><Typography>Marche / Arret</Typography><Switch checked={!!device?.power} onChange={(e) => updateControl({ power: e.target.checked })} /></Stack>
                <FormControl fullWidth><InputLabel>Mode</InputLabel><Select label="Mode" value={device?.operationMode || "AUTO"} onChange={(e) => updateControl({ operationMode: e.target.value })}>{modeOptions.map((m) => <MenuItem key={m} value={m}>{modeLabels[m]}</MenuItem>)}</Select></FormControl>
                <Box><Typography>Temperature cible: {device?.targetTemp ?? "--"}°C</Typography><Slider value={device?.targetTemp ?? 21} min={16} max={31} step={0.5} onChangeCommitted={(_, v) => updateControl({ setTemperature: v })} /></Box>
                <FormControl fullWidth><InputLabel>Ventilation</InputLabel><Select label="Ventilation" value={device?.fanSpeed || "AUTO"} onChange={(e) => updateControl({ setFanSpeed: e.target.value })}>{fanOptions.map((m) => <MenuItem key={m} value={m}>{fanLabels[m]}</MenuItem>)}</Select></FormControl>
              </Stack>
            </CardContent></Card>
          </Grid>

          <Grid size={{ xs: 12, lg: 6 }} sx={{ display: "flex" }}>
            <Card sx={{ height: "100%", width: "100%" }}><CardContent sx={{ height: "100%" }}>
              <Typography variant="h6" gutterBottom>Meteo des Clots</Typography>
              <Tabs value={meteoTab} onChange={(_, v) => setMeteoTab(v)} sx={{ mb: 1 }}>
                {weatherTabs.map((t) => <Tab key={t.id} label={t.label} value={t.id} />)}
              </Tabs>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                <Button size="small" variant="outlined" onClick={() => weatherScrollRef.current?.scrollBy({ left: -340, behavior: "smooth" })}>←</Button>
                <Button size="small" variant="outlined" onClick={() => weatherScrollRef.current?.scrollBy({ left: 340, behavior: "smooth" })}>→</Button>
              </Stack>
              <Box ref={weatherScrollRef} sx={{ display: "flex", gap: 1, overflowX: "auto", scrollBehavior: "smooth", pb: 1 }}>
                {forecastRows.map((r) => (
                  <Card key={r.date} variant="outlined" sx={{ minWidth: 330, flex: "0 0 auto" }}>
                    <CardContent>
                      <Typography variant="subtitle2">{r.date}</Typography>
                      <Grid container spacing={1}>
                        <Grid size={{ xs: 6 }}>
                          <Typography variant="body2">🏘️ Sechilienne</Typography>
                          <Typography variant="body2">{r.sech?.weatherIcon} {r.sech?.weatherLabel}</Typography>
                          <Typography variant="body2">{r.sech?.tempMin}°C / {r.sech?.tempMax}°C</Typography>
                        </Grid>
                        <Grid size={{ xs: 6 }}>
                          <Typography variant="body2">🏔️ Chamrousse</Typography>
                          <Typography variant="body2">{r.cham?.weatherIcon} {r.cham?.weatherLabel}</Typography>
                          <Typography variant="body2">{r.cham?.tempMin}°C / {r.cham?.tempMax}°C</Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </CardContent></Card>
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
                    <LineChart data={tempData} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ts" type="number" domain={periodDomain} {...axis} tickFormatter={xScaleConfig.tickFormatter} tickCount={xScaleConfig.ticks} />
                      <YAxis domain={tempYDomain} {...axis} />
                      <Tooltip content={renderCleanTooltip(false)} />
                      <Legend />
                      <Line name="Temperature reelle PAC" type="monotone" dataKey="interieure" stroke="#2ed4bf" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line name="Consigne PAC" type="monotone" dataKey="consigne" stroke="#f59e0b" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line name="Exterieure Sechilienne" type="monotone" dataKey="sechilienne" stroke="#60a5fa" strokeWidth={lineWidth} dot={false} connectNulls />
                      <Line name="Exterieure Chamrousse" type="monotone" dataKey="chamrousse" stroke="#c084fc" strokeWidth={lineWidth} dot={false} connectNulls />
                    </LineChart>
                  ) : (
                    <LineChart data={wifiData} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="ts" type="number" domain={periodDomain} {...axis} tickFormatter={xScaleConfig.tickFormatter} tickCount={xScaleConfig.ticks} />
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
