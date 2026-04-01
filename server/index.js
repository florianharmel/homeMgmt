import crypto from "node:crypto";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const state = {
  email: "",
  refreshToken: "",
  accessToken: "",
  expiresAt: 0,
  device: null,
  history: [],
  forecastCache: {
    updatedAt: 0,
    byHorizon: {},
  },
  rawDevice: null,
  sampleIntervalMs: 30 * 1000,
};

const CLIENT_AUTH = "Basic aG9tZW1vYmlsZTo=";
const MOBILE_UA =
  "MonitorAndControl.App.Mobile/35 CFNetwork/3860.100.1 Darwin/25.0.0";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, "history-store.json");
const AUTH_FILE = path.join(__dirname, "auth-store.json");
const MAX_BACKUP_POINTS = 20000;

function normalizePeriod(raw) {
  const p = String(raw || "3d").toLowerCase();
  if (["24h", "3d", "7d", "30d", "365d"].includes(p)) return p;
  return "3d";
}

function periodToMs(period) {
  if (period === "24h") return 24 * 60 * 60 * 1000;
  if (period === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (period === "30d") return 30 * 24 * 60 * 60 * 1000;
  if (period === "365d") return 365 * 24 * 60 * 60 * 1000;
  return 3 * 24 * 60 * 60 * 1000;
}

function loadBackupHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p?.ts === "number");
  } catch (_e) {
    return [];
  }
}

function saveBackupHistory(points) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(points.slice(-MAX_BACKUP_POINTS)));
  } catch (_e) {
    // Ignore storage errors, live mode still works.
  }
}

function loadAuthState() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (!raw?.refreshToken) return null;
    return {
      email: raw.email || "",
      refreshToken: raw.refreshToken,
      accessToken: raw.accessToken || "",
      expiresAt: Number(raw.expiresAt || 0),
    };
  } catch (_e) {
    return null;
  }
}

function saveAuthState() {
  try {
    fs.writeFileSync(
      AUTH_FILE,
      JSON.stringify({
        email: state.email,
        refreshToken: state.refreshToken,
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
      }),
    );
  } catch (_e) {
    // Ignore persistence errors.
  }
}

function pushHistory(point) {
  state.history.push(point);
  // Keep up to ~15 days with 5-minute sampling.
  if (state.history.length > 4320) state.history.shift();

  const backup = loadBackupHistory();
  backup.push(point);
  saveBackupHistory(backup);
}

function parseSettings(settings = []) {
  const out = {};
  for (const entry of settings) out[entry.name] = entry.value;
  return out;
}

function deepFindNumber(input, keys) {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found = null;
  function walk(value) {
    if (found !== null || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (wanted.has(key)) {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          found = n;
          return;
        }
      }
      walk(v);
      if (found !== null) return;
    }
  }
  walk(input);
  return found;
}

function deepFindBool(input, keys) {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found = null;
  function walk(value) {
    if (found !== null || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (wanted.has(key)) {
        if (typeof v === "boolean") found = v;
        else if (String(v).toLowerCase() === "true") found = true;
        else if (String(v).toLowerCase() === "false") found = false;
        if (found !== null) return;
      }
      walk(v);
      if (found !== null) return;
    }
  }
  walk(input);
  return found;
}

function deepFindString(input, keys) {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found = null;
  function walk(value) {
    if (found !== null || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (typeof value !== "object") return;
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (wanted.has(key) && (typeof v === "string" || typeof v === "number")) {
        found = String(v).toUpperCase();
        return;
      }
      walk(v);
      if (found !== null) return;
    }
  }
  walk(input);
  return found;
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
        res.on("end", () =>
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: data,
          }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getTokenFromRefreshToken() {
  if (!state.refreshToken) throw new Error("Aucun refresh token");
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.refreshToken,
  }).toString();
  const response = await httpsRequest(
    "https://auth.melcloudhome.com/connect/token",
    {
      method: "POST",
      headers: {
        Authorization: CLIENT_AUTH,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": String(Buffer.byteLength(form)),
        "User-Agent": MOBILE_UA,
      },
    },
    form,
  );
  if (response.status !== 200) {
    throw new Error(`Refresh token refusé (${response.status})`);
  }
  const parsed = JSON.parse(response.body);
  state.accessToken = parsed.access_token;
  state.refreshToken = parsed.refresh_token;
  state.expiresAt = Date.now() + parsed.expires_in * 1000;
  saveAuthState();
}

