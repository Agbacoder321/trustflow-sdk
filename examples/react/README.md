# Wallet session example

This Vite app uses `useWalletSession` to connect Freighter, request and sign a challenge, exchange it for a JWT, restore the stored session, refresh the token, and sign out.

Run a TrustFlow backend that supports `GET /auth/challenge`, `POST /auth/verify`, and `POST /auth/refresh`. Then run:

```bash
# From the repository root
npm ci
npm run build
cd examples/react
npm install
VITE_TRUSTFLOW_API_URL=http://localhost:3000 npm run dev
```

Open the Vite URL, with Freighter installed and set to Testnet. Set `VITE_TRUSTFLOW_API_URL` to your backend URL if it is not local. The backend must allow requests from the Vite origin.

The example displays the session address and expiry, and uses `isExpiringSoon` to show a warning during the final five minutes. Refresh runs automatically sixty seconds before expiry.
