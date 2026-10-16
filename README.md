# 🌾 Farmlink: AI-Powered Agri Marketplace

> A digital marketplace that connects farmers and FPOs (Farmer Producer Organisations) directly with buyers, cutting out intermediaries from the agricultural supply chain.

**Live demo:** [[Live Demo](https://framlink-sih.web.app/)]  |  **Demo video:** [Demo](https://www.youtube.com/watch?v=8h3LLuLtHIs)]

**Smart India Hackathon:**

<!--![Farmlink screenshot](./docs/screenshot.png)-->
<!-- TODO: add 1-2 screenshots to a /docs folder and update the path above -->

---

## The Problem

Small farmers often sell through multiple middlemen and receive only a fraction of the final price. Many also lack smartphones, which keeps them out of digital marketplaces entirely.

## The Solution

Farmlink lets farmers and FPOs list produce and sell directly to buyers. It adds three things that make that practical:

- **AI demand forecasting** so sellers know when and what to sell.
- **Route optimization** so produce gets delivered efficiently.
- **An AI voice agent** so farmers without smartphones can list produce over a phone call.

## Features

- **Direct marketplace:** farmers, FPOs, and buyers connect without intermediaries
- **Role-based access:** separate experiences for farmers, FPOs, and buyers, secured with Firebase Auth and Firestore security rules
- **Demand and price forecasting:** XGBoost models predict market demand (see `mandi-price-forecast/`)
- **Route optimization:** delivery routing with Google OR-Tools on OpenStreetMap data, visualised with Leaflet.js (see `farmlink-route-bot/`)
- **Voice-based listing:** speech-to-text, GPT-4.1, and text-to-speech let farmers create listings by phone call

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React, Leaflet.js |
| Backend | Python, FastAPI, Node.js |
| Database & Auth | Firebase (Auth, Firestore, Storage, Hosting) |
| ML / Optimization | XGBoost, Google OR-Tools |
| Maps | OpenStreetMap |
| AI / Voice | STT, GPT-4.1, TTS |
| Deployment | Vercel, Firebase Hosting |

<!-- TODO: edit this table so it matches exactly what is in the repo -->

## Architecture

```
[ Farmer / FPO / Buyer ]
          |
     React frontend  ----  Firebase Auth
          |
   FastAPI / Node.js backend ---- Firestore + Storage
      |           |                    |
 Price forecast   Route optimizer   Voice agent
  (XGBoost)       (OR-Tools + OSM)  (STT -> GPT-4.1 -> TTS)
```

<!-- TODO: replace this with a real diagram if you have one -->

## Project Structure

```
farmlink/
├── public/                  # Frontend static assets
├── farmlink-route-bot/      # Route optimization module
├── mandi-price-forecast/    # Demand / price forecasting models
├── firestore.rules          # Firestore security rules
├── firestore.indexes.json   # Firestore indexes
├── firebase.json            # Firebase config
├── vercel.json              # Vercel deployment config
├── index.js                 # Server entry point
└── .env.example             # Required environment variables
```

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- A Firebase project (Auth + Firestore enabled)
- API keys for the voice agent (see `.env.example`)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/Happy-devloper/farmlink.git
cd farmlink

# 2. Install Node dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Fill in your Firebase and API keys in .env

# 4. Run the app
npm start
```

### Running the Python modules

```bash
cd mandi-price-forecast
pip install -r requirements.txt
# [ADD the command that runs the forecasting module]

cd ../farmlink-route-bot
pip install -r requirements.txt
# [ADD the command that runs the route module]
```

<!-- TODO: verify every command above and fix anything that doesn't match your setup -->

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Description |
|----------|-------------|
| `[VARIABLE_NAME]` | [What it's for] |

<!-- TODO: list the variables from your .env.example. Never commit your real .env -->

## Roadmap

- [ ] Multilingual voice support (Hindi and regional languages)
- [ ] Buyer ratings and verified FPO profiles
- [ ] Payment integration
- [ ] Mobile app

<!-- TODO: edit to reflect your real plans -->

## Team

Built for Smart India Hackathon by:

- **Ravi Srivastava** ([@Happy-devloper](https://github.com/Happy-devloper)): [backend, APIs, frontend]
- **Shivam Srivastava** : [Team Leader]
- **Tanishque Gupta** : [AI itegration and Presentation]
- **Ashutosh Srivastava** : [RESEARCH AND REFERENCES]
- **Ashish Singh** : [RESEARCH AND REFERENCES]
