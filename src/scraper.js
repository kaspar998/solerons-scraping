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

      console.log('Password entered. Looking for submit button...');

      // Try to find the specific primary submit button (avoiding tabs)
      // Amplify uses .amplify-button--primary for the actual submit
      let submitButton = await this.page.$('button[type="submit"].amplify-button--primary');

      if (!submitButton) {
        console.log('Primary Amplify button not found, looking for generic submit...');
        // Fallback
        submitButton = await this.page.$('button[type="submit"]:not([role="tab"])');
      }

      if (submitButton) {
        console.log('Submit button found, clicking...');
        await submitButton.click();
        // Wait for URL to change or login form to disappear
        console.log('Waiting for login to complete (URL change or dashboard)...');
        try {
          await this.page.waitForFunction(() => {
            return !window.location.href.includes('login') && !window.location.href.includes('signin');
          }, { timeout: 30000 });
        } catch (e) {
          console.log('Wait for URL change timed out, checking if we are redirected anyway...');
        }
      } else {
        console.log('Submit button not found, falling back to Enter...');
        await passwordInput.press('Enter');
        try {
          await this.page.waitForFunction(() => {
            return !window.location.href.includes('login') && !window.location.href.includes('signin');
          }, { timeout: 30000 });
        } catch (e) {
          console.log('Wait for URL change timed out...');
        }
      }

      console.log('Login action completed, checking status...');

      // Wait for Angular to render
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify login by checking if password field is gone
      try {
        await this.page.waitForSelector('input[type="password"]', { hidden: true, timeout: 5000 });
        console.log('Password field gone, assuming login success.');
      } catch (e) {
        console.log('Password field still present.');
        const text = await this.page.evaluate(() => document.body.innerText);
        if (text.includes('Invalid email') || text.includes('Wrong password') || text.includes('Error')) {
          throw new Error('Login failed: Invalid credentials or error message displayed.');
        }
        // If we are at /#/ and input is present, we failed.
        throw new Error('Login failed: Stayed on login page (password input visible).');
      }

      const currentUrl = this.page.url();
      console.log('Current URL:', currentUrl);

      this.isLoggedIn = true;
      console.log('Login successful!');
    } catch (error) {
      console.error('Login failed:', error.message);
      throw new Error('Login failed');
    }
  }

  async navigateToPlant() {
    console.log('Navigating to plant list...');
    await this.page.goto('https://app.soleronenergy.com/#/plants', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Waiting for plant list "Lao 8a"...');
    try {
      // Wait for element containing text "Lao 8a"
      await this.page.waitForFunction(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        return elements.some(el => el.innerText && el.innerText.includes('Lao 8a'));
      }, { timeout: 15000 });

      console.log('Found "Lao 8a" text, finding element to click...');

      const link = await this.page.evaluateHandle(() => {
        const elements = Array.from(document.querySelectorAll('a, div, td, span'));
        // prioritization: link > div
        return elements.find(el => el.innerText && el.innerText.trim() === 'Lao 8a') ||
          elements.find(el => el.innerText && el.innerText.includes('Lao 8a'));
      });

      if (link) {
        console.log('Found element, clicking...');
        await link.click();
        // Wait for dashboard to load (look for "Solar" or "Grid")
        await this.page.waitForFunction(() => {
          const text = document.body.innerText;
          return text.includes('Solar') || text.includes('Grid');
        }, { timeout: 15000 });
        console.log('Dashboard elements loaded via list navigation');
      } else {
        throw new Error('Link "Lao 8a" not found after wait');
      }
    } catch (e) {
      console.error('Navigation via list failed:', e.message);
      console.log('Attempting fallback deep link...');
      // Fallback to old method just in case
      await this.page.goto('https://app.soleronenergy.com/#/plants/290', { waitUntil: 'networkidle2' });
    }

    // Final check
    const onPage = await this.page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Solar') || text.includes('Grid');
    });

    if (!onPage) {
      console.log('Not on dashboard yet. Current URL:', this.page.url());
      throw new Error(`Failed to navigate to plant page. Current URL: ${this.page.url()}`);
    }

    console.log('Successfully on plant page:', this.page.url());
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
      if (error.message.includes('Session') || error.message.includes('login') || error.message.includes('navigate')) {
        console.log('Session or navigation error detected. Restarting browser session...');
        this.isLoggedIn = false;
        await this.close();

        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 5000));

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
