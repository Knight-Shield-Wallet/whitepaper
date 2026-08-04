import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3001);
const openaiKey = process.env.OPENAI_API_KEY;
const notionKey = process.env.NOTION_API_KEY;
const rendererSecret = process.env.PDF_RENDERER_SECRET;

for (const [name, value] of Object.entries({ OPENAI_API_KEY: openaiKey, NOTION_API_KEY: notionKey, PDF_RENDERER_SECRET: rendererSecret })) {
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
}

const raw = express.raw({ type: '*/*', limit: '25mb' });

function copyResponseHeaders(from, to) {
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = from.headers.get(name);
    if (value) to.setHeader(name, value);
  }
}

async function forward(req, res, target, headers = {}) {
  try {
    const incomingType = req.get('content-type');
    const outgoingHeaders = { ...headers };
    if (incomingType) outgoingHeaders['content-type'] = incomingType;

    const response = await fetch(target, {
      method: req.method,
      headers: outgoingHeaders,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
      redirect: 'manual'
    });

    const data = Buffer.from(await response.arrayBuffer());
    res.status(response.status);
    copyResponseHeaders(response, res);
    res.send(data);
  } catch (error) {
    console.error('gateway_forward_failed', error?.message || error);
    res.status(502).json({ error: 'gateway_forward_failed' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pentagon-runtime-gateway' });
});

app.all('/openai/*path', raw, async (req, res) => {
  const suffix = req.originalUrl.replace(/^\/openai/, '');
  await forward(req, res, `https://api.openai.com/v1${suffix}`, {
    authorization: `Bearer ${openaiKey}`
  });
});

app.all('/notion/*path', raw, async (req, res) => {
  const suffix = req.originalUrl.replace(/^\/notion/, '');
  await forward(req, res, `https://api.notion.com/v1${suffix}`, {
    authorization: `Bearer ${notionKey}`,
    'notion-version': '2026-03-11'
  });
});

app.all('/render', raw, async (req, res) => {
  await forward(req, res, 'http://pentagon-pdf-renderer:3000/render', {
    authorization: `Bearer ${rendererSecret}`
  });
});

app.listen(port, '0.0.0.0', () => console.log(`Pentagon gateway listening on ${port}`));
