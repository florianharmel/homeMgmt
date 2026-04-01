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

## Déploiement (frontend Vercel + API sur Render / Railway / etc.)

1. **Backend Node** : déployer le dossier racine (ou uniquement `server/`) sur une plateforme qui lance un process long (`npm start` → `node server/index.js`). Définir :
   - `PORT` (souvent fourni automatiquement par l’hébergeur).
   - `CORS_ORIGIN` : l’URL exacte de ton site Vercel + éventuellement `http://localhost:5173` pour les tests, par exemple :
     `https://clots-xxx.vercel.app,http://localhost:5173`
2. **Frontend Vercel** : connecter le repo, framework **Vite**, build `npm run build`, sortie `dist`.
3. **Variables Vercel (build)** : `VITE_API_BASE_URL` = URL publique du backend **sans** slash final, par ex. `https://melcloud-api-xxxx.up.railway.app`.  
   Redéployer après chaque changement de cette variable (elle est injectée au build).
4. Copier `.env.example` vers `.env.local` en local si tu veux tester le front contre une API distante.

Les fichiers `server/auth-store.json` et `server/history-store.json` restent sur le disque du serveur **API** (pas sur Vercel).

## Notes techniques

- Le backend implémente un flux OAuth MELCloud Home inspiré du plugin `homebridge-melcloud-home`.
- Les températures extérieures sont récupérées via Open-Meteo.
- Le dashboard cible un seul device (première PAC détectée), comme demandé.
