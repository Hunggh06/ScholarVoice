const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', error => console.log('ERR:', error.message));
  page.on('requestfailed', request =>
    console.log('REQ FAIL:', request.url(), request.failure()?.errorText)
  );
  await page.goto('http://localhost:8080/');
  console.log("Page loaded");
  await new Promise(r => setTimeout(r, 2000));
  await page.click('#start-btn');
  console.log("Clicked start");
  await new Promise(r => setTimeout(r, 1000));
  
  // Create a minimal valid PDF!
  const fs = require('fs');
  const pdfBytes = Buffer.from(`%PDF-1.4
1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj
2 0 obj <</Type/Pages/Count 1/Kids[3 0 R]>> endobj
3 0 obj <</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>> endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer <</Size 4/Root 1 0 R>>
startxref
178
%%EOF`);
  fs.writeFileSync('dummy_valid.pdf', pdfBytes);
  
  const fileInput = await page.$('#pdf-input');
  await fileInput.uploadFile('dummy_valid.pdf');
  console.log("PDF uploaded");
  
  await new Promise(r => setTimeout(r, 8000));
  await browser.close();
})();
