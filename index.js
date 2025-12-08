/**
 * Payaccsys API Proxy Server
 *
 * Supports requests to non-standard HTTPS ports (unlike Cloudflare Workers).
 * Deploy to Render.com, Railway, or any Node.js host.
 */

const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Payaccsys UAT endpoint - uses non-standard port 8443
const PAYACCSYS_HOST = 'uat.payaccsys.com';
const PAYACCSYS_PORT = 8443;

// API key for securing the proxy
const PROXY_API_KEY = process.env.PROXY_API_KEY;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main proxy endpoint
app.post('/', async (req, res) => {
  // Validate API key if configured
  const apiKey = req.headers['x-proxy-key'];
  if (PROXY_API_KEY && apiKey !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { path, method = 'POST', authorization, payload } = req.body;

  if (!path || !authorization) {
    return res.status(400).json({
      error: 'Missing required fields: path, authorization'
    });
  }

  console.log(`[Proxy] Forwarding ${method} request to: https://${PAYACCSYS_HOST}:${PAYACCSYS_PORT}${path}`);

  try {
    const result = await makeRequest(path, method, authorization, payload);

    console.log(`[Proxy] Response status: ${result.status}`);

    res.json({
      status: result.status,
      statusText: result.statusText,
      body: result.body,
      headers: result.headers
    });
  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    res.status(500).json({
      error: error.message || 'Proxy error',
      type: error.code || 'Error'
    });
  }
});

function makeRequest(path, method, authorization, payload) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : '';

    const options = {
      hostname: PAYACCSYS_HOST,
      port: PAYACCSYS_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'PostmanRuntime/7.32.0',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      },
      // Don't reject self-signed certs (UAT environment may use them)
      rejectUnauthorized: false
    };

    if (method === 'POST' && payload) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        const headers = {};
        Object.keys(response.headers).forEach(key => {
          headers[key] = response.headers[key];
        });

        resolve({
          status: response.statusCode,
          statusText: response.statusMessage,
          body: data,
          headers: headers
        });
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    if (method === 'POST' && payload) {
      request.write(postData);
    }

    request.end();
  });
}

app.listen(PORT, () => {
  console.log(`[Proxy] Server running on port ${PORT}`);
  console.log(`[Proxy] Target: https://${PAYACCSYS_HOST}:${PAYACCSYS_PORT}`);
  console.log(`[Proxy] API Key protection: ${PROXY_API_KEY ? 'enabled' : 'disabled'}`);
});
