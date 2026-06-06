import { chromium } from 'playwright';

async function runTest() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('BROWSER LOG:', msg.text());
  });

  page.on('pageerror', err => {
    console.error('BROWSER RUNTIME ERROR:', err);
  });

  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173');

    // Click Host Game
    console.log('Waiting for Host button...');
    await page.waitForSelector('#btn-host');
    console.log('Clicking Host Game...');
    await page.click('#btn-host');

    // Wait for Lobby screen and click Start Game
    console.log('Waiting for Start button...');
    await page.waitForSelector('#btn-start');
    console.log('Clicking Start Game...');
    await page.click('#btn-start');

    // Wait for the race to start (intro = 5s, countdown = 4s, so 10s total to be safe)
    console.log('Waiting 12 seconds for countdown to finish...');
    await new Promise(r => setTimeout(r, 12000));

    // Force give weapon: ROCKET
    console.log('Giving ROCKET weapon...');
    await page.evaluate(() => {
      console.log('Window keys:', Object.keys(window));
      if (window.Game) {
        window.Game.pickupWeapon('ROCKET', 0);
        console.log('Held weapon set to:', window.Game.getHeldWeapon());
      } else {
        console.error('window.Game is not exposed!');
      }
    });

    // Press Space key to fire rocket
    console.log('Pressing Space to fire rocket...');
    await page.keyboard.press('Space');

    // Wait 15 seconds to see if it explodes or hangs
    console.log('Waiting 15 seconds to observe behavior...');
    await new Promise(r => setTimeout(r, 15000));

    console.log('Checking responsiveness...');
    const result = await page.evaluate(() => {
      return 42;
    });
    console.log('PAGE RESPONDED WITH:', result);
    console.log('TEST COMPLETED: Page is responsive and did not hang!');

  } catch (err) {
    console.error('TEST EXCEPTION:', err);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

runTest();
