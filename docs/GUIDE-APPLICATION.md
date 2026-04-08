# Guide de l’application « Clots de la Charmette »

Ce document décrit **ce que fait l’application**, **comment elle se connecte aux services externes**, **où sont stockées les données**, et **comment repartir sur une base propre** si tu veux refaire le projet avec d’autres contraintes.

---

## 1. Vue d’ensemble

L’application est un **dashboard web** en une page pour :

- **Piloter une pompe à chaleur Mitsubishi** via le cloud **MELCloud Home** (allumage, mode, consigne, ventilation).
- **Afficher la météo** (prévisions et historiques) pour des lieux configurés côté serveur (La Charmette, Chamrousse, etc.) via **Open-Meteo**.
- **Afficher des températures issues de capteurs SwitchBot** (API cloud officielle), avec des séries « promues » dans l’interface (intérieur / extérieur selon tes sondes renommées côté logique).
- **Tracer l’historique** des températures, connectivité PAC, précipitations, etc., avec rafraîchissement périodique.

**Découpage typique en production :**

| Couche | Rôle |
|--------|------|
| **Frontend** (ex. Vercel) | Interface React + MUI + Recharts. Build statique (`npm run build` → `dist/`). |
| **Backend** (ex. Railway, Render, VPS) | Serveur Node.js (`node server/index.js`) : API REST `/api/*`, sessions, appels MELCloud, Open-Meteo, SwitchBot. |
| **Fichiers sur le serveur API** | Persistance légère JSON (sessions MELCloud, historique des points). **Pas** sur Vercel. |

En **développement local**, `npm run dev` lance en parallèle le front (Vite) et l’API ; Vite **proxy** les requêtes `/api` vers le port de l’API (ex. 8787).

---

## 2. Stack technique

- **Frontend** : React, Material UI (MUI), Recharts, Vite.
- **Backend** : Node.js, Express, `fetch` / `https` pour les appels sortants.
- **Auth MELCloud** : flux OAuth « mobile » (inspiré de *homebridge-melcloud-home*) : échange email/mot de passe contre des jetons, refresh automatique.
- **Chargement des secrets locaux** : `dotenv` côté serveur pour lire un fichier `.env` en local (sur les plateformes, les variables sont injectées par l’hébergeur).

---

## 3. Connexion aux services externes

### 3.1 Mitsubishi MELCloud Home

**Rôle** : état de la PAC, commandes, tendances internes (températures, puissance, etc.).

**Hôtes utilisés (côté serveur)** :

- `https://auth.melcloudhome.com` — OAuth (authorize, token).
- `https://mobile.bff.melcloudhome.com` — API « mobile » (contexte, unité ATA, monitor, etc.).

**Comment le navigateur y accède** : **indirectement**. Le front appelle **ton** backend (`GET /api/device`, `POST /api/device/control`, etc.). C’est le serveur Node qui porte les jetons et parle à MELCloud.

**Persistance** : email + refresh token (et access token) dans `server/auth-store.json` pour ne pas redemander le mot de passe à chaque redémarrage (tant que le refresh est valide).

---

### 3.2 Open-Meteo

**Rôle** : températures extérieures pour les graphiques « météo », prévisions sur plusieurs jours, historiques sur fenêtres longues (forecast + archive selon la période).

**Hôtes** :

- `https://api.open-meteo.com` — prévisions / current.
- `https://archive-api.open-meteo.com` — données passées au-delà de la fenêtre autorisée par l’API forecast.

**Paramétrage** : coordonnées et modèles sont **codés dans le serveur** (ex. La Charmette, Chamrousse). Pour un nouveau projet, tu changerais ces URLs / lat-long dans `server/index.js` ou via une config externalisée.

**Cache** : le serveur met en cache une partie des réponses Open-Meteo pour limiter les appels (TTL d’environ une heure pour certaines données agrégées).

---

### 3.3 SwitchBot Cloud API

**Rôle** : liste des appareils, statuts (température, etc.) pour les capteurs compatibles.

**Hôte** :

- `https://api.switch-bot.com/v1.1/...` — endpoints documentés par SwitchBot (ex. `/devices`, `/devices/{id}/status`).

**Authentification** : en-têtes signés avec `SWITCHBOT_TOKEN` et `SWITCHBOT_SECRET` (HMAC + horodatage + nonce), **uniquement côté serveur**.

**Important** : l’API publique ne remplace pas l’app SwitchBot pour tout l’historique « cloud » interne à l’éditeur ; l’historique affiché dans **ce** dashboard repose sur ce que **ton serveur enregistre** dans `history-store.json` (et éventuellement des imports CSV que tu as fusionnés).