async function ensureAccessToken() {
  if (!state.accessToken || Date.now() > state.expiresAt - 60_000) {
    await getTokenFromRefreshToken();
  }
}

async function melcloudApi(path, method = "GET", payload) {
  await ensureAccessToken();
  const body = payload ? JSON.stringify(payload) : "";
  const response = await httpsRequest(
    `https://mobile.bff.melcloudhome.com${path}`,
    {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${state.accessToken}`,
        "User-Agent": MOBILE_UA,
        ...(payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(body)),
            }
          : {}),
      },
    },
    payload ? body : undefined,
  );
  if (response.status !== 200) {
    throw new Error(`Erreur MELCloud API ${response.status}`);
  }
  if (!response.body?.trim()) return null;
  return JSON.parse(response.body);
}

async function bearerApi(hostname, path, method = "GET") {
  await ensureAccessToken();
  const response = await httpsRequest(`https://${hostname}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${state.accessToken}`,
      "User-Agent": MOBILE_UA,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Erreur ${hostname} ${response.status}`);
  }
  if (!response.body?.trim()) return null;
  return JSON.parse(response.body);
}

async function curlLikeRequest(url, options = {}) {
  const cookieJar = options.cookies || [];

  function parseCookie(setCookieHeader, requestUrl) {
    const urlObj = new URL(requestUrl);
    const parts = setCookieHeader.split(";").map((p) => p.trim());
    const eqIndex = parts[0].indexOf("=");
    const name = parts[0].substring(0, eqIndex);
    const value = parts[0].substring(eqIndex + 1);

    const cookie = { name, value, domain: urlObj.hostname, path: "/", expires: null };

    for (let i = 1; i < parts.length; i += 1) {
      const [key, val] = parts[i].split("=").map((p) => p?.trim());
      if (key.toLowerCase() === "path") cookie.path = val || "/";
      if (key.toLowerCase() === "domain") cookie.domain = val;
      if (key.toLowerCase() === "expires") cookie.expires = new Date(val);
      if (key.toLowerCase() === "max-age") {
        const maxAge = parseInt(val, 10);
        cookie.expires = new Date(Date.now() + maxAge * 1000);
      }
    }
    return cookie;
  }

  function updateCookieJar(setCookieHeaders, requestUrl) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    headers.forEach((header) => {
      const cookie = parseCookie(header, requestUrl);
      if (cookie.expires && cookie.expires < new Date()) {
        const index = cookieJar.findIndex((c) => c.name === cookie.name && c.path === cookie.path);
        if (index !== -1) cookieJar.splice(index, 1);
        return;
      }

      const index = cookieJar.findIndex(
        (c) => c.name === cookie.name && c.path === cookie.path && c.domain === cookie.domain,
      );
      if (index !== -1) cookieJar[index] = cookie;
      else cookieJar.push(cookie);
    });
  }

  function getCookiesForUrl(targetUrl) {
    const urlObj = new URL(targetUrl);
    const now = new Date();
    const validCookies = cookieJar.filter((cookie) => {
      if (cookie.expires && cookie.expires < now) return false;
      if (!urlObj.hostname.endsWith(cookie.domain)) return false;
      if (!urlObj.pathname.startsWith(cookie.path)) return false;
      return true;
    });
    if (validCookies.length === 0) return null;
    return validCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 10;
    let redirectCount = 0;
    let currentUrl = url;
    let previousUrl = null;
    let keepCognitoReferer = false;

    async function makeRequest() {
      const urlObj = new URL(currentUrl);
      const method = redirectCount > 0 ? "GET" : options.method || "GET";

      let refererUrl = previousUrl;
      if (refererUrl?.includes("amazoncognito.com")) {
        const refererUrlObj = new URL(refererUrl);
        refererUrl = `${refererUrlObj.origin}/`;
      }

      const effectivePreviousUrl = keepCognitoReferer && previousUrl ? previousUrl : previousUrl || currentUrl;
      const isCrossSite =
        previousUrl && redirectCount > 0 && new URL(effectivePreviousUrl).hostname !== urlObj.hostname;

      const headers =
        redirectCount > 0
          ? {
              "User-Agent": options.headers?.["User-Agent"] || "Mozilla/5.0",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Sec-Fetch-Site": isCrossSite ? "cross-site" : "same-origin",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Dest": "document",
              Priority: "u=0, i",
              ...(refererUrl && { Referer: refererUrl }),
            }
          : { ...options.headers };

      const requestOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
      };

      const cookieHeader = getCookiesForUrl(currentUrl);
      if (cookieHeader) requestOptions.headers.Cookie = cookieHeader;

      const req = https.request(requestOptions, (res) => {
        updateCookieJar(res.headers["set-cookie"], currentUrl);
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (options.followRedirects !== false && [301, 302, 303].includes(res.statusCode)) {
            if (redirectCount >= MAX_REDIRECTS) {
              reject(new Error("Too many redirects"));
              return;
            }
            const location = res.headers.location;
            if (location?.startsWith("melcloudhome://")) {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                html: data,
                cookies: cookieJar,
                finalUrl: location,
              });
              return;
            }

            if (location === "/ExternalLogin/Callback") {
              keepCognitoReferer = true;
            } else {
              previousUrl = currentUrl;
              keepCognitoReferer = false;
            }

            currentUrl = location.startsWith("http") ? location : `https://${urlObj.hostname}${location}`;
            redirectCount += 1;
            makeRequest();
            return;
          }

          const metaRefreshMatch = data.match(/content="0;url=([^"]+)"/);
          if (metaRefreshMatch) {
            const redirectUrl = metaRefreshMatch[1].replace(/&amp;/g, "&");
            const metaReq = https.request(
              {
                hostname: "auth.melcloudhome.com",
                path: redirectUrl,
                method: "GET",
                headers: {
                  Host: "auth.melcloudhome.com",
                  "User-Agent": options.headers?.["User-Agent"] || "Mozilla/5.0",
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                  Referer: "https://auth.melcloudhome.com/Redirect",
                  Connection: "keep-alive",
                  "Upgrade-Insecure-Requests": "1",
                  "Sec-Fetch-Site": "same-origin",
                  "Sec-Fetch-Mode": "navigate",
                  "Sec-Fetch-Dest": "document",
                  Priority: "u=0, i",
                  Cookie: getCookiesForUrl(`https://auth.melcloudhome.com${redirectUrl}`),
                },
              },
              (metaRes) => {
                if (
                  metaRes.statusCode === 302 &&
                  metaRes.headers.location &&
                  metaRes.headers.location.startsWith("melcloudhome://")
                ) {
                  resolve({
                    statusCode: metaRes.statusCode,
                    headers: metaRes.headers,
                    html: "",
                    cookies: cookieJar,
                    finalUrl: metaRes.headers.location,
                  });
                  return;
                }
                let metaData = "";
                metaRes.on("data", (chunk) => (metaData += chunk));
                metaRes.on("end", () =>
                  resolve({
                    statusCode: metaRes.statusCode,
                    headers: metaRes.headers,
                    html: metaData,
                    cookies: cookieJar,
                    finalUrl: currentUrl,
                  }),
                );
              },
            );
            metaReq.on("error", reject);
            metaReq.end();
            return;
          }

          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            html: data,
            cookies: cookieJar,
            finalUrl: currentUrl,
          });
        });
      });

      req.on("error", reject);
      if (options.body && redirectCount === 0) req.write(options.body);
      req.end();
    }
    makeRequest();
  });
}

