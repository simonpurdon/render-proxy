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

// Payaccsys endpoints by environment
const PAYACCSYS_ENVIRONMENTS = {
  uat: {
    host: 'uat.payaccsys.com',
    port: 8443
  },
  production: {
    host: 'api.payaccsys.com',
    port: null  // No port for production - use default HTTPS
  }
};

// Default environment (can be overridden per request)
const DEFAULT_ENVIRONMENT = process.env.PAYACCSYS_ENVIRONMENT || 'uat';

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

  const { path, method = 'POST', authorization, payload, environment } = req.body;

  if (!path || !authorization) {
    return res.status(400).json({
      error: 'Missing required fields: path, authorization'
    });
  }

  // Select environment (from request body, or use default)
  const env = environment || DEFAULT_ENVIRONMENT;
  const targetEnv = PAYACCSYS_ENVIRONMENTS[env];

  if (!targetEnv) {
    return res.status(400).json({
      error: `Invalid environment: ${env}. Valid options: uat, production`
    });
  }

  const { host, port } = targetEnv;
  console.log(`[Proxy] Received environment from request: "${environment}"`);
  console.log(`[Proxy] Using environment: ${env}`);
  console.log(`[Proxy] Target host: ${host}, port: ${port || 'default (443)'}`);
  const targetUrl = port ? `https://${host}:${port}${path}` : `https://${host}${path}`;
  console.log(`[Proxy] Forwarding ${method} request to: ${targetUrl}`);

  // Detailed logging for debugging /api/1/transactions
  if (path.includes('/transactions')) {
    console.log('=== DETAILED REQUEST DEBUG ===');
    console.log(`[Debug] Path: ${path}`);
    console.log(`[Debug] Method: ${method}`);
    console.log(`[Debug] Authorization header: ${authorization}`);
    console.log(`[Debug] Payload: ${JSON.stringify(payload, null, 2)}`);
    console.log('=== END DEBUG ===');
  }

  try {
    const result = await makeRequest(host, port, path, method, authorization, payload);

    console.log(`[Proxy] Response status: ${result.status}`);

    // Detailed response logging for /transactions
    if (path.includes('/transactions')) {
      console.log('=== DETAILED RESPONSE DEBUG ===');
      console.log(`[Debug] Status: ${result.status} ${result.statusText}`);
      console.log(`[Debug] Response body: ${result.body}`);
      console.log(`[Debug] Response headers: ${JSON.stringify(result.headers, null, 2)}`);
      console.log('=== END RESPONSE DEBUG ===');
    }

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

function makeRequest(host, port, path, method, authorization, payload) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : '';

    const options = {
      hostname: host,
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

    // Only include port if specified (production uses default HTTPS port)
    if (port) {
      options.port = port;
    }

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
  console.log(`[Proxy] Default environment: ${DEFAULT_ENVIRONMENT}`);
  console.log(`[Proxy] Available environments:`, Object.keys(PAYACCSYS_ENVIRONMENTS).join(', '));
  console.log(`[Proxy] API Key protection: ${PROXY_API_KEY ? 'enabled' : 'disabled'}`);
});
