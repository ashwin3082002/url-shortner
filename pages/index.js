import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --------- Basic Rate Limit Middleware ---------
export async function middleware(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (!global.rateLimit) global.rateLimit = {};
  const now = Date.now();
  global.rateLimit[ip] = global.rateLimit[ip]?.filter(ts => now - ts < 60000) || [];
  if (global.rateLimit[ip].length >= 10) {
    res.status(429).json({ error: 'Too many requests' });
    return true;
  }
  global.rateLimit[ip].push(now);
  return false;
}

// --------- Turnstile Validation ---------
async function validateTurnstile(token, remoteip) {
  const formData = new URLSearchParams();
  formData.append('secret', process.env.TURNSTILE_SECRET_KEY);
  formData.append('response', token);
  if (remoteip) formData.append('remoteip', remoteip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    });

    const result = await response.json();
    return result;
  } catch (err) {
    console.error('Turnstile error:', err);
    return { success: false };
  }
}

// --------- API Route ---------
export async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const throttled = await middleware(req, res);
  if (throttled) return;

  const { api_key, key, redirect_to, captcha_token } = req.body;
  const origin = req.headers.origin || '';
  const trustedOrigins = (process.env.TRUSTED_ORIGINS || '').split(',');
  const allowedDomains = (process.env.ALLOWED_DOMAINS || '').split(',');
  const validApiKeys = (process.env.API_KEYS || '').split(',');

  // ---- Origin Check ----
  if (!trustedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }

  // ---- CAPTCHA (Cloudflare Turnstile) ----
  const remoteip =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress;

  const captchaResult = await validateTurnstile(captcha_token, remoteip);
  if (!captchaResult.success) {
    return res.status(400).json({ error: 'Invalid CAPTCHA', details: captchaResult['error-codes'] });
  }

  // ---- API Key Check ----
  if (!validApiKeys.includes(api_key)) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  // ---- Validate redirect_to URL ----
  let url;
  try {
    url = new URL(redirect_to);
    if (!allowedDomains.includes(url.hostname)) {
      return res.status(400).json({ error: 'Redirect domain not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Malformed redirect_to' });
  }

  // ---- Validate key ----
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }

  // ---- Check for existing redirect_to ----
  const existingRedirect = await supabase
    .from('links')
    .select('*')
    .eq('redirect_to', redirect_to)
    .single();

  if (existingRedirect.data) {
    return res.status(200).json({
      short_url: `https://${req.headers.host}/${existingRedirect.data.key}`,
      redirect_to
    });
  }

  // ---- Check if key is taken ----
  const existingKey = await supabase
    .from('links')
    .select('id')
    .eq('key', key)
    .single();

  if (existingKey.data) {
    return res.status(400).json({ error: 'Key already exists' });
  }

  // ---- Insert ----
  const insert = await supabase.from('links').insert([{ key, redirect_to }]);
  if (insert.error) {
    return res.status(500).json({ error: 'Failed to create short link' });
  }

  res.status(200).json({
    short_url: `https://${req.headers.host}/${key}`,
    redirect_to
  });
}

// --------- SSR Redirect Handler ---------
export async function getServerSideProps({ params }) {
  const { key } = params || {};

  const { data, error } = await supabase
    .from('links')
    .select('*')
    .eq('key', key)
    .single();

  if (error || !data) {
    return {
      notFound: true
    };
  }

  return {
    props: {
      redirectTo: data.redirect_to
    }
  };
}

export function RedirectPage({ redirectTo }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.href = redirectTo;
    }, 5000);
    return () => clearTimeout(timer);
  }, [redirectTo]);

  return (
    <div style={{ textAlign: 'center', paddingTop: '100px' }}>
      <h2>You are being redirected to:</h2>
      <p><a href={redirectTo}>{redirectTo}</a></p>
      <p>Redirecting in 5 seconds...</p>
    </div>
  );
}

// --------- Main Page ---------
export default function Home(props) {
  if (props.isRedirect) {
    return <RedirectPage redirectTo={props.redirectTo} />;
  }

  return (
    <div style={{ textAlign: 'center', paddingTop: '100px' }}>
      <h1>Secure Link Shortener</h1>
      <p>Use the <code>/api/create</code> endpoint to create links.</p>
    </div>
  );
}

// --------- Dispatcher ---------
Home.getInitialProps = async (ctx) => {
  const { req, res, query } = ctx;

  if (req.method === 'POST' && req.url === '/api/create') {
    req.body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(JSON.parse(data)));
    });
    await handler(req, res);
    return {};
  }

  const key = ctx.query?.key;
  if (key) {
    ctx.params = { key };
    const props = await getServerSideProps(ctx);
    if (props.notFound) {
      res.statusCode = 404;
      res.end('Link not found');
      return {};
    }
    return { ...props.props, isRedirect: true };
  }

  return {};
};

Home.getInitialProps.displayName = 'RouteHandler';
