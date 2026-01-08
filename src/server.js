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
    console.log('Initializing scraper...');
    this.scraper = new SoleronScraper(username, password);

    // Do initial scrape
    await this.scraper.scrape();

    // Set up periodic scraping
    this.scrapeTimer = setInterval(async () => {
      console.log(`\n--- Scraping cycle (every ${this.scrapeInterval/1000}s) ---`);
      await this.scraper.scrape();
    }, this.scrapeInterval);

    console.log(`Scraper initialized. Will scrape every ${this.scrapeInterval/1000} seconds.`);
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`\nServer running on port ${this.port}`);
      console.log(`Dashboard: http://localhost:${this.port}`);
      console.log(`API: http://localhost:${this.port}/api/energy`);
    });
  }

  async stop() {
    if (this.scrapeTimer) {
      clearInterval(this.scrapeTimer);
    }
    if (this.scraper) {
      await this.scraper.close();
    }
  }
}

module.exports = Server;
