# Soleron Energy Scraper

Automatic scraper for Soleron Energy plant data with web dashboard.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Edit `.env` and add your credentials:
```
SOLERON_USER=kaspar@reldor.ee
SOLERON_PASS=ASD135asd
PORT=3000
SCRAPE_INTERVAL=120000
```

## Run Locally

```bash
npm start
```

Then open http://localhost:3000

## Deploy to Railway

1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard:
   - `SOLERON_USER`
   - `SOLERON_PASS`
   - `PORT` (Railway will set this automatically)
   - `SCRAPE_INTERVAL` (optional, default: 120000)

## API Endpoints

- `GET /` - Dashboard UI
- `GET /api/energy` - Latest energy flow data (JSON)
- `GET /health` - Health check

## How It Works

1. Puppeteer logs into Soleron Energy app
2. Navigates to plant #290
3. Scrapes energy flow data every 2 minutes
4. Exposes data via REST API
5. Dashboard auto-refreshes every 30 seconds

## Next Steps

- The scraper currently extracts all energy-related values
- Run it once and check the raw data to identify exact fields needed
- Update `scraper.js` to extract specific values based on actual DOM structure
