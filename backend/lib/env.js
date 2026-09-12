// Fail loudly at first use rather than producing confusing 500s later.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} — see backend/.env.example`);
  }
  return value;
}

export const env = {
  get mongoUri() {
    return required('MONGODB_URI');
  },
  get mongoDb() {
    return process.env.MONGODB_DB || 'buddy';
  },
  get googleClientId() {
    return required('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret() {
    return required('GOOGLE_CLIENT_SECRET');
  },
  get redirectUri() {
    return required('OAUTH_REDIRECT_URI');
  },
  get sessionSecret() {
    const secret = required('SESSION_SECRET');
    if (secret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters — generate with: openssl rand -base64 48');
    }
    return secret;
  },
  get allowedDomains() {
    return (process.env.ALLOWED_EMAIL_DOMAINS || 'andrew.cmu.edu,cmu.edu')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  },
  get appOrigin() {
    return process.env.APP_ORIGIN || 'http://localhost:5173';
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
};
