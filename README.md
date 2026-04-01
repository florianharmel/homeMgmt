# Dashboard PAC Mitsubishi (MELCloud direct)

Application full-stack en 1 page pour piloter une PAC Mitsubishi via MELCloud Home, sans Homebridge.

## Fonctionnalités

- Authentification MELCloud par email/mot de passe.
- Contrôle de la PAC (power, mode, consigne, ventilation).
- Graphique des températures :
  - Température intérieure PAC
  - Température de consigne
  - Température extérieure Séchilienne
  - Température extérieure Chamrousse
- Graphique de connectivité (online/offline + RSSI).
- Rafraichissement automatique toutes les 30 secondes.

## Démarrage

```bash
npm install
npm run dev
```

- Frontend : `http://localhost:5173`
- API backend : `http://localhost:8787`

## Déploiement Vercel (Frontend) + API séparée

Le backend MELCloud ne doit pas être hébergé comme simple frontend statique.

1. Déployer l'API (`server/index.js`) sur un service Node (Render, Railway, Fly.io, VPS).
2. Sur Vercel, définir la variable d'environnement :
   - `VITE_API_BASE_URL=https://ton-backend.example.com`
3. Redéployer le frontend.

## Déploiement 100% Vercel

- Frontend et API serverless sont dans ce repo (`api/[...slug].js`).
- Définir dans Vercel :
  - `MELCLOUD_REFRESH_TOKEN=<ton refresh token>`
  - optionnel: `VITE_API_BASE_URL=/api` (par défaut déjà utilisé)
- En contexte Vercel, le champ refresh token est masqué dans l'UI.

## Notes techniques

- Le backend implémente un flux OAuth MELCloud Home inspiré du plugin `homebridge-melcloud-home`.
- Les températures extérieures sont récupérées via Open-Meteo.
- Le dashboard cible un seul device (première PAC détectée), comme demandé.
