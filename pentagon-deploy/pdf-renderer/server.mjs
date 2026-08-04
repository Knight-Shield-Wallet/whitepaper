import express from 'express';
import puppeteer from 'puppeteer-core';

const app = express();
app.use(express.json({ limit: '15mb' }));

const secret = process.env.PDF_RENDERER_SECRET;
if (!secret) {
  console.error('PDF_RENDERER_SECRET is required');
  process.exit(1);
}

const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pentagon-feasibility-pdf-renderer' });
});

app.post('/render', async (req, res) => {
  const auth = req.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });

  const html = typeof req.body?.html === 'string' ? req.body.html : '';
  const requestedName = typeof req.body?.filename === 'string' ? req.body.filename : 'report.pdf';
  const filename = requestedName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

  if (!html || html.length < 200 || !/<html[\s>]/i.test(html)) {
    return res.status(400).json({ error: 'valid standalone HTML is required' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.55in', right: '0.55in', bottom: '0.55in', left: '0.55in' },
      preferCSSPageSize: false
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'pdf_render_failed' });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`PDF renderer listening on ${port}`));
