# Dashboard PAC Mitsubishi (MELCloud direct)

Application full-stack en 1 page pour piloter une PAC Mitsubishi via MELCloud Home, sans Homebridge.

Pour une **vue d’ensemble détaillée** (services, API, variables d’environnement, persistance, checklist pour repartir sur une base propre), voir **[docs/GUIDE-APPLICATION.md](docs/GUIDE-APPLICATION.md)**.

## Fonctionnalités

- Authentification MELCloud par email/mot de passe.
- Contrôle de la PAC (power, mode, consigne, ventilation).
- Graphique des températures :
  - Température intérieure (capteur SwitchBot "Étagère salon" si disponible, sinon PAC)
  - Température de consigne
  - Température extérieure (capteur SwitchBot "Extérieur")
  - Température extérieure Séchilienne
  - Température extérieure Chamrousse
  - Sondes supplémentaires SwitchBot (clic sur la légende pour afficher/masquer)
- Graphique de connectivité (online/offline + RSSI).
- Rafraichissement automatique toutes les 30 secondes.

## Nouveautés récentes (UI/UX)

- **Intégration SwitchBot côté serveur** via `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET` (variables d'environnement uniquement).
- **Fallback robuste** : timeouts API (frontend et backend) pour éviter les chargements bloqués.
- **Légende de suivi revue** :
  - section gauche `Météo`
  - section droite `Sondes` (sans mention PAC), incluant les séries SwitchBot.
- **Séries promues** :
  - `Température intérieure` = sonde `Étagère salon`
  - `Extérieure` = sonde `Extérieur`
- **Graphes de suivi améliorés** :
  - extension des séries aux bornes de période (utilisation visuelle de toute la largeur),
  - découpage temporel plus stable sur 24h / 3 jours / 7 jours,
  - animations plus douces, grille plus discrète, points actifs au survol.

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
   - `SWITCHBOT_TOKEN` et `SWITCHBOT_SECRET` (si utilisation des sondes SwitchBot).
2. **Frontend Vercel** : connecter le repo, framework **Vite**, build `npm run build`, sortie `dist`.
3. **Variables Vercel (build)** : `VITE_API_BASE_URL` = URL publique du backend **sans** slash final, par ex. `https://melcloud-api-xxxx.up.railway.app`.  
   Redéployer après chaque changement de cette variable (elle est injectée au build).
4. Copier `.env.example` vers `.env.local` en local si tu veux tester le front contre une API distante.

Les fichiers `server/auth-store.json` et `server/history-store.json` restent sur le disque du serveur **API** (pas sur Vercel).

## Notes techniques

- Le backend implémente un flux OAuth MELCloud Home inspiré du plugin `homebridge-melcloud-home`.
- Les températures extérieures sont récupérées via Open-Meteo.
- SwitchBot : configurer `SWITCHBOT_TOKEN` et `SWITCHBOT_SECRET` **uniquement** côté serveur API (variables d’environnement).
- Le dashboard cible un seul device (première PAC détectée), comme demandé.
