'use strict';

// Google sign-in for a desktop app: opens the system browser and receives the result on a
// temporary 127.0.0.1 address (OAuth "loopback" flow with PKCE).

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell, safeStorage } = require('electron');

const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const SCOPES = ['openid', 'email', TASKS_SCOPE];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function loadClientConfig() {
  if (process.env.GOOGLE_CLIENT_ID) {
    return { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || '' };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'google.json'), 'utf8'));
    if (cfg.client_id) return cfg;
  } catch {}
  return null;
}

function createAuth(userDataDir) {
  const tokenFile = path.join(userDataDir, 'google-auth.json');
  const client = loadClientConfig();
  let session = null; // { refresh_token, email, access_token, expires_at }

  function persist() {
    if (!session) {
      try { fs.unlinkSync(tokenFile); } catch {}
      return;
    }
    const payload = JSON.stringify({ refresh_token: session.refresh_token, email: session.email });
    const data = safeStorage.isEncryptionAvailable()
      ? { enc: true, data: safeStorage.encryptString(payload).toString('base64') }
      : { enc: false, data: payload };
    fs.writeFileSync(tokenFile, JSON.stringify(data), { mode: 0o600 });
  }

  function restore() {
    try {
      const raw = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      const payload = raw.enc ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data;
      session = JSON.parse(payload);
    } catch {
      session = null;
    }
  }
  restore();

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, ...params }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error_description || json.error || `Token request failed (${res.status})`);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  async function fetchEmail(accessToken) {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok ? (await res.json()).email : null;
  }

  function signIn() {
    if (!client) return Promise.reject(new Error('Google sync isn\'t set up in this build'));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404).end(); return; }
        const done = (msg) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Daily scheduler</title><body style="font-family:sans-serif;padding:40px">${msg}</body>`);
          clearTimeout(timeout);
          server.close();
        };
        if (url.searchParams.get('state') !== state) { done('Sign-in failed. Try again from the app.'); reject(new Error('Sign-in failed')); return; }
        const code = url.searchParams.get('code');
        if (!code) { done('Sign-in was cancelled. You can close this tab.'); reject(new Error('Sign-in was cancelled')); return; }
        try {
          const tok = await tokenRequest({
            code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
          });
          // Google lets people untick individual permissions; without Tasks access sync can't work.
          if (!String(tok.scope || '').split(' ').includes(TASKS_SCOPE)) {
            fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.refresh_token || tok.access_token)}`, { method: 'POST' }).catch(() => {});
            done('Daily scheduler needs access to Google Tasks to sync. Go back to the app, choose Sign in with Google again, and tick the box that allows access to your tasks.');
            reject(new Error('Google Tasks access wasn\'t allowed. Sign in again and tick the box for your tasks.'));
            return;
          }
          session = {
            refresh_token: tok.refresh_token,
            access_token: tok.access_token,
            expires_at: Date.now() + (tok.expires_in - 60) * 1000,
          };
          session.email = await fetchEmail(tok.access_token);
          persist();
          done('Signed in. You can close this tab and go back to Daily scheduler.');
          resolve(session.email);
        } catch (err) {
          done('Sign-in failed. Try again from the app.');
          reject(err);
        }
      });
      let redirectUri;
      const timeout = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out')); }, 5 * 60 * 1000);
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
        shell.openExternal(url.toString());
      });
    });
  }

  async function accessToken() {
    if (!session) throw new Error('Not signed in');
    if (session.access_token && Date.now() < session.expires_at) return session.access_token;
    try {
      const tok = await tokenRequest({ refresh_token: session.refresh_token, grant_type: 'refresh_token' });
      session.access_token = tok.access_token;
      session.expires_at = Date.now() + (tok.expires_in - 60) * 1000;
      return session.access_token;
    } catch (err) {
      if (err.code === 'invalid_grant') {
        // Google revoked or expired the sign-in; ask the person to sign in again.
        session = null;
        persist();
        throw new Error('Your Google sign-in expired. Sign in again.');
      }
      throw err;
    }
  }

  async function signOut() {
    if (session?.refresh_token) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.refresh_token)}`, { method: 'POST' }).catch(() => {});
    }
    session = null;
    persist();
  }

  return {
    configured: !!client,
    get signedIn() { return !!session; },
    get email() { return session?.email || null; },
    signIn, signOut, accessToken,
  };
}

module.exports = { createAuth };
