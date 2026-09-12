// Health check. Confirms the app is running and, more usefully, whether the env
// is actually configured — the two things you want to know before debugging a
// failing sign-in. No secret values are reported, only whether each is present.

export const dynamic = 'force-dynamic';

export default function Home() {
  const checks = [
    ['MONGODB_URI', Boolean(process.env.MONGODB_URI)],
    ['GOOGLE_CLIENT_ID', Boolean(process.env.GOOGLE_CLIENT_ID)],
    ['GOOGLE_CLIENT_SECRET', Boolean(process.env.GOOGLE_CLIENT_SECRET)],
    ['OAUTH_REDIRECT_URI', Boolean(process.env.OAUTH_REDIRECT_URI)],
    ['SESSION_SECRET', (process.env.SESSION_SECRET ?? '').length >= 32],
  ];

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 20 }}>Buddy API</h1>
      <p>Running. Sign-in starts at <code>/api/auth/google</code>.</p>
      <h2 style={{ fontSize: 15, marginTop: 24 }}>Configuration</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {checks.map(([name, present]) => (
          <li key={name}>
            <span style={{ color: present ? '#059669' : '#dc2626' }}>{present ? 'set' : 'MISSING'}</span>
            {' — '}
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 13, color: '#78716c' }}>
        Missing values live in <code>backend/.env.local</code>; see <code>backend/.env.example</code>.
      </p>
    </main>
  );
}
