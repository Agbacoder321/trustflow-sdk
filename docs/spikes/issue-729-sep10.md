# SEP-10 authentication spike (#729)

## Contract comparison

| Step | Current TrustFlow API | SEP-10 |
| --- | --- | --- |
| Discovery | Configured backend URL | `WEB_AUTH_ENDPOINT` and `SIGNING_KEY` in `stellar.toml` |
| Challenge | `GET /auth/challenge?address=G...` returns a UTF-8 nonce | `GET WEB_AUTH_ENDPOINT?account=G...` returns a server-signed, time-bounded transaction XDR |
| Wallet action | `signMessage(nonce)` | Verify server challenge, then `signTransaction(XDR)` on Testnet |
| Exchange | `POST /auth/verify` with `{ address, signature }` | `POST WEB_AUTH_ENDPOINT` with `{ transaction: signedXdr }` |
| Token | Backend JWT | SEP-10 JWT; application-specific refresh remains separate |

SEP-10 standardizes the challenge and exchange, but the backend must implement server signing, challenge validation (including domain, time bounds, account, and signatures), nonce replay protection, and JWT issuance. The existing `POST /auth/refresh` is outside SEP-10 and can remain unchanged. The [SEP-10 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) defines the endpoint, validation, and discovery requirements.

## Wallet impact

Freighter and Albedo expose transaction signing, so SEP-10 can reuse their existing XDR signing paths. The current TrustFlow Freighter connector also exposes message signing; its Albedo connector exposes transaction signing only. The repository declares `xbull` as a wallet type but `connectWallet` does not implement it, so no xBull simplification can be claimed without a connector. There is no evidence that these wallets offer an API that completes the entire SEP-10 exchange for this backend; transaction signing is still needed. See the [Albedo transaction signing API](https://albedo.link/playground?section=tx) and [SEP-10 wallet flow](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md).

## Testnet prototype

Run `node --import tsx examples/sep10-testnet-prototype.ts`. It creates an ephemeral server and client keypair, builds a SEP-10 challenge with `Networks.TESTNET`, verifies the server challenge, signs the XDR with the client, and verifies the client signature using the installed `@stellar/stellar-sdk` WebAuth helpers. Add `--live` to discover the public Testnet anchor's SEP-10 endpoint from `stellar.toml`, request and verify a real challenge, sign it, and exchange it for a JWT. The live path completed successfully on 21 November 2026. It depends on that external service being available. The script only reports that a token was received; it does not print credentials.

## Migration and recommendation

**Go for an opt-in backend and SDK implementation; no-go for replacing the current endpoints now.** Add a separate SEP-10 endpoint and publish its URL/signing key in `stellar.toml`. Keep the legacy challenge/verify endpoints during the transition. Let clients select `legacy` or `sep10` explicitly, then migrate deployments after backend capability checks. Both flows can issue the same JWT shape and continue using `/auth/refresh`. Remove the legacy contract only after deployed backends and clients have moved. This avoids interpreting a legacy nonce as transaction XDR or sending a SEP-10 envelope to `/auth/verify`.

Before production use, test wallet prompts and server-side signature threshold validation against a deployed Testnet backend. The SDK helper's `verifyChallengeTxSigners` demonstrates single-key verification; a production service must account for the account's actual signer weights and threshold. See the [stellar-sdk WebAuth helper documentation](https://stellar.github.io/js-stellar-sdk/).
