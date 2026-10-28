/**
 * ==========================================================================
 * BOOKBRIDGE AUTOMATED MULTI-VIEWPORT UI VERIFICATION TEST SUITE
 * Tests index, browse, sell, exchange, donate, dashboard, login, register
 * at 320, 390, 768, 1024, 1440 px as Guest and as Logged-in Student.
 * Verifies: No horizontal scroll, Buy/Sell reachable, no broken img, no JS error.
 * ==========================================================================
 */

const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '8098';
process.env.JWT_SECRET = 'test_secret_key_bookbridge_enterprise_2026_super_secure';

const { app, server } = require('../server');
const { connectDB } = require('../config/db');
const { syncDatabase, User } = require('../models');
const { seedDatabase } = require('../config/seed');

const VIEWPORTS = [
  { width: 320, height: 600, name: '320_mobile_small' },
  { width: 390, height: 844, name: '390_iphone' },
  { width: 768, height: 1024, name: '768_tablet_portrait' },
  { width: 1024, height: 768, name: '1024_tablet_landscape' },
  { width: 1440, height: 900, name: '1440_desktop' }
];

const PAGES = [
  'index.html',
  'browse.html',
  'sell.html',
  'exchange.html',
  'donate.html',
  'dashboard.html',
  'login.html',
  'register.html'
];

const screenshotsDir = path.resolve(process.cwd(), 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runUIChecks() {
  console.log('===================================================');
  console.log('🖥️ RUNNING PLAYWRIGHT AUTOMATED RESPONSIVE UI CHECKS');
  console.log('===================================================');

  // 1. Connect database & start server on port 8098
  await connectDB();
  await syncDatabase({ alter: false });
  await seedDatabase();

  await new Promise((resolve) => {
    server.listen(8098, '127.0.0.1', () => {
      console.log('Test server listening on http://127.0.0.1:8098');
      resolve();
    });
  });

  const browser = await chromium.launch({ headless: true });
  const baseUrl = 'http://127.0.0.1:8098';

  const results = [];

  try {
    for (const role of ['guest', 'student']) {
      console.log(`\n--- Testing Role: ${role.toUpperCase()} ---`);

      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height }
        });

        const page = await context.newPage();

        // Collect console errors & image load failures
        const jsErrors = [];
        const brokenImageUrls = [];

        page.on('console', msg => {
          if (msg.type() === 'error') {
            const text = msg.text();
            if (!text.includes('favicon') && !text.includes('Failed to load resource')) {
              jsErrors.push(text);
            }
          }
        });
        page.on('pageerror', err => {
          jsErrors.push(err.message);
        });
        page.on('response', resp => {
          if (resp.request().resourceType() === 'image' && resp.status() >= 400) {
            brokenImageUrls.push(`${resp.url()} (HTTP ${resp.status()})`);
          }
        });

        // Set student session if student role
        if (role === 'student') {
          await page.addInitScript(() => {
            const mockStudent = {
              id: 'usr-student',
              name: 'Demo Student',
              email: 'student@rcti.ac.in',
              role: 'student',
              branch: 'CE',
              semester: 5
            };
            localStorage.setItem('rcti_gtu_current_user', JSON.stringify(mockStudent));
            localStorage.setItem('bb_access_token', 'mock_student_token_valid');
          });
        }

        for (const pageName of PAGES) {
          const testName = `[${role.toUpperCase()}][${vp.width}px] ${pageName}`;
          try {
            await page.goto(`${baseUrl}/${pageName}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(300); // Allow responsive JS / DOM settling

            // 1. Check for horizontal overflow (document width > client width)
            const overflow = await page.evaluate(() => {
              const root = document.documentElement;
              const scrollW = root.scrollWidth;
              const clientW = root.clientWidth;
              const diff = scrollW - clientW;
              return {
                scrollW,
                clientW,
                diff,
                hasOverflow: diff > 1
              };
            });

            // 2. Check for empty src="" or broken images
            const emptySrcImages = await page.evaluate(() => {
              const imgs = Array.from(document.querySelectorAll('img'));
              return imgs
                .filter(img => {
                  const src = img.getAttribute('src');
                  return !src || src.trim() === '' || src === 'about:blank';
                })
                .map(img => img.outerHTML.substring(0, 100));
            });

            // 3. Check reachability of Buy & Sell options
            const buySellReachable = await page.evaluate(() => {
              const textContent = document.body.innerText.toLowerCase();
              const hasBuy = textContent.includes('buy') || !!document.querySelector('a[href*="browse"], button:has-text("Buy")');
              const hasSell = textContent.includes('sell') || !!document.querySelector('a[href*="sell"], button:has-text("Sell")');
              return { hasBuy, hasSell };
            });

            // Capture screenshot for key viewports
            const screenshotPath = path.join(screenshotsDir, `${role}_${vp.width}_${pageName.replace('.html', '')}.png`);
            if (['390_iphone', '768_tablet_portrait', '1440_desktop'].includes(vp.name) && ['index.html', 'browse.html', 'sell.html'].includes(pageName)) {
              await page.screenshot({ path: screenshotPath, fullPage: false });
            }

            const totalBroken = emptySrcImages.length + brokenImageUrls.length;
            const passed =
              !overflow.hasOverflow &&
              totalBroken === 0 &&
              jsErrors.length === 0 &&
              buySellReachable.hasBuy &&
              buySellReachable.hasSell;

            let details = '';
            if (overflow.hasOverflow) details += `Horizontal overflow by ${overflow.diff}px (scroll: ${overflow.scrollW}px, client: ${overflow.clientW}px). `;
            if (emptySrcImages.length > 0) details += `${emptySrcImages.length} image(s) with empty src. `;
            if (brokenImageUrls.length > 0) details += `Failed image loads: ${brokenImageUrls.join(', ')}. `;
            if (jsErrors.length > 0) details += `JS errors: ${jsErrors.slice(0, 2).join('; ')}. `;

            results.push({ testName, passed, details });
            console.log(`${passed ? '✅ PASS' : '❌ FAIL'} ${testName} ${details ? '(' + details.trim() + ')' : ''}`);

            // Clear errors for next page
            jsErrors.length = 0;
            brokenImageUrls.length = 0;
          } catch (err) {
            results.push({ testName, passed: false, details: err.message });
            console.log(`❌ FAIL ${testName} (Error: ${err.message})`);
          }
        }

        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log('\n===================================================');
  console.log('📊 MULTI-VIEWPORT UI CHECK RESULTS');
  console.log('===================================================');
  console.log(`Total Scenarios Checked: ${total}`);
  console.log(`Passed:                  ${passed}`);
  console.log(`Failed:                  ${failed}`);
  console.log('===================================================');

  if (failed > 0) {
    console.log('\nFailed Scenarios:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`- ${r.testName}: ${r.details}`);
    });
  }

  return { total, passed, failed };
}

if (require.main === module) {
  runUIChecks().then(({ failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

module.exports = { runUIChecks };
