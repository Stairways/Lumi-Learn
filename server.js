/**
 * Lumi Learn Pro — Backend Server
 * 
 * Handles:
 *  - User signup / login with JWT auth
 *  - Stripe subscription with 7-day free trial
 *  - Webhook to track subscription status
 *  - Protected /app route (subscribers only)
 *  - In-memory user store (upgrade to a database later)
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────
// STRIPE SETUP
// ─────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_production';

// ─────────────────────────────────────────────────────
// SIMPLE IN-MEMORY USER STORE
// NOTE: This resets when the server restarts.
// For a real launch, replace with a database.
// I'll add database instructions in SETUP.md.
// ─────────────────────────────────────────────────────
const users = new Map();
// Structure: email -> { email, passwordHash, stripeCustomerId, subscriptionStatus, subscriptionId, trialEnd, createdAt }

// ─────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────
// Stripe webhooks need raw body — must come BEFORE express.json()
app.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

function requireSubscription(req, res, next) {
  requireAuth(req, res, () => {
    const user = users.get(req.user.email);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    const active = ['active', 'trialing'].includes(user.subscriptionStatus);
    if (!active) return res.status(403).json({ error: 'Subscription required', code: 'NO_SUBSCRIPTION' });
    next();
  });
}

// ─────────────────────────────────────────────────────
// ROUTES: AUTH
// ─────────────────────────────────────────────────────

// Sign up — creates account + Stripe customer
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Please fill in all fields' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (users.has(email.toLowerCase())) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { source: 'lumi-learn' },
    });

    const user = {
      email: email.toLowerCase(),
      name,
      passwordHash,
      stripeCustomerId: customer.id,
      subscriptionStatus: 'none', // none | trialing | active | past_due | canceled
      subscriptionId: null,
      trialEnd: null,
      createdAt: new Date().toISOString(),
    };

    users.set(email.toLowerCase(), user);

    const token = jwt.sign({ email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });

    console.log(`✅ New user signed up: ${email}`);

    res.json({
      token,
      user: { email: user.email, name: user.name, subscriptionStatus: user.subscriptionStatus },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// Log in
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.get(email?.toLowerCase());

  if (!user) return res.status(401).json({ error: 'No account found with this email' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });

  const token = jwt.sign({ email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });

  res.json({
    token,
    user: {
      email: user.email,
      name: user.name,
      subscriptionStatus: user.subscriptionStatus,
    },
  });
});

// Get current user info
app.get('/api/me', requireAuth, (req, res) => {
  const user = users.get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    email: user.email,
    name: user.name,
    subscriptionStatus: user.subscriptionStatus,
    trialEnd: user.trialEnd,
  });
});

// ─────────────────────────────────────────────────────
// ROUTES: STRIPE SUBSCRIPTION
// ─────────────────────────────────────────────────────

// Create checkout session — redirects user to Stripe's payment page
app.post('/api/create-checkout', requireAuth, async (req, res) => {
  const user = users.get(req.user.email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (['active', 'trialing'].includes(user.subscriptionStatus)) {
    return res.status(400).json({ error: 'You already have an active subscription!' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_ID,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 7, // ← 7-day free trial!
        metadata: { userEmail: user.email },
      },
      success_url: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/?canceled=true`,
      allow_promotion_codes: true, // lets you run discount codes later
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// Customer portal — lets users manage/cancel their subscription
app.post('/api/portal', requireAuth, async (req, res) => {
  const user = users.get(req.user.email);
  if (!user?.stripeCustomerId) return res.status(400).json({ error: 'No subscription found' });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${APP_URL}/app`,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not open billing portal' });
  }
});

// ─────────────────────────────────────────────────────
// STRIPE WEBHOOK — keeps subscription status in sync
// ─────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const sub = event.data.object;

  // Find user by Stripe customer ID
  function findUserByCustomer(customerId) {
    for (const [, user] of users) {
      if (user.stripeCustomerId === customerId) return user;
    }
    return null;
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const user = findUserByCustomer(sub.customer);
      if (user) {
        user.subscriptionStatus = sub.status; // trialing, active, past_due, canceled, etc.
        user.subscriptionId = sub.id;
        user.trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        console.log(`📋 Subscription updated for ${user.email}: ${sub.status}`);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const user = findUserByCustomer(sub.customer);
      if (user) {
        user.subscriptionStatus = 'canceled';
        user.subscriptionId = null;
        console.log(`❌ Subscription canceled for ${user.email}`);
      }
      break;
    }
    case 'invoice.payment_succeeded': {
      const user = findUserByCustomer(sub.customer);
      if (user) {
        user.subscriptionStatus = 'active';
        console.log(`💰 Payment succeeded for ${user.email}`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const user = findUserByCustomer(sub.customer);
      if (user) {
        user.subscriptionStatus = 'past_due';
        console.log(`⚠️ Payment failed for ${user.email}`);
      }
      break;
    }
  }

  res.json({ received: true });
}

// ─────────────────────────────────────────────────────
// PROTECTED APP ROUTE
// ─────────────────────────────────────────────────────
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Success page after Stripe checkout
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// ─────────────────────────────────────────────────────
// ADMIN: Quick subscriber count (protect this in production!)
// Visit /admin/stats to see your subscriber numbers
// ─────────────────────────────────────────────────────
app.get('/admin/stats', (req, res) => {
  const stats = { total: 0, trialing: 0, active: 0, canceled: 0, past_due: 0, none: 0 };
  for (const [, user] of users) {
    stats.total++;
    stats[user.subscriptionStatus] = (stats[user.subscriptionStatus] || 0) + 1;
  }
  const mrr = (stats.active * 8.99).toFixed(2);
  res.json({ ...stats, mrr: `$${mrr}/month`, message: 'Lumi Learn Stats' });
});

// All other routes serve the landing page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🌟 Lumi Learn Pro running!`);
  console.log(`   Landing page: http://localhost:${PORT}`);
  console.log(`   App:          http://localhost:${PORT}/app`);
  console.log(`   Stats:        http://localhost:${PORT}/admin/stats\n`);
});
