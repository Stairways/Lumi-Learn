# Lumi Learn Pro — Setup Guide
## From zero to taking payments in about 30 minutes

---

## STEP 1 — Sign Up for Stripe

1. Go to **stripe.com** and create a free account
2. You don't need to verify your bank yet — you can test everything first
3. Once inside, make sure you're in **TEST MODE** (toggle in the top left — should say "Test mode")

---

## STEP 2 — Create Your Subscription Product in Stripe

1. In Stripe dashboard, click **Products** in the left menu
2. Click **+ Add product**
3. Fill in:
   - **Name:** Lumi Learn Family
   - **Description:** Full access to all learning content
4. Under **Pricing**, click **Add a price**:
   - **Pricing model:** Standard pricing
   - **Price:** $8.99
   - **Billing period:** Monthly
   - **Trial period:** Leave blank (we handle this in code)
5. Click **Save product**
6. Click on the price you just created — copy the **Price ID** (starts with `price_`)
   - You'll need this in Step 4!

---

## STEP 3 — Get Your Stripe API Keys

1. In Stripe, click **Developers** → **API keys**
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)
4. Keep these safe — never share the secret key!

---

## STEP 4 — Create Your .env File

1. In your project folder, find the file called `.env.example`
2. Make a copy and rename it to `.env` (just `.env`, nothing else)
3. Fill in your values:

```
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
STRIPE_PRICE_ID=price_YOUR_PRICE_ID_HERE
JWT_SECRET=make_up_any_long_random_string_here_lumilearn2026
APP_URL=http://localhost:3000
```

---

## STEP 5 — Test Locally on Windows

Open **Command Prompt** and navigate to your project folder:

```
npm install
npm start
```

Visit http://localhost:3000 — you should see the landing page!

**Test the signup flow:**
1. Click "Start Free Trial"
2. Create a test account
3. You'll be sent to Stripe's checkout page
4. Use test card number: **4242 4242 4242 4242**
   - Expiry: any future date (e.g. 12/28)
   - CVC: any 3 digits (e.g. 123)
5. You should land on the success page and be redirected to the app!

---

## STEP 6 — Deploy to Vercel

### 6a. Push to GitHub

1. Create a new GitHub repo called `lumi-learn-pro`
2. Upload all files EXCEPT `.env` and `node_modules`
   - Upload: server.js, package.json, vercel.json, .gitignore, .env.example
   - Create the `public/` folder and upload: index.html, app.html, success.html

### 6b. Deploy on Vercel

1. Go to **vercel.com** → **Add New Project**
2. Import your `lumi-learn-pro` GitHub repo
3. **IMPORTANT** — Before clicking Deploy, click **Environment Variables** and add:
   - `STRIPE_SECRET_KEY` = your sk_test_ key
   - `STRIPE_PRICE_ID` = your price_ id
   - `JWT_SECRET` = your random string
   - `APP_URL` = https://your-vercel-url.vercel.app (you'll update this after first deploy)
4. Click **Deploy**
5. Once deployed, copy your Vercel URL (e.g. lumi-learn-pro.vercel.app)
6. Go back to Vercel → Settings → Environment Variables → update `APP_URL` to your real URL
7. Redeploy

---

## STEP 7 — Set Up Stripe Webhook (Important!)

The webhook keeps subscription status updated (trial → active → canceled).

1. In Stripe dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://your-vercel-url.vercel.app/webhook`
4. Select events to listen for:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)
7. Add it to Vercel environment variables as `STRIPE_WEBHOOK_SECRET`
8. Redeploy

---

## STEP 8 — Go Live!

When you're ready to take real payments:
1. In Stripe, toggle from **Test mode** to **Live mode**
2. Get your LIVE API keys (starts with `sk_live_` and `pk_live_`)
3. Create the same product/price in Live mode
4. Update your Vercel environment variables with the live keys
5. Redeploy one final time

---

## UPGRADING TO A DATABASE (When You Have 50+ Users)

The current server uses in-memory storage — users are lost when the server restarts.
For a real production app, add a database:

**Easiest option: Supabase (free tier)**
1. Sign up at supabase.com
2. Create a table called `users` with columns:
   email, name, password_hash, stripe_customer_id, subscription_status, subscription_id, trial_end, created_at
3. Use the Supabase JS SDK to replace the `users` Map in server.js

I can build this upgrade for you when you're ready!

---

## YOUR REVENUE MATH

| Subscribers | Monthly Revenue |
|------------|----------------|
| 50         | $449.50/mo      |
| 100        | $899/mo         |
| 250        | $2,247.50/mo    |
| 500        | $4,495/mo       |
| 1,000      | $8,990/mo       |

Stripe takes ~2.9% + $0.30 per transaction.

---

## QUESTIONS?

Build the database upgrade, add more content, or add more features anytime!
