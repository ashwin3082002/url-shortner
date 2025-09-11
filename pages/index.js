import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function getServerSideProps({ params }) {
  const { key } = params || {};

  if (!key) {
    // No key provided, show homepage
    return { props: {} };
  }

  const { data, error } = await supabase
    .from('links')
    .select('*')
    .eq('key', key)
    .single();

  if (error || !data) {
    return {
      notFound: true,
    };
  }

  return {
    props: {
      redirectTo: data.redirect_to,
      isRedirect: true,
    },
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

export default function Home({ isRedirect, redirectTo }) {
  if (isRedirect) {
    return <RedirectPage redirectTo={redirectTo} />;
  }

  return (
    <div style={{ textAlign: 'center', paddingTop: '100px' }}>
      <h1>Secure Link Shortener</h1>
      <p>Use the <code>/api/create</code> endpoint to create links.</p>
    </div>
  );
}
