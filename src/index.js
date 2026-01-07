require('dotenv').config();
const Server = require('./server');

// Load environment variables
const PORT = process.env.PORT || 3000;
const SCRAPE_INTERVAL = parseInt(process.env.SCRAPE_INTERVAL) || 120000; // 2 minutes default
const SOLERON_USER = process.env.SOLERON_USER;
const SOLERON_PASS = process.env.SOLERON_PASS;

// Validate required environment variables
if (!SOLERON_USER || !SOLERON_PASS) {
  console.error('ERROR: Missing required environment variables!');
  console.error('Please set SOLERON_USER and SOLERON_PASS');
  console.error('Example: export SOLERON_USER=your@email.com');
  console.error('         export SOLERON_PASS=yourpassword');
  process.exit(1);
}

console.log('=== Soleron Energy Scraper ===');
console.log(`Port: ${PORT}`);
console.log(`Scrape interval: ${SCRAPE_INTERVAL/1000}s`);
console.log(`User: ${SOLERON_USER}`);
console.log('==============================\n');

// Create and start server
const server = new Server(PORT, SCRAPE_INTERVAL);

// Initialize scraper and start server
(async () => {
  try {
    await server.initializeScraper(SOLERON_USER, SOLERON_PASS);
    server.start();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await server.stop();
  process.exit(0);
});
