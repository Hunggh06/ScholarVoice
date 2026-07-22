const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
  
  await page.goto('http://localhost:8080/');
  console.log("Page loaded");
  
  // click start
  await page.click('#start-btn');
  await page.waitForTimeout(1000);
  
  // upload fake pdf
  const fs = require('fs');
  fs.writeFileSync('dummy.pdf', '%PDF-1.4\n%EOF');
  
  const fileInput = await page.$('#pdf-input');
  await fileInput.setInputFiles('dummy.pdf');
  
  console.log("PDF uploaded");
  await page.waitForTimeout(5000); // wait for 3d model to load
  
  await browser.close();
})();
