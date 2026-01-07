# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automated web scraper for Soleron Energy plant data (plant #290). Uses Puppeteer to log in, scrape energy flow data, and expose it via REST API with a web dashboard.

## Common Commands

```bash
# Install dependencies
npm install

# Run locally (requires .env file)
npm start

# Deploy to Railway (using Dockerfile)
# Set env vars in Railway dashboard: SOLERON_USER, SOLERON_PASS
```

## Architecture

- **src/index.js**: Entry point, loads env vars and initializes server
- **src/server.js**: Express server with API endpoints and static file serving
- **src/scraper.js**: Puppeteer-based scraper class with session management
- **src/public/index.html**: Dashboard UI with auto-refresh

**Flow**: Scraper logs in once → maintains session → scrapes every 2 min → stores in memory → Express serves via `/api/energy`

## Key Implementation Details

- **Session Management**: Browser instance stays alive, re-login only on session expiry
- **Error Recovery**: Falls back to cached data on scrape failure, retries on login issues
- **Generic Scraping**: Currently extracts all energy-related DOM elements (kW, W, kWh patterns)
- **DOM Discovery**: First run will log raw data to identify exact selectors needed

## Environment Variables

Required: `SOLERON_USER`, `SOLERON_PASS`
Optional: `PORT` (default 3000), `SCRAPE_INTERVAL` (default 120000ms)

## Next Steps for Refinement

1. Run scraper once and inspect raw data output in console/dashboard
2. Identify exact CSS selectors or text patterns for energy flow values
3. Update `scraper.js` `scrapeEnergyFlow()` to extract specific fields
4. Add data transformation logic as specified by user
