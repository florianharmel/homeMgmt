import crypto from "node:crypto";
import https from "node:https";
import express from "express";
import serverless from "serverless-http";
import { kv } from "@vercel/kv";

const app = express();
app.use(express.json());

const CLIENT_AUTH = "Basic aG9tZW1vYmlsZTo=";
const MOBILE_UA = "MonitorAndControl.App.Mobile/35 CFNetwork/3860.100.1 Darwin/25.0.0";
const STORE_KEY = "clots:state:v1";
const HISTORY_KEY = "clots:history:v1";

const mem = {
  state: {
    email: "",
    refreshToken: "",
    accessToken: "",
    expiresAt: 0,
    device: null,
  },
  history: [],
};

async function storeGet(key, fallback) {
  try {
    const val = await kv.get(key);
    return val ?? fallback;
  } catch {
    return mem[key === STORE_KEY ? "state" : "history"] ?? fallback;
  }
}

async function storeSet(key, value) {
  try {
    await kv.set(key, value);
  } catch {
    if (key === STORE_KEY) mem.state = value;
    if (key === HISTORY_KEY) mem.history = value;
  }
}

function httpsRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 500, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withState() {
  const state = await storeGet(STORE_KEY, mem.state);
  const history = await storeGet(HISTORY_KEY, mem.history);
  return { state, history: Array.isArray(history) ? history : [] };
}

async function saveState(state) {
  await storeSet(STORE_KEY, state);
}

async function saveHistory(history) {
  await storeSet(HISTORY_KEY, history.slice(-50000));
}

async function refreshAccessToken(state) {
  if (!state.refreshToken) throw new Error("Non authentifié");
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: state.refreshToken }).toString();
  const response = await httpsRequest("https://auth.melcloudhome.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: CLIENT_AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(form)),
      "User-Agent": MOBILE_UA,
    },
  }, form);
  if (response.status !== 200) throw new Error(`Refresh token refusé (${response.status})`);
  const parsed = JSON.parse(response.body);
  state.accessToken = parsed.access_token;
  state.refreshToken = parsed.refresh_token;
  state.expiresAt = Date.now() + parsed.expires_in * 1000;
  await saveState(state);
}

async function ensureToken(state) {
  if (!state.accessToken || Date.now() > state.expiresAt - 60_000) {
    await refreshAccessToken(state);
  }
}

async function melcloudApi(state, path, method = "GET", payload) {
  await ensureToken(state);
  const body = payload ? JSON.stringify(payload) : "";
  const response = await httpsRequest(`https://mobile.bff.melcloudhome.com${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${state.accessToken}`,
      "User-Agent": MOBILE_UA,
      ...(payload ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : {}),
    },
  }, payload ? body : undefined);
  if (response.status !== 200) throw new Error(`Erreur MELCloud API ${response.status}`);
  return response.body?.trim() ? JSON.parse(response.body) : null;
}

function parseSettings(settings = []) {
  const out = {};
  for (const s of settings) out[s.name] = s.value;
  return out;
}

async function refreshDeviceAndHistory(state, history) {
  const context = await melcloudApi(state, "/context");
  const units = (context?.buildings || []).flatMap((b) => b.airToAirUnits || []);
  if (!units.length) throw new Error("Aucune PAC trouvée");
  const unit = units[0];
  const settings = parseSettings(unit.settings || []);
  state.device = {
    id: unit.id,
    name: unit.givenDisplayName || "PAC",
    isConnected: !!unit.isConnected,
    rssi: unit.rssi,
    indoorTemp: Number(settings.RoomTemperature ?? 0),
    targetTemp: Number(settings.SetTemperature ?? 21),
    power: String(settings.Power ?? "false").toLowerCase() === "true",
    operationMode: String(settings.OperationMode ?? "AUTO").toUpperCase(),
    fanSpeed: String(settings.SetFanSpeed ?? "AUTO").toUpperCase() === "0" ? "AUTO" : String(settings.SetFanSpeed ?? "AUTO").toUpperCase(),
  };
  const now = Date.now();
  const last = history[history.length - 1];
  if (!last || now - last.ts >= 30_000) {
    history.push({
      ts: now,
      indoorTemp: state.device.indoorTemp,
      targetTemp: state.device.targetTemp,
      isConnected: state.device.isConnected,
      rssi: state.device.rssi,
    });
  }
  await saveState(state);
  await saveHistory(history);
}

function normalizePeriod(raw) {
  const p = String(raw || "3d").toLowerCase();
  return ["24h", "3d", "7d", "30d", "365d"].includes(p) ? p : "3d";
}

function periodMs(p) {
  if (p === "24h") return 24 * 3600e3;
  if (p === "7d") return 7 * 24 * 3600e3;
  if (p === "30d") return 30 * 24 * 3600e3;
  if (p === "365d") return 365 * 24 * 3600e3;
  return 3 * 24 * 3600e3;
}

app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  next();
});

app.post("/auth/login", async (req, res) => {
  try {
    const { refreshToken, email } = req.body || {};
    const envRefreshToken = process.env.MELCLOUD_REFRESH_TOKEN;
    const { state } = await withState();
    state.email = email || state.email;
    if (refreshToken) state.refreshToken = refreshToken;
    if (!state.refreshToken && envRefreshToken) state.refreshToken = envRefreshToken;
    if (!state.refreshToken) throw new Error("Aucun refresh token disponible (champ ou env MELCLOUD_REFRESH_TOKEN)");
    state.accessToken = "";
    state.expiresAt = 0;
    await refreshAccessToken(state);
    const { history } = await withState();
    await refreshDeviceAndHistory(state, history);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/session", async (_req, res) => {
  const { state } = await withState();
  res.json({ authenticated: !!state.refreshToken, email: state.email || null });
});

app.get("/device", async (_req, res) => {
  try {
    const { state, history } = await withState();
    if (!state.refreshToken) return res.json(null);
    await refreshDeviceAndHistory(state, history);
    res.json(state.device);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/device/control", async (req, res) => {
  try {
    const { state, history } = await withState();
    if (!state.device?.id) throw new Error("Aucun device");
    await melcloudApi(state, `/monitor/ataunit/${encodeURIComponent(state.device.id)}`, "PUT", req.body);
    await refreshDeviceAndHistory(state, history);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/history", async (req, res) => {
  const { history } = await withState();
  const p = normalizePeriod(req.query.period);
  const now = Date.now();
  res.json({ points: history.filter((x) => now - x.ts <= periodMs(p)) });
});

// Keep compatibility endpoints used by frontend.
app.get("/pac/trend", async (req, res) => {
  const { history } = await withState();
  const p = normalizePeriod(req.query.period);
  const now = Date.now();
  res.json({ points: history.filter((x) => now - x.ts <= periodMs(p)).map((x) => ({ ts: x.ts, indoorTemp: x.indoorTemp, targetTemp: x.targetTemp })) });
});

app.get("/pac/wifi-history", async (req, res) => {
  const { history } = await withState();
  const p = normalizePeriod(req.query.period);
  const now = Date.now();
  res.json({ points: history.filter((x) => now - x.ts <= periodMs(p)).map((x) => ({ ts: x.ts, connectivite: x.isConnected ? 100 : 0, rssi: x.rssi })) });
});

app.get("/weather/history", async (_req, res) => res.json({ points: [] }));
app.get("/weather/forecast", async (_req, res) => res.json({ horizonDays: 15, sechilienne: [], chamrousse: [] }));

export default serverless(app);
