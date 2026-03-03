# 🎵 RegalosQueCantan

**AI-powered personalized song generator for Latino audiences.**

Create custom songs in Spanish for special occasions. Users get a FREE 10-second preview, then pay $19.99 for the full song.

![RegalosQueCantan Demo](https://via.placeholder.com/800x400?text=RegalosQueCantan+Demo)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Supabase account (free tier works)
- Stripe account
- Kie.ai account (for Suno API)
- Anthropic API key (for Claude)

### 1. Clone and Install

```bash
cd regalosquecantan
npm install
```

### 2. Environment Setup

Create a `.env` file:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# These are for the Edge Functions (set in Supabase dashboard)
# SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
# ANTHROPIC_API_KEY=your_anthropic_key
# KIE_API_KEY=your_kie_api_key
# STRIPE_SECRET_KEY=sk_live_xxx
# STRIPE_WEBHOOK_SECRET=whsec_xxx
# RESEND_API_KEY=re_xxx (optional, for emails)
```

### 3. Supabase Setup

1. Create a new Supabase project
2. Go to SQL Editor and run `supabase/schema.sql`
3. Deploy Edge Functions:

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link project
supabase login
supabase link --project-ref your-project-ref

# Deploy functions
supabase functions deploy generate-song
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook

# Set secrets
supabase secrets set ANTHROPIC_API_KEY=your_key
supabase secrets set KIE_API_KEY=your_key
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set RESEND_API_KEY=re_xxx
```

### 4. Stripe Setup

1. Create a Stripe account at https://stripe.com
2. Get your API keys from Dashboard → Developers → API keys
3. Create a webhook endpoint:
   - URL: `https://your-project.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`
4. Copy the webhook signing secret

### 5. Kie.ai Setup

1. Create account at https://kie.ai
2. Add credits to your account
3. Get API key from dashboard
4. Set as `KIE_API_KEY` in Supabase secrets

### 6. Run Development Server

```bash
npm run dev
```

Open http://localhost:5173

### 7. Deploy to Production

**Vercel (recommended):**
```bash
npm install -g vercel
vercel
```

**Netlify:**
```bash
npm run build
# Upload dist/ folder to Netlify
```

---

## 📁 Project Structure

```
regalosquecantan/
├── src/
│   ├── App.jsx              # Main app with routing
│   ├── main.jsx             # Entry point
│   ├── index.css            # Tailwind + custom styles
│   ├── components/
│   │   ├── Header.jsx       # Navigation header
│   │   └── ProgressBar.jsx  # Step progress indicator
│   ├── pages/
│   │   ├── LandingPage.jsx  # Homepage
│   │   ├── GenreStep.jsx    # Step 1: Genre selection
│   │   ├── OccasionStep.jsx # Step 2: Occasion selection
│   │   ├── NamesStep.jsx    # Step 3: Names input
│   │   ├── DetailsStep.jsx  # Step 4: Personal details
│   │   ├── EmailStep.jsx    # Step 5: Email & confirm
│   │   ├── GeneratingPage.jsx # AI generation animation
│   │   ├── PreviewPage.jsx  # Audio preview + purchase
│   │   └── SuccessPage.jsx  # Post-purchase success
│   └── services/
│       └── api.js           # API calls
├── supabase/
│   ├── schema.sql           # Database schema
│   └── functions/
│       ├── generate-song/   # Claude + Kie.ai integration
│       ├── create-checkout/ # Stripe checkout
│       └── stripe-webhook/  # Payment processing
├── package.json
├── tailwind.config.js
├── vite.config.js
└── README.md
```

---

## 🎨 Design System

**Colors:**
- Primary (Gold): `#d4af35`
- Bougainvillea (Pink CTA): `#E11D74`
- Forest (Green): `#1A4338`
- Background Light: `#FDFCFB`
- Background Dark: `#0F1211`

**Fonts:**
- Display: Playfair Display
- Body: Be Vietnam Pro

**Components:**
- Glassmorphism cards
- Gold accent borders on selection
- Smooth page transitions
- Animated progress indicators

---

## 💰 Pricing & Costs

| Item | Cost |
|------|------|
| Kie.ai (V4.5) | ~$0.05/song |
| Claude API | ~$0.01/song |
| Supabase | Free tier |
| Stripe | 2.9% + $0.30 |
| **Total Cost** | **~$0.65/song** |
| **Selling Price** | **$19.99** |
| **Profit** | **~$19.34** |
| **Margin** | **~97%** |

---

## 🎵 Supported Genres

1. 🤠 **Corrido** - Epic storytelling
2. 🪗 **Norteño** - Accordion soul
3. 🎺 **Banda** - Brass power
4. 💃 **Cumbia** - Dance celebration
5. 🎸 **Ranchera** - Mexican tradition
6. ❤️ **Balada** - Romantic ballad
7. 🔥 **Reggaetón** - Urban energy
8. 🎹 **Salsa** - Caribbean flavor

---

## 🎁 Supported Occasions

- 🎂 Cumpleaños
- 💍 Aniversario
- 💕 Declaración de Amor
- 🙏 Pedir Perdón
- 🎓 Graduación
- 👑 Quinceañera
- 💒 Boda
- 🌹 Día de las Madres
- 👔 Día del Padre
- 🤝 Amistad
- 💪 Motivación
- ✨ Otro

---

## 🔧 API Reference

### Generate Song
```javascript
POST /functions/v1/generate-song
{
  "genre": "cumbia",
  "occasion": "cumpleanos",
  "recipientName": "María",
  "senderName": "Juan",
  "relationship": "esposa",
  "details": "Nos conocimos en Guadalajara...",
  "email": "juan@email.com"
}
```

### Create Checkout
```javascript
POST /functions/v1/create-checkout
{
  "songId": "uuid",
  "email": "juan@email.com"
}
```

---

## 🐛 Troubleshooting

**Song generation fails:**
- Check Kie.ai API key and credits
- Verify Claude API key
- Check Supabase function logs

**Payment not processing:**
- Verify Stripe webhook secret
- Check webhook endpoint URL
- Ensure events are configured

**Audio not playing:**
- Check CORS on Supabase storage
- Verify bucket is public
- Check audio URL in database

---

## 📄 License

MIT License - feel free to use this for your own projects!

---

## 🙏 Credits

- **Suno AI** via Kie.ai for music generation
- **Claude** by Anthropic for lyrics
- **Stripe** for payments
- **Supabase** for backend
- **Tailwind CSS** for styling

---

Made with ❤️ in México 🇲🇽
