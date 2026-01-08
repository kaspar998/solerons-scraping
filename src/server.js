const express = require('express');
const path = require('path');
const SoleronScraper = require('./scraper');

class Server {
  constructor(port, scrapeInterval) {
    this.port = port;
    this.scrapeInterval = scrapeInterval;
    this.app = express();
    this.scraper = null;
    this.scrapeTimer = null;
    this.lastActivity = Date.now();
    this.inactivityTimeout = 5 * 60 * 1000; // 5 minutes

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
      // Update activity timestamp
      this.lastActivity = Date.now();

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

      if (timeSinceLastActivity > this.inactivityTimeout) {
        console.log(`\nNo activity for ${this.inactivityTimeout / 1000 / 60} minutes. Stopping scraping loop.`);
        this.stopLoop();
        return;
      }

      console.log(`\n--- Scraping cycle (every ${this.scrapeInterval / 1000}s) ---`);
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
      console.log(`Dashboard: http://localhost:${this.port}`);
      console.log(`API: http://localhost:${this.port}/api/energy`);
    });
  }

  async stop() {
    this.stopLoop();
    if (this.scraper) {
      await this.scraper.close();
    }
  }
}

module.exports = Server;
