# Pholio

An iMessage agent, built on [Photon](https://photon.codes), that reads
on-chain wallets Ethereum, Base, Polygon, Robinhood Chain, HyperEVM,
Solana, TON, Bitcoin, and Sui and returns a plain English trading style
read. No slash commands: address in, read out, in plain conversation.

## How it works

Pholio listens on Photon's `app.messages` stream. Every inbound message is
classified by an LLM free regex layer first. address formats that are
unambiguous (Bitcoin, Solana, TON, Sui) resolve instantly; the shared
`0x...` EVM format (Ethereum, Base, Polygon, Robinhood Chain, HyperEVM) is
resolved by querying every candidate chain in parallel via Blockscout and
only asking the user when more than one chain shows real activity. Once a
chain is settled, the relevant API is called live, the raw result is handed
to Gemini for a short trading style summary, and both the raw data and the
summary are persisted to Postgres. A past scan is only ever surfaced as
recall ("last time I checked this...")  a fresh request always re hits the
live APIs.

## Prerequisites

- Node.js 20+ (or Bun)
- A Photon account with a Spectrum project and a cloud iMessage line
  provisioned (no Mac required  this uses `@spectrum-ts/imessage`'s cloud
  provider, not the local macOS one)
- API keys: Blockscout, Helius, TonAPI, Google AI Studio (Gemini)
- A Postgres database (Neon or otherwise)

## Setup

**1. API keys**

| Service | Used for | Console |
|---|---|---|
| Photon / Spectrum | the iMessage line itself | Photon dashboard → project ID + project secret |
| Blockscout | Ethereum, Base, Polygon, Robinhood Chain, HyperEVM | blockscout.com |
| Helius | Solana balances + transactions | dashboard.helius.dev |
| TonAPI | TON balances + activity | tonconsole.com |
| Gemini | personality + trading-style summaries | Google AI Studio |
| Postgres | users, scans, conversation memory | neon.tech or any Postgres host |

Bitcoin (mempool.space) and Sui (public RPC) need no key.

If any key or connection string was ever pasted somewhere other than your
own `.env`  rotate it before deploying.

**2. Install and configure**

```bash
npm install
cp .env.example .env   # fill in every value
npm run db:init         # creates users / messages / scans tables
```

**3. Assets**

Drop the three exported images into `assets/`:
- `pholio_logo.PNG`
- `welcome.PNG`  sent on a person's first ever message
- `reading_data.PNG`  sent while a scan is running

**4. Run locally**

```bash
npm run dev
```

Text the Photon provisioned number to test.

## Deployment

This runs as a persistent Node.js process. the `for await (const [space,
message] of app.messages)` loop holds an open connection to Spectrum. It
does not run on a phone or any client device; it runs on a server, and the
Photon provisioned number is what your phone (or anyone's) texts.

Options, roughly in order of least setup effort for a process like this:

- **Railway** or **Render** — both run a long lived Node process directly
  from a GitHub repo, have a free/hobby tier sufficient for a hackathon
  build, and support environment variables and Postgres add ons natively.
  This is the simplest path: connect the repo, set the `.env` values as
  environment variables, deploy.
- **Fly.io** — similar shape, slightly more configuration (a `fly.toml`),
  useful if you want more control over region/scaling later.
- **A plain VPS** (e.g. a small droplet) with `pm2` or a systemd service
  keeping `npm start` alive  more setup, more control.

Not a fit: Cloudflare Workers or other strict edge/browser style runtimes 
Spectrum's cloud transport requires Node compatible APIs. If you'd rather
run on serverless functions instead of a long lived process, Spectrum also
exposes `app.webhook()` (HMAC-verified HTTP delivery) as an alternative to
the streaming loop that fits Vercel/Node serverless functions, but is a
different integration shape than what's wired up in `src/index.ts` right
now.

## What to test before recording a demo

- First ever message ("hi") → two-part welcome + welcome sticker
- A Bitcoin, Solana, or TON address → resolved instantly, no chain question
- An EVM-format address active on more than one supported chain → Pholio
  asks which chain
- The same address scanned twice → second scan still hits live APIs, never
  replays the stored read
- "What did you tell me about that wallet before?" → recalls the past scan,
  framed as recall rather than a new result
- "Forget everything" → memory wipes, next reply carries no earlier context
- A broken API key or dropped connection → Pholio states plainly that a
  lookup failed, with no invented numbers

## Submitting to the PhotonHQ contest

- Deadline: Sept 10, 2026. Winners announced Sept 12.
- Post a demo video or chat history on X, tagging @PhotonHQ
- Submit the same post via PhotonHQ's Typeform
- Only posts from Sept 3 onward count

## Project structure

```
src/
  config.ts             env loading + validation
  db.ts                 Postgres access (users, messages, scans)
  chains/
    types.ts
    detect.ts            address format classification + EVM disambiguation list
    blockscout.ts         Ethereum / Base / Polygon / Robinhood Chain / HyperEVM
    helius.ts              Solana
    tonapi.ts               TON
    bitcoin.ts                Bitcoin (mempool.space)
    sui.ts                     Sui
    hyperliquid.ts              Hyperliquid perps/spot state
    dexscreener.ts               token price enrichment
  ai/
    personality.ts        Pholio's system prompt + rules
    gemini.ts               Gemini API call wrapper
  handlers/
    onboarding.ts          first-message welcome flow
    intent.ts               natural-language intent detection (no slash commands)
    scan.ts                  scan orchestration + EVM chain disambiguation
  index.ts                Spectrum wiring — the app.messages loop
db/
  schema.sql
  init.ts
assets/                   sticker images
```
