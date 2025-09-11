import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Basic in-memory rate limiter (resets on server restart)
const rateLimitStore = {};

async function rateLimit(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[RateLimit] IP: ${ip}`);

  if (!rateLimitStore[ip]) rateLimitStore[ip] = [];

  const now = Date.now();
  // Keep only requests in last 60 seconds
  rateLimitStore[ip] = rateLimitStore[ip].filter(ts => now - ts < 60000);

  if (rateLimitStore[ip].length >= 10) {
    console.warn(`[RateLimit] Too many requests from IP: ${ip}`);
    res.status(429).json({ error: 'Too many requests' });
    return true;
  }

  rateLimitStore[ip].push(now);
  console.log(`[RateLimit] Request count for IP ${ip}: ${rateLimitStore[ip].length}`);
  return false;
}

async function validateTurnstile(token, remoteip) {
  console.log('[Turnstile] Validating CAPTCHA token...');
  const formData = new URLSearchParams();
  formData.append('secret', process.env.TURNSTILE_SECRET_KEY);
  formData.append('response', token);
  if (remoteip) formData.append('remoteip', remoteip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    const result = await response.json();
    console.log('[Turnstile] CAPTCHA validation result:', result);
    return result;
  } catch (error) {
    console.error('[Turnstile] Validation error:', error);
    return { success: false };
  }
}

export default async function handler(req, res) {
  console.log(`[Request] Method: ${req.method} Origin: ${req.headers.origin}`);

  const origin = req.headers.origin || '';
  const trustedOrigins = (process.env.TRUSTED_ORIGINS || '').split(',');

  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    console.log('[CORS] Handling OPTIONS preflight...');
    if (trustedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      console.log('[CORS] Preflight allowed');
      return;
    } else {
      console.warn(`[CORS] Preflight denied for origin: ${origin}`);
      res.status(403).end();
      return;
    }
  }

  // For actual POST requests, add CORS header if origin is trusted
  if (trustedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    console.warn(`[CORS] Request denied due to untrusted origin: ${origin}`);
    return res.status(403).json({ error: 'Untrusted origin' });
  }

  if (req.method !== 'POST') {
    console.warn(`[Request] Method not allowed: ${req.method}`);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (await rateLimit(req, res)) {
    console.warn('[Request] Rate limit triggered, request blocked');
    return;
  }

  const { api_key, key, redirect_to, captcha_token } = req.body;
  console.log('[Request] Received body:', { api_key, key, redirect_to, captcha_token: captcha_token ? '***' : null });

  const allowedDomains = (process.env.ALLOWED_DOMAINS || '').split(',');
  const validApiKeys = (process.env.API_KEYS || '').split(',');

  // Origin check (redundant, but just in case)
  if (!trustedOrigins.includes(origin)) {
    console.warn(`[Security] Untrusted origin: ${origin}`);
    return res.status(403).json({ error: 'Untrusted origin' });
  }

  // CAPTCHA check
  const remoteip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[CAPTCHA] Validating CAPTCHA for IP: ${remoteip}`);
  const captchaResult = await validateTurnstile(captcha_token, remoteip);
  if (!captchaResult.success) {
    console.warn('[CAPTCHA] CAPTCHA validation failed:', captchaResult['error-codes']);
    return res.status(400).json({ error: 'Invalid CAPTCHA', details: captchaResult['error-codes'] });
  }
  console.log('[CAPTCHA] CAPTCHA validation successful');

  // API key check
  if (!validApiKeys.includes(api_key)) {
    console.warn(`[Security] Invalid API key: ${api_key}`);
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  console.log('[Security] API key validated');

  // Validate redirect_to URL and domain
  let url;
  try {
    url = new URL(redirect_to);
    console.log(`[URL] Redirect domain: ${url.hostname}`);
    if (!allowedDomains.includes(url.hostname)) {
      console.warn(`[Security] Redirect domain not allowed: ${url.hostname}`);
      return res.status(400).json({ error: 'Redirect domain not allowed' });
    }
  } catch (err) {
    console.warn('[URL] Malformed redirect_to URL:', redirect_to);
    return res.status(400).json({ error: 'Malformed redirect_to URL' });
  }

  // Validate key format
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(key)) {
    console.warn(`[Validation] Invalid key format: ${key}`);
    return res.status(400).json({ error: 'Invalid key format' });
  }

  // Check if redirect_to already exists
  console.log('[DB] Checking if redirect_to URL already exists...');
  const { data: existingRedirect, error: existingRedirectError } = await supabase
    .from('links')
    .select('*')
    .eq('redirect_to', redirect_to)
    .single();

  if (existingRedirectError) {
    console.error('[DB] Error checking existing redirect:', existingRedirectError);
  }
  if (existingRedirect) {
    console.log(`[DB] redirect_to URL exists, returning existing short URL: ${existingRedirect.key}`);
    return res.status(200).json({
      short_url: `https://${req.headers.host}/${existingRedirect.key}`,
      redirect_to,
    });
  }

  // Check if key already taken
  console.log(`[DB] Checking if key "${key}" already exists...`);
  const { data: existingKey, error: existingKeyError } = await supabase
    .from('links')
    .select('id')
    .eq('key', key)
    .single();

  if (existingKeyError) {
    console.error('[DB] Error checking existing key:', existingKeyError);
  }
  if (existingKey) {
    console.warn(`[DB] Key already exists: ${key}`);
    return res.status(400).json({ error: 'Key already exists' });
  }

  // Insert new short link
  console.log(`[DB] Inserting new short link: key=${key}, redirect_to=${redirect_to}`);
  const { error: insertError } = await supabase.from('links').insert([{ key, redirect_to }]);
  if (insertError) {
    console.error('[DB] Failed to create short link:', insertError);
    return res.status(500).json({ error: 'Failed to create short link' });
  }

  console.log('[Success] Short link created successfully');

  return res.status(200).json({
    short_url: `https://${req.headers.host}/${key}`,
    redirect_to,
  });
}
