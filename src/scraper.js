const puppeteer = require('puppeteer');

class SoleronScraper {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.browser = null;
    this.page = null;
    this.isLoggedIn = false;
    this.latestData = null;
  }

  async initialize() {
    console.log('Initializing browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });
    console.log('Browser initialized');
  }

  async login() {
    console.log('Attempting to login...');
    try {
      await this.page.goto('https://app.soleronenergy.com/', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      console.log('Page loaded, looking for login form...');

      // Wait for login form to appear
      await this.page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 10000 });
      console.log('Login form found');

      // Fill in credentials
      const emailInput = await this.page.$('input[type="email"], input[type="text"]');
      await emailInput.type(this.username);
      console.log('Email entered');

      const passwordInput = await this.page.$('input[type="password"]');
      await passwordInput.type(this.password);
      console.log('Password entered');

      console.log('Pressing Enter to submit...');

      // Press Enter to submit form and wait for navigation
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        passwordInput.press('Enter')
      ]);

      console.log('Navigation after login completed');

      // Wait for Angular to render
      await new Promise(resolve => setTimeout(resolve, 3000));

      const currentUrl = this.page.url();
      console.log('Current URL:', currentUrl);

      // Simple check: if URL doesn't contain login/signin, we're probably logged in
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        throw new Error('Login failed - still on login page. Check credentials.');
      }

      this.isLoggedIn = true;
      console.log('Login successful!');
    } catch (error) {
      console.error('Login failed:', error.message);
      throw new Error('Login failed');
    }
  }

  async navigateToPlant() {
    console.log('Navigating to plant 290...');
    console.log('Navigating to plant 290...');
    const targetUrl = 'https://app.soleronenergy.com/#/plants/290';

    // Function to check if we are on the correct page
    const isOnPlantPage = () => this.page.url().includes('plants/290');

    if (isOnPlantPage()) {
      console.log('Already on plant page, reloading to refresh data...');
      await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    } else {
      console.log(`Navigating to ${targetUrl}...`);
      await this.page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    // Check if we ended up on the correct page or got redirected (e.g. to list)
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for redirects

    if (!isOnPlantPage()) {
      console.log('Redirected away from plant page. Attempting force navigation...');
      // Try one more time completely fresh
      await this.page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      await new Promise(resolve => setTimeout(resolve, 3000));
      if (!isOnPlantPage()) {
        console.log('Still not on plant page. Current URL:', this.page.url());
        // Fallback: Check for "Lao 8a" link and click it
        try {
          const laoLink = await this.page.waitForSelector('a[href*="plants/290"], div:contains("Lao 8a")', { timeout: 5000 });
          if (laoLink) {
            console.log('Found link to plant, clicking...');
            await laoLink.click();
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
          }
        } catch (e) {
          console.log('Could not find direct link to plant.');
        }
      }
    }

    // Final check
    if (!isOnPlantPage()) {
      throw new Error(`Failed to navigate to plant page. Current URL: ${this.page.url()}`);
    }

    console.log('Successfully on plant page:', this.page.url());

    // Wait for Angular to load
    await this.page.waitForFunction(() => {
      return document.body.innerText.includes('Solar') || document.body.innerText.includes('Grid');
    }, { timeout: 20000 });

    console.log('Dashboard elements loaded');
    console.log('Dashboard elements loaded');
  }

  async scrapeEnergyFlow() {
    console.log('Scraping energy flow data...');
    try {
      // Wait for Angular to fully render and data to populate
      try {
        await this.page.waitForFunction(() => {
          const text = document.body.innerText || '';
          return text.includes('Solar') && text.includes('Grid') && text.includes('Load:');
        }, { timeout: 15000 });
      } catch (e) {
        console.log('Timeout waiting for data elements, taking screenshot and attempting scrape anyway...');
        try {
          await this.page.screenshot({ path: 'debug-scrape-timeout.png' });
          console.log('Saved debug screenshot to debug-scrape-timeout.png');
        } catch (err) {
          console.error('Failed to take screenshot:', err);
        }
      }

      const data = await this.page.evaluate(() => {
        const result = {
          timestamp: new Date().toISOString(),
          solar: { load: null, status: null },
          grid: { load: null, status: null },
          battery: { load: null, soc: null, status: null },
          car: { load: null, status: null },
          consumption: { load: null, status: null },
          mfrr: null
        };

        // Helper to extract load value (returns watts)
        const extractLoad = (text) => {
          const match = text.match(/Load:\s*(-?\d+)\s*W/i);
          return match ? parseInt(match[1]) : null;
        };

        // Helper to extract status (second line after device name)
        const extractStatus = (text) => {
          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          // Status is usually: DeviceName, STATUS, Load:, ...
          // So it's the second non-empty line
          if (lines.length >= 2) {
            const status = lines[1];
            // Make sure it's not a "Load:" line
            if (!status.startsWith('Load:') && !status.startsWith('SoC:')) {
              return status;
            }
          }
          return null;
        };

        // Helper to extract SoC
        const extractSoC = (text) => {
          const match = text.match(/SoC:\s*(\d+)%/i);
          return match ? parseInt(match[1]) : null;
        };

        // Find all elements - more universal approach
        const allElements = Array.from(document.querySelectorAll('*'));

        // Find elements containing specific keywords
        const findElement = (keyword) => {
          return allElements.find(el => {
            const text = el.innerText || el.textContent || '';
            const hasKeyword = text.includes(keyword);
            const hasLoad = text.includes('Load:');
            // Element should be small enough (not the whole page)
            return hasKeyword && hasLoad && text.length < 200;
          });
        };

        // Helper to get text with line breaks preserved
        const getText = (el) => el.innerText || el.textContent || '';

        // Find Solar
        const solarCard = findElement('Solar');
        if (solarCard) {
          const text = getText(solarCard);
          result.solar.load = extractLoad(text);
          result.solar.status = extractStatus(text);
        }

        // Find Grid - simpler check
        const gridCard = findElement('Grid');
        if (gridCard) {
          const text = getText(gridCard);
          result.grid.load = extractLoad(text);
          result.grid.status = extractStatus(text);
        }

        // Find Battery
        const batteryCard = findElement('Battery');
        if (batteryCard) {
          const text = getText(batteryCard);
          result.battery.load = extractLoad(text);
          result.battery.soc = extractSoC(text);
          result.battery.status = extractStatus(text);
        }

        // Find Car
        const carCard = findElement('Car');
        if (carCard) {
          const text = getText(carCard);
          result.car.load = extractLoad(text);
          result.car.status = extractStatus(text);
        }

        // Find Consumption
        const consumptionCard = findElement('Consumption');
        if (consumptionCard) {
          const text = getText(consumptionCard);
          result.consumption.load = extractLoad(text);
          result.consumption.status = extractStatus(text);
        }

        // Find mFRR value
        // Look for elements containing "mFRR"
        const mfrrElement = allElements.find(el => {
          const text = (el.innerText || el.textContent || '').toLowerCase();
          return text.includes('mfrr') && text.length < 500;
        });

        if (mfrrElement) {
          const text = getText(mfrrElement);
          // Extract number after "mFRR" keyword
          const match = text.match(/mFRR[\s\n]*(\d+\.?\d*)\s*€?/i);
          if (match) {
            result.mfrr = parseFloat(match[1]);
          }
        }

        return result;
      });

      this.latestData = data;
      console.log('Scraped data:', JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error('Scraping failed:', error.message);
      return this.latestData; // Return cached data if available
    }
  }

  async scrape() {
    try {
      // Initialize browser if not already done
      if (!this.browser) {
        await this.initialize();
      }

      // Login if not already logged in
      if (!this.isLoggedIn) {
        await this.login();
      }

      // Navigate to plant page
      await this.navigateToPlant();

      // Scrape data
      const data = await this.scrapeEnergyFlow();
      return data;
    } catch (error) {
      console.error('Scrape cycle failed:', error.message);

      // Try to recover by re-initializing
      if (error.message.includes('Session') || error.message.includes('login')) {
        console.log('Attempting to recover session...');
        this.isLoggedIn = false;
        await this.close();
        return await this.scrape(); // Retry
      }

      return this.latestData; // Return cached data
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
      console.log('Browser closed');
    }
  }

  getLatestData() {
    return this.latestData;
  }
}

module.exports = SoleronScraper;
