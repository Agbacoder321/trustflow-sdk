/** Offline SEP-10 handshake on the Stellar Testnet passphrase; no keys or tokens leave this process. */
import { Keypair, Networks, StellarToml, WebAuth } from '@stellar/stellar-sdk';

async function runLiveTestnet(): Promise<void> {
  const domain = 'testanchor.stellar.org';
  const toml = await StellarToml.Resolver.resolve(domain);
  if (!toml.WEB_AUTH_ENDPOINT || !toml.SIGNING_KEY) {
    throw new Error('Test anchor does not advertise SEP-10');
  }
  const account = Keypair.random();
  const endpoint = new URL(toml.WEB_AUTH_ENDPOINT);
  endpoint.searchParams.set('account', account.publicKey());
  const challengeResponse = await fetch(endpoint);
  if (!challengeResponse.ok)
    throw new Error(`Challenge request failed: ${challengeResponse.status}`);
  const challengeBody = (await challengeResponse.json()) as { transaction: string };
  const webAuthDomain = new URL(toml.WEB_AUTH_ENDPOINT).hostname;
  const { tx, clientAccountID } = WebAuth.readChallengeTx(
    challengeBody.transaction,
    toml.SIGNING_KEY,
    Networks.TESTNET,
    domain,
    webAuthDomain,
  );
  if (clientAccountID !== account.publicKey()) throw new Error('Unexpected client account');
  tx.sign(account);
  const tokenResponse = await fetch(toml.WEB_AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: tx.toEnvelope().toXDR('base64') }),
  });
  if (!tokenResponse.ok) throw new Error(`Token request failed: ${tokenResponse.status}`);
  const tokenBody = (await tokenResponse.json()) as { token: string };
  if (!tokenBody.token) throw new Error('SEP-10 response did not contain a token');
  console.log(`Live Testnet SEP-10 token received for ${clientAccountID}`);
}

const homeDomain = 'example.org';
const webAuthDomain = 'auth.example.org';
const server = Keypair.random();
const client = Keypair.random();

// Backend: GET WEB_AUTH_ENDPOINT?account=<client public key>
const challenge = WebAuth.buildChallengeTx(
  server,
  client.publicKey(),
  homeDomain,
  300,
  Networks.TESTNET,
  webAuthDomain,
);

// Wallet: verify the server's challenge before signing its XDR.
const { tx, clientAccountID } = WebAuth.readChallengeTx(
  challenge,
  server.publicKey(),
  Networks.TESTNET,
  homeDomain,
  webAuthDomain,
);
if (clientAccountID !== client.publicKey()) throw new Error('Unexpected client account');
tx.sign(client);
const signedXdr = tx.toEnvelope().toXDR('base64');

// Backend: POST WEB_AUTH_ENDPOINT { transaction: signedXdr }, then issue a JWT.
const signers = WebAuth.verifyChallengeTxSigners(
  signedXdr,
  server.publicKey(),
  Networks.TESTNET,
  [client.publicKey()],
  homeDomain,
  webAuthDomain,
);
if (!signers.includes(client.publicKey())) throw new Error('Client signature missing');
console.log(`SEP-10 Testnet challenge verified for ${clientAccountID}`);

if (process.argv.includes('--live')) {
  runLiveTestnet().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

// A browser wallet would sign the XDR via signTransaction; a live server must
// store challenge nonces and reject replay before issuing a token.