**Route exposée au front** : `GET /api/switchbot/live` (nécessite une session MELCloud valide dans l’app, comme les autres routes « métier »).

---

## 4. Fichiers de données côté serveur

| Fichier | Contenu |
|---------|---------|
| `server/auth-store.json` | Session MELCloud persistée (refresh token, etc.). **Ne pas commiter** en général (souvent dans `.gitignore`). |
| `server/history-store.json` | Points d’historique pour les graphiques (températures, SwitchBot, météo agrégée, etc.). Taille limitée côté logique (backup tronqué au-delà d’un plafond). |

**Sur Railway / Render** : sans **volume persistant**, ces fichiers peuvent être **perdus** au redéploiement. Pour de la vraie persistance, il faut un volume monté ou une base de données.

---

## 5. Variables d’environnement

### Frontend (build Vite — ex. Vercel)

| Variable | Rôle |
|----------|------|
| `VITE_API_BASE_URL` | URL publique du backend **sans** slash final (ex. `https://ton-api.railway.app`). Vide en local : le proxy Vite envoie `/api` vers l’API locale. |

### Backend (Railway, Render, local…)

| Variable | Rôle |
|----------|------|
| `PORT` | Port d’écoute (souvent fourni par la plateforme). |
| `CORS_ORIGIN` | Origines autorisées pour le navigateur, séparées par des virgules (ex. `https://ton-app.vercel.app,http://localhost:5173`). Vide = comportement permissif en dev. |
| `SWITCHBOT_TOKEN` | Jeton d’API SwitchBot. |
| `SWITCHBOT_SECRET` | Secret pour signer les requêtes SwitchBot. |

Voir aussi `.env.example` à la racine du repo.

---

## 6. API HTTP principale (résumé)

Toutes les routes sont préfixées par `/api` (souvent proxifiées par Vite en dev).

| Méthode | Route | Rôle |
|---------|-------|------|
| POST | `/api/auth/login` | Connexion MELCloud (email / mot de passe). |
| GET | `/api/session` | Session courante (connecté ou non). |
| GET | `/api/device` | État de la PAC (première unité détectée). |
| POST | `/api/device/control` | Commandes (power, mode, consigne, ventilation…). |
| GET | `/api/history` | Historique pour graphiques (période en query). |
| GET | `/api/pac/trend` | Tendance PAC (températures, etc.). |
| GET | `/api/pac/wifi-history` | Historique connectivité / RSSI. |
| GET | `/api/weather/forecast` | Prévisions météo. |
| GET | `/api/weather/history` | Historique météo pour les courbes. |
| GET | `/api/switchbot/live` | Cache live SwitchBot (capteurs + températures). |

Des routes `/api/debug/*` peuvent exister pour le diagnostic (raw device, endpoints, etc.).

---

## 7. Comportement du frontend (résumé)

- **Base API** : `VITE_API_BASE_URL` ou chemins relatifs `/api` en dev.
- **Rafraîchissement** : appels périodiques (ex. toutes les 30 s) + rechargement quand tu changes la période du graphique.
- **Suivi** : composition de données issues de l’historique serveur, tendances PAC, météo, séries SwitchBot ; lissage et type de courbe (ex. spline) côté affichage pour un rendu plus fluide.

---

## 8. Repartir sur une base propre (checklist)

Si tu veux **recommencer** avec d’autres lieux, d’autres devices ou une autre archi :

1. **Clarifier le périmètre** : une ou plusieurs PAC ? plusieurs sites météo ? quels capteurs SwitchBot « officiels » dans l’UI ?
2. **Externaliser la config** : lat/long Open-Meteo, IDs de devices MELCloud si tu ne veux plus « première PAC détectée », mapping des noms SwitchBot → rôles (intérieur / extérieur).
3. **Persistance** : décider entre fichier JSON + volume, ou **PostgreSQL** / autre sur Railway.
4. **Secrets** : jamais de jetons SwitchBot ou mots de passe dans le dépôt ; tout en variables d’environnement.
5. **CORS** : une ligne par origine front exacte (produit + preview Vercel si besoin).
6. **Documentation** : mettre à jour ce fichier et `.env.example` à chaque nouveau service.

---

## 9. Fichiers utiles dans le dépôt

| Fichier | Description |
|---------|-------------|
| `README.md` | Démarrage rapide et déploiement. |
| `.env.example` | Modèle de variables pour front et back. |
| `server/index.js` | Cœur de l’API et intégrations. |
| `src/App.jsx` | Interface (pilotage, météo, suivi). |
| `vite.config.js` | Proxy `/api` en développement. |

---

*Document généré pour faciliter la reprise ou le fork du projet. Mets-le à jour quand tu changes les flux ou les variables.*
