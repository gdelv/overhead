# Overhead

Live aircraft flying over your location, built with React + Vite. Data comes from adsb.lol (with OpenSky as a fallback) — no API keys required.

## Run locally
```bash
npm install
npm run dev
```

## Deploy
1. Push this folder to a GitHub repo.
2. In Netlify: Add new site → Import an existing project → pick the repo.
   Build command and publish directory are read from `netlify.toml` (`npm run build`, `dist`).
3. Deploy. Every push to `main` redeploys automatically.

Default location is set in `src/App.jsx` (`HOME`).
