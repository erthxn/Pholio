# Pholio

An iMessage agent, built on [Photon](photon.codes), that reads on-chain wallets (Ethereum, Base,
Polygon, Robinhood Chain, HyperEVM, Solana, TON, Bitcoin, and Sui) and returns a
plain-English trading-style read. No slash commands: address in, read out, in
plain conversation.

## How it works

Pholio listens on Photon's `app.messages` stream. Every inbound message is
classified by a regex layer first. Address formats that are unambiguous
(Bitcoin, Solana, TON, Sui) resolve instantly. The shared `0x...` EVM format
(Ethereum, Base, Polygon, Robinhood Chain, HyperEVM) is resolved by querying
every candidate chain in parallel via Blockscout, and only asking the user
when more than one chain shows real activity. Once a chain is settled, the
relevant API is called live, the raw result is handed to Gemini for a short
trading-style summary, and both the raw data and the summary are persisted to
Postgres. A past scan is only ever surfaced as recall ("last time I checked
this..."), a fresh request always re-hits the live APIs.

## Prerequisites

- Node.js 20+ (or Bun)
- A Photon account with a Spectrum project and a cloud iMessage line
  provisioned (no Mac required, this uses the cloud provider, not the local
  macOS one)
- API keys: Blockscout, Helius, TonAPI, Google AI Studio (Gemini)
- A Postgres database

## Setup

1. Install and configure:

   ```bash
   npm install
   cp .env.example .env
   npm run db:init

