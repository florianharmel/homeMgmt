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

## Notes techniques

- Le backend implémente un flux OAuth MELCloud Home inspiré du plugin `homebridge-melcloud-home`.
- Les températures extérieures sont récupérées via Open-Meteo.
- Le dashboard cible un seul device (première PAC détectée), comme demandé.
