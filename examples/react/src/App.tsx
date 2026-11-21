import { useWalletSession } from '@trustflow/sdk/react';
import './App.css';

const apiUrl = import.meta.env.VITE_TRUSTFLOW_API_URL ?? 'http://localhost:3000';

export default function App() {
  const { session, status, error, signIn, signOut, isExpiringSoon } = useWalletSession({ apiUrl });

  return (
    <main className="App">
      <h1>TrustFlow wallet session</h1>
      <p>Status: {status}</p>
      {session ? (
        <>
          <p>Signed in as {session.address}</p>
          <p>Expires at {new Date(session.expiresAt).toLocaleTimeString()}</p>
          {isExpiringSoon && <p>Your session is expiring soon.</p>}
          <button onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <button disabled={status === 'signingIn'} onClick={() => void signIn().catch(() => {})}>
          {status === 'signingIn' ? 'Signing in…' : 'Sign in with Freighter'}
        </button>
      )}
      {error && <p role="alert">{error.message}</p>}
    </main>
  );
}
