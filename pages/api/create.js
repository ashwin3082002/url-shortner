import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Basic in-memory rate limiter (resets on server restart)
const rateLimitStore = {};

async function rateLimit(req, res) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!rateLimitStore[ip]) rateLimitStore[ip] = [];

  const now = Date.now();
  // Keep only requests in last 60 seconds
  rateLimitStore[ip] = rateLimitStore[ip].filter(ts => now - ts < 60000);

  if (rateLimitStore[ip].length >= 10) {
    res.status(429).json({ error: 'Too many requests' });
    return true;
  }

  rateLimitStore[ip].push(now);
  return false;
}

async function validateTurnstile(token, remoteip) {
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
    return result;
  } catch (error) {
    console.error('Turnstile validation error:', error);
    return { success: false };
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
const trustedOrigins = (process.env.TRUSTED_ORIGINS || '').split(',');

// Handle CORS preflight request
if (req.method === 'OPTIONS') {
  if (trustedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
    return;
  } else {
    res.status(403).end();
    return;
  }
}

// For actual POST requests, add CORS header if origin is trusted
if (trustedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
} else {
  return res.status(403).json({ error: 'Untrusted origin' });
}

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (await rateLimit(req, res)) {
    return;
  }

  const { api_key, key, redirect_to, captcha_token } = req.body;

  const origin = req.headers.origin || '';
  const trustedOrigins = (process.env.TRUSTED_ORIGINS || '').split(',');
  const allowedDomains = (process.env.ALLOWED_DOMAINS || '').split(',');
  const validApiKeys = (process.env.API_KEYS || '').split(',');

  // Origin check
  if (!trustedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Untrusted origin' });
  }

  // CAPTCHA check
  const remoteip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const captchaResult = await validateTurnstile(captcha_token, remoteip);
  if (!captchaResult.success) {
    return res.status(400).json({ error: 'Invalid CAPTCHA', details: captchaResult['error-codes'] });
  }

  // API key check
  if (!validApiKeys.includes(api_key)) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  // Validate redirect_to URL and domain
  let url;
  try {
    url = new URL(redirect_to);
    if (!allowedDomains.includes(url.hostname)) {
      return res.status(400).json({ error: 'Redirect domain not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Malformed redirect_to URL' });
  }

  // Validate key format
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }

  // Check if redirect_to already exists
  const { data: existingRedirect } = await supabase
    .from('links')
    .select('*')
    .eq('redirect_to', redirect_to)
    .single();

  if (existingRedirect) {
    return res.status(200).json({
      short_url: `https://${req.headers.host}/${existingRedirect.key}`,
      redirect_to,
    });
  }

  // Check if key already taken
  const { data: existingKey } = await supabase
    .from('links')
    .select('id')
    .eq('key', key)
    .single();

  if (existingKey) {
    return res.status(400).json({ error: 'Key already exists' });
  }

  // Insert new short link
  const { error: insertError } = await supabase.from('links').insert([{ key, redirect_to }]);
  if (insertError) {
    return res.status(500).json({ error: 'Failed to create short link' });
  }

  return res.status(200).json({
    short_url: `https://${req.headers.host}/${key}`,
    redirect_to,
  });
}
