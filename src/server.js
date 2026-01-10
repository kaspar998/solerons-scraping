const express = require('express');
const path = require('path');
const axios = require('axios');
const SoleronScraper = require('./scraper');

class Server {
  constructor(port, scrapeInterval) {
    this.port = port;
    this.scrapeInterval = scrapeInterval;
    this.app = express();
    this.scraper = null;
    this.scrapeTimer = null;
    this.lastActivity = Date.now();
    this.inactivityTimeout = 30 * 60 * 1000; // 30 minutes

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // API endpoint for energy data
    this.app.get('/api/energy', (req, res) => {
      const now = Date.now();
      const timeSinceLastActivity = now - this.lastActivity;

      console.log(`[API] /api/energy request - Time since last: ${Math.floor(timeSinceLastActivity / 1000)}s`);

      // Update activity timestamp
      this.lastActivity = now;

      // Ensure scraping loop is running
      this.ensureScrapingLoop();

      const data = this.scraper ? this.scraper.getLatestData() : null;

      if (!data) {
        return res.status(503).json({
          error: 'Data not available yet',
          message: 'Scraper is initializing. Please try again in a moment.'
        });
      }

      res.json({
        success: true,
        data: data,
        lastUpdate: data.timestamp
      });
    });

    // API endpoint to trigger manual refresh
    this.app.post('/api/refresh', async (req, res) => {
      this.lastActivity = Date.now();
      this.ensureScrapingLoop();

      if (!this.scraper) {
        return res.status(503).json({
          error: 'Scraper not initialized'
        });
      }

      console.log('\n--- Manual refresh triggered ---');
      try {
        await this.scraper.scrape();
        const data = this.scraper.getLatestData();
        res.json({
          success: true,
          data: data,
          lastUpdate: data.timestamp
        });
      } catch (error) {
        console.error('Manual refresh failed:', error);
        res.status(500).json({
          success: false,
          error: 'Scrape failed',
          message: error.message
        });
      }
    });

    // API endpoint for price data (mFRR + Nord Pool)
    this.app.get('/api/prices', async (req, res) => {
      try {
        const { start, end, hours = 24 } = req.query;

        // Calculate time range
        const endDate = end ? new Date(end) : new Date();
        const startDate = start ? new Date(start) : new Date(endDate.getTime() - hours * 60 * 60 * 1000);

        // Format dates for APIs
        const formatDateBaltic = (d) => d.toISOString().slice(0, 16).replace('T', 'T');
        const formatDateElering = (d) => d.toISOString();

        console.log(`[API] /api/prices request - Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Fetch data from both APIs in parallel
        const [balticData, eleringData] = await Promise.all([
          this.fetchBalticPrices(formatDateBaltic(startDate), formatDateBaltic(endDate)),
          this.fetchEleringPrices(formatDateElering(startDate), formatDateElering(endDate))
        ]);

        res.json({
          success: true,
          data: {
            mfrr: balticData.mfrr || [],
            volumes: balticData.volumes || [],
            nordpool: eleringData || []
          },
          range: {
            start: startDate.toISOString(),
            end: endDate.toISOString()
          }
        });
      } catch (error) {
        console.error('Price API error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch price data',
          message: error.message
        });
      }
    });

    // Serve dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
  }

  async initializeScraper(username, password) {
    console.log('Initializing scraper instance...');
    this.scraper = new SoleronScraper(username, password);

    // We don't start the loop here immediately. 
    // It will be started by the first request or manual trigger.
    // However, if we want data ready on startup (optional), we could do one scrape.
    // Let's NOT scrape on startup to save resources until needed, 
    // OR we can do one initial scrape to have "something" in memory.
    // Let's do one initial scrape so the server isn't empty.

    console.log('Performing initial startup scrape...');
    try {
      await this.scraper.scrape();
      console.log('Initial scrape completed.');
    } catch (e) {
      console.error('Initial scrape failed (will retry on demand):', e.message);
    }
  }

  ensureScrapingLoop() {
    if (this.scrapeTimer) return; // Already running

    console.log('Starting scraping loop due to activity...');

    // Run immediately if we haven't scraped recently? 
    // The interval will run AFTER the delay. So if we need immediate data, we rely on the cached data 
    // or the previous scrape.

    this.scrapeTimer = setInterval(async () => {
      const timeSinceLastActivity = Date.now() - this.lastActivity;
      const minutesSinceActivity = Math.floor(timeSinceLastActivity / 1000 / 60);

      console.log(`[LOOP] Check - Time since last activity: ${minutesSinceActivity} min (timeout: ${this.inactivityTimeout / 1000 / 60} min)`);

      if (timeSinceLastActivity > this.inactivityTimeout) {
        console.log(`[LOOP] STOPPING - No activity for ${minutesSinceActivity} minutes`);
        this.stopLoop();
        return;
      }

      console.log(`[LOOP] Scraping... (interval: ${this.scrapeInterval / 1000}s)`);
      await this.scraper.scrape();
    }, this.scrapeInterval);
  }

  stopLoop() {
    if (this.scrapeTimer) {
      clearInterval(this.scrapeTimer);
      this.scrapeTimer = null;
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`\nServer running on port ${this.port}`);
    });
  }

  async fetchBalticPrices(startDate, endDate) {
    try {
      const url = 'https://api-baltic.transparency-dashboard.eu/api/v1/export';

      // Fetch mFRR prices
      const priceResponse = await axios.get(url, {
        params: {
          id: 'local_marginal_price_mfrr',
          start_date: startDate,
          end_date: endDate,
          output_time_zone: 'EET',
          output_format: 'json'
        },
        timeout: 10000
      });

      // Fetch mFRR volumes
      const volumeResponse = await axios.get(url, {
        params: {
          id: 'normal_activations_mfrr',
          start_date: startDate,
          end_date: endDate,
          output_time_zone: 'EET',
          output_format: 'json'
        },
        timeout: 10000
      });

      return {
        mfrr: priceResponse.data || [],
        volumes: volumeResponse.data || []
      };
    } catch (error) {
      console.error('Baltic API error:', error.message);
      return { mfrr: [], volumes: [] };
    }
  }

  async fetchEleringPrices(startDate, endDate) {
    try {
      const url = 'https://dashboard.elering.ee/api/nps/price';
      const response = await axios.get(url, {
        params: {
          start: startDate,
          end: endDate
        },
        timeout: 10000
      });

      return response.data?.data || [];
    } catch (error) {
      console.error('Elering API error:', error.message);
      return [];
    }
  }

  async stop() {
    this.stopLoop();
    if (this.scraper) {
      await this.scraper.close();
    }
  }
}

module.exports = Server;
