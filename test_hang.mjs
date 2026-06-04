
import { chromium } from 'playwright';

setTimeout(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));
  
  console.log('Navigating to game...');
  await page.goto('http://localhost:5173');
  
  await page.waitForSelector('#btn-host');
  console.log('Clicking HOST...');
  await page.click('#btn-host');
  
  await page.waitForSelector('#btn-start');
  console.log('Clicking START...');
  await page.click('#btn-start');

  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('Taking screenshot...');
  await page.screenshot({ path: 'C:/Users/J/.gemini/antigravity/brain/413d522c-22c1-4cf5-b2a6-4f2630f206e1/ui_verification.png' });
  
  console.log('Testing if page is responsive...');
  try {
    await page.evaluate(() => { return 1; }, { timeout: 2000 });
    console.log('PAGE IS RESPONSIVE!');
  } catch (e) {
    console.log('PAGE IS HUNG!', e.message);
  }

  await browser.close();
  process.exit(0);
}, 500);

