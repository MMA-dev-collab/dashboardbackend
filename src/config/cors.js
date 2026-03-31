const cors = require('cors');
const env = require('./env');

// Support multiple comma-separated origins, e.g.:
// CORS_ORIGIN=http://localhost:5173,https://yourapp.vercel.app
const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow: no origin (server-to-server), whitelisted origins, or any *.vercel.app subdomain
    const isVercel = origin && /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);
    if (!origin || allowedOrigins.includes(origin) || isVercel) {
      callback(null, true);
    } else {
      console.error(`[CORS] Blocked request from origin: ${origin}`);
      callback(new Error(`CORS policy: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

module.exports = cors(corsOptions);
