import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

// Initialize Supabase client
const supabase = createClient(
  process.env.DATABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// Server-side logic
export async function getServerSideProps({ params }) {
  const { key } = params || {};
  console.log('[Redirect] Received key param:', key);

  if (!key) {
    return { notFound: true };
  }

  const { data, error } = await supabase
    .from('links')
    .select('redirect_to')
    .eq('key', key)
    .single();

  if (error || !data) {
    console.warn(`[Redirect] No redirect found for key "${key}"`);
    return { notFound: true };
  }

  return {
    props: {
      redirectTo: data.redirect_to,
    },
  };
}

// Client-side redirect page
export default function RedirectPage({ redirectTo }) {
  const [countdown, setCountdown] = useState(5);
  const [isTrustedDomain, setIsTrustedDomain] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const allowedDomains = (process.env.ALLOWED_DOMAINS || '')
    .split(',')
    .map(domain => domain.trim());
  const redirectHostname = new URL(redirectTo).hostname || '';

  useEffect(() => {
    const trusted = allowedDomains.includes(redirectHostname);
    setIsTrustedDomain(trusted);

    if (!trusted && !isConfirmed) return;

    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          window.location.href = redirectTo;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [redirectTo, isConfirmed]);

  const handleConfirm = () => {
    setIsConfirmed(true);
  };

  return (
    <div style={styles.container}>
      <h2>You are being redirected to:</h2>
      <p>
        <span style={styles.link} className="tooltip">
          {redirectHostname}
          <span className="tooltip-text">{redirectTo}</span>
        </span>
      </p>

      <p>
        Domain Status:{' '}
        <span style={isTrustedDomain ? styles.trusted : styles.untrusted}>
          {isTrustedDomain ? '✅ Trusted' : '⚠️ Untrusted'}
        </span>
      </p>

      {!isTrustedDomain && !isConfirmed ? (
        <div style={styles.warningBox}>
          <p>
            This domain is not verified. Proceed only if you trust the
            destination.
          </p>
          <button style={styles.button} onClick={handleConfirm}>
            Proceed Anyway
          </button>
        </div>
      ) : (
        <p>
          Redirecting in <strong>{countdown}</strong>{' '}
          second{countdown !== 1 ? 's' : ''}…
        </p>
      )}

      {/* Tooltip styles */}
      <style jsx>{`
        .tooltip {
          position: relative;
          display: inline-block;
          cursor: pointer;
        }

        .tooltip-text {
          visibility: hidden;
          max-width: 90vw; /* responsive width */
          background-color: #333;
          color: #fff;
          text-align: left;
          border-radius: 6px;
          padding: 8px 12px;
          position: absolute;
          z-index: 10;
          top: 125%; /* show below */
          left: 50%;
          transform: translateX(-50%);
          opacity: 0;
          transition: opacity 0.3s;
          font-size: 14px;
          word-break: break-all;
          white-space: normal;
        }

        .tooltip-text::after {
          content: '';
          position: absolute;
          bottom: 100%; /* arrow points up */
          left: 50%;
          margin-left: -5px;
          border-width: 5px;
          border-style: solid;
          border-color: transparent transparent #333 transparent;
        }

        .tooltip:hover .tooltip-text {
          visibility: visible;
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

// Inline styles for simplicity
const styles = {
  container: {
    textAlign: 'center',
    paddingTop: '100px',
    fontFamily: `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`,
    maxWidth: '600px',
    margin: '0 auto',
    color: '#333',
  },
  link: {
    fontSize: '18px',
    color: '#0070f3',
    textDecoration: 'underline',
    wordBreak: 'break-all',
  },
  trusted: {
    color: 'green',
    fontWeight: 'bold',
  },
  untrusted: {
    color: 'red',
    fontWeight: 'bold',
  },
  warningBox: {
    backgroundColor: '#fff3cd',
    border: '1px solid #ffeeba',
    padding: '20px',
    borderRadius: '5px',
    marginTop: '20px',
  },
  button: {
    backgroundColor: '#0070f3',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    fontSize: '16px',
    marginTop: '10px',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};
