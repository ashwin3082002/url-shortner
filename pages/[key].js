import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function getServerSideProps({ params }) {
  const { key } = params || {};
  console.log('[Redirect] Received key param:', key);

  if (!key) {
    console.warn('[Redirect] No key provided in params');
    return { notFound: true };
  }

  const { data, error } = await supabase
    .from('links')
    .select('redirect_to')
    .eq('key', key)
    .single();

  console.log('[Redirect] Supabase query error:', error);
  console.log('[Redirect] Supabase query data:', data);

  if (error || !data) {
    console.warn(`[Redirect] No redirect found for key "${key}"`);
    return { notFound: true };
  }

  return {
    props: {
      redirectTo: data.redirect_to
    }
  };
}

export default function RedirectPage({ redirectTo }) {
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    // Countdown timer
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          window.location.href = redirectTo;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval); // Cleanup
  }, [redirectTo]);

  return (
    <div style={{ textAlign: 'center', paddingTop: '100px' }}>
      <h2>You are being redirected to:</h2>
      <p><a href={redirectTo}>{redirectTo}</a></p>
      <p>Redirecting in <strong>{countdown}</strong> second{countdown !== 1 ? 's' : ''}…</p>
    </div>
  );
}
}