async function loginWithCredentials(email, password) {
  const CLIENT_ID = "homemobile";
  const REDIRECT_URI = "melcloudhome://";
  const SCOPE = "openid profile email offline_access IdentityServerApi";
  const codeVerifier = crypto
    .randomBytes(32)
    .toString("base64url")
    .replace(/=/g, "");
  const challenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const oauthState = crypto.randomBytes(32).toString("hex");
  const authUrl =
    "https://auth.melcloudhome.com/connect/authorize" +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    "&response_type=code" +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${challenge}` +
    "&code_challenge_method=S256" +
    `&state=${oauthState}`;

  const mobileSafariUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
  const loginPage = await curlLikeRequest(authUrl, {
    method: "GET",
    headers: {
      "User-Agent": mobileSafariUa,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cookies: [],
  });

  let loginActionUrl = loginPage.finalUrl;
  let loginFormParams = new URLSearchParams();
  const csrfMatch = loginPage.html.match(/name="_csrf"\s+value="([^"]+)"/);

  if (csrfMatch) {
    loginFormParams.set("_csrf", csrfMatch[1]);
    loginFormParams.set("username", email);
    loginFormParams.set("password", password);
  } else {
    // Nouveau flux Cognito: formulaire sans _csrf, avec champs cachés dynamiques.
    const formAction = loginPage.html.match(/<form[^>]*action="([^"]+)"/i)?.[1];
    if (!formAction) throw new Error("Formulaire MELCloud introuvable");
    loginActionUrl = formAction.startsWith("http")
      ? formAction
      : new URL(formAction, loginPage.finalUrl).toString();

    const hiddenInputRegex = /<input[^>]*type="hidden"[^>]*>/gi;
    const hiddenFields = loginPage.html.match(hiddenInputRegex) || [];
    for (const input of hiddenFields) {
      const name = input.match(/name="([^"]+)"/i)?.[1];
      const value = input.match(/value="([^"]*)"/i)?.[1] ?? "";
      if (name) loginFormParams.set(name, value);
    }
    loginFormParams.set("username", email);
    loginFormParams.set("password", password);
  }

  const loginBody = loginFormParams.toString();
  const callback = await curlLikeRequest(loginActionUrl, {
    method: "POST",
    headers: {
      "User-Agent": mobileSafariUa,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(loginBody)),
      Origin: new URL(loginActionUrl).origin,
      Referer: loginPage.finalUrl,
    },
    body: loginBody,
    cookies: loginPage.cookies,
  });

  if (!callback.finalUrl || !callback.finalUrl.startsWith("melcloudhome://")) {
    throw new Error("Login MELCloud échoué (redirection app absente)");
  }

  const url = new URL(callback.finalUrl);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || returnedState !== oauthState) {
    throw new Error("Réponse OAuth invalide");
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  }).toString();

  const token = await curlLikeRequest("https://auth.melcloudhome.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: CLIENT_AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenBody,
    followRedirects: false,
  });
  if (token.statusCode !== 200) throw new Error("Échec exchange token MELCloud");
  const parsed = JSON.parse(token.html);
  state.email = email;
  state.refreshToken = parsed.refresh_token;
  state.accessToken = parsed.access_token;
  state.expiresAt = Date.now() + parsed.expires_in * 1000;
  saveAuthState();
}

async function refreshDevice() {
  const context = await melcloudApi("/context");
  const units = (context?.buildings || []).flatMap((b) => b.airToAirUnits || []);
  if (!units.length) throw new Error("Aucune PAC trouvée");
  const unit = units[0];
  const settings = parseSettings(unit.settings || []);
  let monitor = null;
  try {
    monitor = await melcloudApi(`/monitor/ataunit/${encodeURIComponent(unit.id)}`);
  } catch (_e) {
    // Fallback to context/settings when monitor endpoint is unavailable.
  }

  const merged = { unit, settings, monitor };
  state.rawDevice = { unit, settings, monitor };
  const indoorTemp =
    deepFindNumber(merged, [
      "roomtemperature",
      "indoortemperature",
      "currenttemperature",
      "actualtemperature",
      "returnairtemperature",
    ]) ?? 0;
  const targetTemp =
    deepFindNumber(merged, ["settemperature", "targettemperature", "desiredtemperature"]) ?? 21;
  const power = deepFindBool(merged, ["power", "ispoweron", "ison"]) ?? false;
  const operationMode = deepFindString(merged, ["operationmode", "mode"]) ?? "AUTO";
  let fanSpeed = deepFindString(merged, ["fanspeed", "setfanspeed"]) ?? "AUTO";
  if (fanSpeed === "0") fanSpeed = "AUTO";

  state.device = {
    id: unit.id,
    name: unit.givenDisplayName || "PAC Mitsubishi",
    isConnected: !!unit.isConnected,
    rssi: unit.rssi,
    indoorTemp,
    targetTemp,
    power,
    operationMode,
    fanSpeed,
  };

  let weather = { sechilienneTemp: null, chamrousseTemp: null };
  try {
    weather = await fetchWeatherCurrent();
  } catch (_e) {
    // Do not block PAC live sampling if weather API is temporarily unavailable.
  }
  const now = Date.now();
  const lastPoint = state.history[state.history.length - 1];
  // Sample history on a fixed interval so long-term curves are available.
  if (!lastPoint || now - lastPoint.ts >= state.sampleIntervalMs) {
    pushHistory({
      ts: now,
      indoorTemp: state.device.indoorTemp,
      targetTemp: state.device.targetTemp,
      sechilienneTemp: weather.sechilienneTemp,
      chamrousseTemp: weather.chamrousseTemp,
      isConnected: state.device.isConnected,
      rssi: state.device.rssi,
      source: "device-live",
    });
  }
}

async function fetchWeatherCurrent() {
  const s = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=45.1314&longitude=5.8352&current=temperature_2m&models=meteofrance_seamless",
  ).then((r) => r.json());
  const c = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=45.1267&longitude=5.8747&current=temperature_2m&models=meteofrance_seamless",
  ).then((r) => r.json());
  const sNow = s?.current?.temperature_2m;
  const cNow = c?.current?.temperature_2m;
  return {
    sechilienneTemp: Number.isFinite(Number(sNow)) ? Number(sNow) : null,
    chamrousseTemp: Number.isFinite(Number(cNow)) ? Number(cNow) : null,
  };
}

function getWeatherLabel(weatherCode) {
  if ([0].includes(weatherCode)) return { label: "Soleil", icon: "☀️" };
  if ([1, 2].includes(weatherCode)) return { label: "Peu nuageux", icon: "⛅" };
  if ([3].includes(weatherCode)) return { label: "Nuageux", icon: "☁️" };
  if ([45, 48].includes(weatherCode)) return { label: "Brouillard", icon: "🌫️" };
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) return { label: "Pluie", icon: "🌧️" };
  if ([56, 57, 66, 67].includes(weatherCode)) return { label: "Pluie verglaçante", icon: "🌧️" };
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return { label: "Neige", icon: "❄️" };
  if ([95, 96, 99].includes(weatherCode)) return { label: "Orage", icon: "⛈️" };
  return { label: "Variable", icon: "🌤️" };
}

async function fetchForecastFor(latitude, longitude, days) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&forecast_days=${days}` +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weather_code" +
    "&models=meteofrance_seamless";
  const data = await fetch(url).then((r) => r.json());
  const timeline = data?.daily?.time || [];
  return timeline.map((day, idx) => {
    const weatherCode = data.daily.weather_code?.[idx];
    const visual = getWeatherLabel(weatherCode);
    return {
      date: day,
      tempMin: data.daily.temperature_2m_min?.[idx] ?? null,
      tempMax: data.daily.temperature_2m_max?.[idx] ?? null,
      precipitationMm: data.daily.precipitation_sum?.[idx] ?? 0,
      snowfallCm: data.daily.snowfall_sum?.[idx] ?? 0,
      weatherCode,
      weatherLabel: visual.label,
      weatherIcon: visual.icon,
    };
  });
}

