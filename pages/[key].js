import { createClient } from '@supabase/supabase-js';

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
  return (
    <div style={{ textAlign: 'center', paddingTop: '100px' }}>
      <h2>You are being redirected to:</h2>
      <p><a href={redirectTo}>{redirectTo}</a></p>
      <p>Redirecting now…</p>
    </div>
  );
}
