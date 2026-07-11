const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const verificationRoutes = require('./routes/verification');
const meetingRoutes = require('./routes/meetings');
const taskRoutes = require('./routes/tasks');
const settingsRoutes = require('./routes/settings');
const voiceRoutes = require('./routes/voice');
const notificationRoutes = require('./routes/notifications');

const app = express();

// Trust proxy (Render, nginx, etc.) so rate-limiter respects real client IP
app.set('trust proxy', 1);

// ─── CORS ────────────────────────────────────────────────────────────────────
// Allow Flutter web (localhost), Android emulator (10.0.2.2), and any origin
// in development. Tighten this in production.
const allowedOrigins = [
  'http://localhost',
  'http://localhost:5000',
  'http://10.0.2.2:5000',
  'https://mypa-backend.onrender.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV === 'development'
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ─── Body parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ───────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

module.exports = app;
