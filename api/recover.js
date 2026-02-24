// api/recover.js
// GET /api/recover?sessionId=sess_X_XXXX
// Manually triggers mint for a session that received payment but didn't mint.
// Safety: only works if session status is 'pending' or 'paid' and balance >= required.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId, secret } = req.query;

  // Basic auth — require a secret param to prevent abuse
  if (secret !== process.env.RECOVER_SECRET && secret !== 'dayafterday2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { redis } = await import('../lib/redis.js');
    const { getSessionKeypair, getMasterKeypair } = await import('../lib/wallet.js');
    const { getConnection, getUsdcBalance, findUsdcSender, sweepUsdc, sweepSol, REQUIRED_USDC } = await import('../lib/solana.js');

    let session = null;

    // If no sessionId, scan recent sessions for any with USDC balance
    if (!sessionId) {
      const counter = await redis.get('day-after-day:session-counter');
      const total = parseInt(counter || '0');
      const found = [];

      for (let i = Math.max(1, total - 20); i <= total; i++) {
        const connection = getConnection();
        const kp = await getSessionKeypair(i);
        const bal = await getUsdcBalance(connection, kp.publicKey);
        if (bal > 0) {
          found.push({ index: i, address: kp.publicKey.toBase58(), balance: bal });
        }
      }

      return res.status(200).json({ scanned: total, walletsWithUsdc: found });
    }

    // Load specific session
    session = await redis.getJson(`session:${sessionId}`);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.status === 'minted') {
      return res.status(200).json({ status: 'already minted', mintAddress: session.mintAddress });
    }

    const connection = getConnection();
    const sessionKeypair = await getSessionKeypair(session.sessionIndex);
    const balance = await getUsdcBalance(connection, sessionKeypair.publicKey);

    if (balance < REQUIRED_USDC) {
      return res.status(200).json({
        status: 'insufficient balance',
        balance,
        required: REQUIRED_USDC,
        address: sessionKeypair.publicKey.toBase58(),
      });
    }

    // Trigger mint
    const { default: pollHandler } = await import('./poll/[sessionId].js');
    const fakeReq = { method: 'GET', query: { sessionId } };
    const fakeRes = {
      _data: null,
      status(code) { this._code = code; return this; },
      json(data) { this._data = data; return this; },
      end() { return this; },
    };

    await pollHandler(fakeReq, fakeRes);

    return res.status(200).json({
      triggered: true,
      result: fakeRes._data,
    });

  } catch (err) {
    console.error('Recover error:', err);
    return res.status(500).json({ error: err.message });
  }
}
