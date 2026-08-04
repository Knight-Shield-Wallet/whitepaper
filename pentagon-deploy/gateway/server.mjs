import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3001);
const openaiKey = process.env.OPENAI_API_KEY;
const notionKey = process.env.NOTION_API_KEY;
const rendererSecret = process.env.PDF_RENDERER_SECRET;
const gatewayToken = process.env.PENTAGON_GATEWAY_TOKEN;
const notionVersion = '2025-09-03';

for (const [name, value] of Object.entries({
  OPENAI_API_KEY: openaiKey,
  NOTION_API_KEY: notionKey,
  PDF_RENDERER_SECRET: rendererSecret,
  PENTAGON_GATEWAY_TOKEN: gatewayToken,
})) {
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

function requireGatewayToken(req, res, next) {
  const supplied = req.get('authorization') || '';
  if (supplied !== `Bearer ${gatewayToken}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
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
      redirect: 'manual',
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

app.post('/openai/responses', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, 'https://api.openai.com/v1/responses', {
    authorization: `Bearer ${openaiKey}`,
  });
});

app.post('/notion/pages', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, 'https://api.notion.com/v1/pages', {
    authorization: `Bearer ${notionKey}`,
    'notion-version': notionVersion,
  });
});

app.patch('/notion/pages/:pageId', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, `https://api.notion.com/v1/pages/${encodeURIComponent(req.params.pageId)}`, {
    authorization: `Bearer ${notionKey}`,
    'notion-version': notionVersion,
  });
});

app.post('/notion/file_uploads', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, 'https://api.notion.com/v1/file_uploads', {
    authorization: `Bearer ${notionKey}`,
    'notion-version': notionVersion,
  });
});

app.post('/notion/file_uploads/:uploadId/send', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, `https://api.notion.com/v1/file_uploads/${encodeURIComponent(req.params.uploadId)}/send`, {
    authorization: `Bearer ${notionKey}`,
    'notion-version': notionVersion,
  });
});

app.post('/render', requireGatewayToken, raw, async (req, res) => {
  await forward(req, res, 'http://pentagon-pdf-renderer:3000/render', {
    authorization: `Bearer ${rendererSecret}`,
  });
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(port, '0.0.0.0', () => console.log(`Pentagon gateway listening on ${port}`));
