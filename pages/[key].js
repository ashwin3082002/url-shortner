import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function getServerSideProps({ params }) {
  const { key } = params;

  const { data, error } = await supabase
    .from('links')
    .select('redirect_to')
    .eq('key', key)
    .single();

  if (error || !data) {
    return { notFound: true };
  }

  return {
    props: { redirectTo: data.redirect_to }
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
