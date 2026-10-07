import https from 'node:https';

// El cliente del LoL (LCU) y la Live Client API usan certificados autofirmados en localhost.
const localAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function localRequest({ port, path, method = 'GET', auth, body, timeout = 4000 }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent: localAgent,
        timeout,
        headers: {
          Accept: 'application/json',
          ...(auth ? { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {}),
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (text) {
            try { data = JSON.parse(text); } catch { data = text; }
          }
          if (res.statusCode >= 400) {
            reject(new HttpError(res.statusCode, data?.message || `HTTP ${res.statusCode} ${path}`, data));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout ${path}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function fetchJson(url, { timeout = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (lol-coach)', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} ${url}`);
  return res.json();
}