async function fetchForecast(horizonDays) {
  const now = Date.now();
  const cached = state.forecastCache.byHorizon[horizonDays];
  if (cached && now - cached.updatedAt < 15 * 60 * 1000) {
    return cached.data;
  }

  const [sechilienne, chamrousse] = await Promise.all([
    fetchForecastFor(45.1314, 5.8352, horizonDays),
    fetchForecastFor(45.1267, 5.8747, horizonDays),
  ]);
  const data = { horizonDays, sechilienne, chamrousse };
  state.forecastCache.byHorizon[horizonDays] = { updatedAt: now, data };
  return data;
}

async function fetchWeatherHistory(period) {
  const now = new Date();
  const rangeMs = periodToMs(period);
  const start = new Date(now.getTime() - rangeMs);
  const pastDays = Math.max(1, Math.ceil(rangeMs / (24 * 60 * 60 * 1000)));

  async function onePlace(latitude, longitude) {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&past_days=${pastDays}&forecast_days=1` +
      "&hourly=temperature_2m,precipitation,snowfall,weather_code" +
      "&models=meteofrance_seamless";
    const data = await fetch(url).then((r) => r.json());
    const times = data?.hourly?.time || [];
    return times.map((t, idx) => ({
      ts: new Date(t).getTime(),
      temp: data?.hourly?.temperature_2m?.[idx] ?? null,
      precipitation: data?.hourly?.precipitation?.[idx] ?? 0,
      snowfall: data?.hourly?.snowfall?.[idx] ?? 0,
      weatherCode: data?.hourly?.weather_code?.[idx] ?? null,
    }));
  }

  const [s, c] = await Promise.all([onePlace(45.1314, 5.8352), onePlace(45.1267, 5.8747)]);
  const byTs = new Map();
  for (const p of s) {
    if (p.ts < start.getTime()) continue;
    byTs.set(p.ts, {
      ts: p.ts,
      sechilienneTemp: p.temp,
      sechiliennePrecipitation: p.precipitation,
      sechilienneSnowfall: p.snowfall,
      sechilienneCode: p.weatherCode,
    });
  }
  for (const p of c) {
    if (p.ts < start.getTime()) continue;
    const cur = byTs.get(p.ts) || { ts: p.ts };
    byTs.set(p.ts, {
      ...cur,
      chamrousseTemp: p.temp,
      chamroussePrecipitation: p.precipitation,
      chamrousseSnowfall: p.snowfall,
      chamrousseCode: p.weatherCode,
    });
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

function formatMelcloudDate(date) {
  // MELCloud accepts ISO-like timestamps without timezone suffix.
  return date.toISOString().replace("Z", "0000");
}

function findDatasetByLabel(datasets, keys) {
  const upperKeys = keys.map((k) => k.toUpperCase());
  return datasets.find((d) => {
    const label = String(d?.label || "").toUpperCase();
    return upperKeys.some((k) => label.includes(k));
  });
}

async function fetchPacTrendSummary(unitId, period) {
  const now = new Date();
  const rangeMs = periodToMs(period);
  const from = new Date(now.getTime() - rangeMs);
  const summaryPeriod =
    period === "365d" ? "Yearly" : period === "30d" ? "Monthly" : period === "7d" ? "Weekly" : "Daily";
  const query =
    `/report/trendsummary?unitId=${encodeURIComponent(unitId)}` +
    `&period=${summaryPeriod}` +
    `&from=${encodeURIComponent(formatMelcloudDate(from))}` +
    `&to=${encodeURIComponent(formatMelcloudDate(now))}`;

  const trend = await melcloudApi(query, "GET");
  const datasets = Array.isArray(trend?.datasets) ? trend.datasets : [];
  const roomDs = findDatasetByLabel(datasets, [
    "ROOM_TEMPERATURE",
    "TEMPERATURE_ROOM",
    "INDOOR_TEMPERATURE",
  ]);
  const setDs = findDatasetByLabel(datasets, [
    "SET_TEMPERATURE",
    "TARGET_TEMPERATURE",
    "TEMPERATURE_SET",
  ]);

  const pointsMap = new Map();
  for (const p of roomDs?.data || []) {
    const ts = new Date(p.x).getTime();
    if (Number.isNaN(ts)) continue;
    pointsMap.set(ts, {
      ts,
      indoorTemp: typeof p.y === "number" ? p.y : Number(p.y),
    });
  }
  for (const p of setDs?.data || []) {
    const ts = new Date(p.x).getTime();
    if (Number.isNaN(ts)) continue;
    const current = pointsMap.get(ts) || { ts };
    pointsMap.set(ts, {
      ...current,
      targetTemp: typeof p.y === "number" ? p.y : Number(p.y),
    });
  }

  return Array.from(pointsMap.values())
    .filter((p) => Number.isFinite(p.indoorTemp) || Number.isFinite(p.targetTemp))
    .sort((a, b) => a.ts - b.ts);
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function toMelLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

async function fetchWifiHistory(unitId, period) {
  const now = new Date();
  const rangeMs = periodToMs(period);
  const from = new Date(now.getTime() - rangeMs);

  const query =
    `?from=${encodeURIComponent(toMelLocalDate(from))}` +
    `&to=${encodeURIComponent(toMelLocalDate(now))}` +
    "&measure=rssi";

  const candidates = [
    async () =>
      bearerApi(
        "mobile.bff.melcloudhome.com",
        `/telemetry/actual/${encodeURIComponent(unitId)}${query}`,
      ),
    async () =>
      bearerApi(
        "melcloudhome.com",
        `/api/telemetry/actual/${encodeURIComponent(unitId)}${query}`,
      ),
  ];

  let raw = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      raw = await candidate();
      if (raw) break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!raw) {
    // Fallback: local sampled history if endpoint unavailable.
    const nowTs = Date.now();
    return loadBackupHistory()
      .filter((p) => nowTs - p.ts <= rangeMs)
      .map((p) => ({ ts: p.ts, rssi: p.rssi ?? null, connectivite: p.isConnected ? 100 : 0, source: "local" }));
  }

  const series = Array.isArray(raw) ? raw : raw?.data || raw?.measurements || [];
  const points = [];
  for (const item of series) {
    const tsRaw = item.ts ?? item.timestamp ?? item.time ?? item.x;
    const valueRaw = item.value ?? item.rssi ?? item.y;
    const ts = new Date(tsRaw).getTime();
    const rssi = Number(valueRaw);
    if (Number.isNaN(ts) || Number.isNaN(rssi)) continue;
    points.push({
      ts,
      rssi,
      connectivite: 100,
      source: "melcloud-telemetry",
    });
  }
  points.sort((a, b) => a.ts - b.ts);
  if (points.length === 0 && lastError) throw lastError;
  return points;
}

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new Error("Email/mot de passe obligatoires");
    await loginWithCredentials(email, password);
    await refreshDevice();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: !!state.refreshToken, email: state.email || null });
});

app.get("/api/device", async (req, res) => {
  try {
    if (!state.refreshToken) return res.json(null);
    await refreshDevice();
    res.json(state.device);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/debug/raw-device", async (req, res) => {
  try {
    if (state.refreshToken) await refreshDevice();
    res.json(state.rawDevice || null);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/debug/probe-history-endpoints", async (req, res) => {
  try {
    if (!state.refreshToken) throw new Error("Non authentifié");
    const deviceId = state.device?.id;
    if (!deviceId) await refreshDevice();
    const id = state.device?.id;
    const candidates = [
      `/monitor/ataunit/${encodeURIComponent(id)}/history`,
      `/monitor/ataunit/${encodeURIComponent(id)}/timeline`,
      `/monitor/ataunit/${encodeURIComponent(id)}/report`,
      `/monitor/ataunit/${encodeURIComponent(id)}/measurements`,
      `/monitor/ataunit/${encodeURIComponent(id)}/temperatures`,
      "/history",
      "/reports",
      "/telemetry",
      "/timeseries",
      "/monitor/history",
    ];

    const out = [];
    for (const path of candidates) {
      try {
        const data = await melcloudApi(path, "GET");
        out.push({ path, ok: true, preview: JSON.stringify(data).slice(0, 200) });
      } catch (e) {
        out.push({ path, ok: false, error: e.message });
      }
    }
    res.json({ deviceId: id, results: out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/device/control", async (req, res) => {
  try {
    if (!state.device?.id) throw new Error("Aucun device sélectionné");
    const body = req.body;
    await melcloudApi(`/monitor/ataunit/${encodeURIComponent(state.device.id)}`, "PUT", body);
    await refreshDevice();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    if (state.refreshToken) await refreshDevice();
    const period = normalizePeriod(req.query.period);
    const now = Date.now();
    const rangeMs = periodToMs(period);
    const livePoints = state.history.filter((p) => now - p.ts <= rangeMs);
    const backupPoints = loadBackupHistory().filter((p) => now - p.ts <= rangeMs);
    const mergedByTs = new Map();

    // Priority to live points (current source of truth).
    for (const p of backupPoints) mergedByTs.set(p.ts, p);
    for (const p of livePoints) mergedByTs.set(p.ts, p);

    const points = Array.from(mergedByTs.values()).sort((a, b) => a.ts - b.ts);
    res.json({ points, meta: { liveCount: livePoints.length, backupCount: backupPoints.length } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/pac/trend", async (req, res) => {
  try {
    if (!state.refreshToken) throw new Error("Non authentifié");
    if (!state.device?.id) await refreshDevice();
    const safePeriod = normalizePeriod(req.query.period);
    const points = await fetchPacTrendSummary(state.device.id, safePeriod);
    res.json({ points });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/pac/wifi-history", async (req, res) => {
  try {
    if (!state.refreshToken) throw new Error("Non authentifié");
    if (!state.device?.id) await refreshDevice();
    const safePeriod = normalizePeriod(req.query.period);
    const points = await fetchWifiHistory(state.device.id, safePeriod);
    res.json({ points });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/weather/forecast", async (req, res) => {
  try {
    const horizon = Number(req.query.horizon || 1);
    const safeHorizon = [1, 3, 15].includes(horizon) ? horizon : 1;
    const data = await fetchForecast(safeHorizon);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/weather/history", async (req, res) => {
  try {
    const safePeriod = normalizePeriod(req.query.period);
    const points = await fetchWeatherHistory(safePeriod);
    res.json({ points });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

setInterval(async () => {
  try {
    if (state.refreshToken) await refreshDevice();
  } catch (_e) {
    // Background refresh best effort.
  }
}, 30000);

app.post("/api/debug/sample-rate", (req, res) => {
  const seconds = Number(req.body?.seconds);
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 3600) {
    return res.status(400).json({ error: "seconds doit être entre 10 et 3600" });
  }
  state.sampleIntervalMs = seconds * 1000;
  return res.json({ ok: true, sampleIntervalSeconds: seconds });
});

const savedAuth = loadAuthState();
if (savedAuth) {
  state.email = savedAuth.email;
  state.refreshToken = savedAuth.refreshToken;
  state.accessToken = savedAuth.accessToken;
  state.expiresAt = savedAuth.expiresAt;
}

app.listen(8787, () => {
  // eslint-disable-next-line no-console
  console.log("API MELCloud lancée sur http://localhost:8787");
});
