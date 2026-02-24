import type { Browser } from 'playwright';
import type { Site } from '../types';

export interface AuthContext {
  headers?: Record<string, string>;
  storageState?: string;       // serialised Playwright storage state JSON
}

export interface ApiKeyCredential {
  header?: string;             // defaults to X-API-Key
  key: string;
}

export interface BasicAuthCredential {
  username: string;
  password: string;
}

export interface LoginFormCredential {
  loginUrl: string;
  usernameField: string;       // CSS selector or name attribute
  passwordField: string;
  username: string;
  password: string;
  waitSelector?: string;       // element to wait for after successful login
}

export interface OAuth2Credential {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  grantType?: 'client_credentials' | 'password';
  username?: string;           // for password grant
  password?: string;
}

/**
 * Produces an AuthContext for the given site's auth_type and auth_credentials.
 * For login_form, a browser instance is required to perform the login.
 */
export async function authenticateSite(
  site: Site,
  browser?: Browser
): Promise<AuthContext> {
  if (site.authType === 'none' || !site.authCredentials) {
    return {};
  }

  switch (site.authType) {
    case 'api_key': {
      const creds = site.authCredentials as unknown as ApiKeyCredential;
      const headerName = creds.header ?? 'X-API-Key';
      return { headers: { [headerName]: creds.key } };
    }

    case 'basic_auth': {
      const creds = site.authCredentials as unknown as BasicAuthCredential;
      const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
      return { headers: { Authorization: `Basic ${encoded}` } };
    }

    case 'login_form': {
      if (!browser) {
        console.warn('[SiteAuth] login_form auth requires a browser — skipping.');
        return {};
      }
      return await loginViaForm(browser, site.authCredentials as unknown as LoginFormCredential);
    }

    case 'oauth2': {
      const creds = site.authCredentials as unknown as OAuth2Credential;
      return await getOAuthToken(creds);
    }

    default:
      return {};
  }
}

async function loginViaForm(
  browser: Browser,
  creds: LoginFormCredential
): Promise<AuthContext> {
  const context = await browser.newContext({
    userAgent: 'WebBridge-Crawler/1.0',
  });
  const page = await context.newPage();

  try {
    console.log(`[SiteAuth] Logging in via form at ${creds.loginUrl}`);
    await page.goto(creds.loginUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Try name= attribute selector first, then id=, then fallback to css selector
    const fill = async (selectorHint: string, value: string) => {
      const selectors = [
        `[name="${selectorHint}"]`,
        `[id="${selectorHint}"]`,
        selectorHint,                    // treat as raw CSS selector
      ];
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) { await el.fill(value); return; }
      }
      throw new Error(`SiteAuth: cannot find field matching "${selectorHint}"`);
    };

    await fill(creds.usernameField, creds.username);
    await fill(creds.passwordField, creds.password);
    await page.click('[type="submit"]');

    if (creds.waitSelector) {
      await page.waitForSelector(creds.waitSelector, { timeout: 15000 });
    } else {
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    }

    const storageState = await context.storageState();
    console.log('[SiteAuth] Login successful — session captured.');
    return { storageState: JSON.stringify(storageState) };
  } finally {
    await page.close();
    await context.close();
  }
}

async function getOAuthToken(creds: OAuth2Credential): Promise<AuthContext> {
  const grantType = creds.grantType ?? 'client_credentials';
  const body: Record<string, string> = {
    grant_type: grantType,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  };
  if (creds.scope) body.scope = creds.scope;
  if (grantType === 'password' && creds.username && creds.password) {
    body.username = creds.username;
    body.password = creds.password;
  }

  const res = await fetch(creds.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; token_type?: string };
  const tokenType = data.token_type ?? 'Bearer';
  console.log(`[SiteAuth] OAuth2 token obtained (${tokenType}).`);
  return { headers: { Authorization: `${tokenType} ${data.access_token}` } };
}
