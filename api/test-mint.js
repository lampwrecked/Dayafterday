// api/test-mint.js
// GET /api/test-mint
// Creates a session and immediately triggers mint without payment.
// REMOVE THIS FILE before going live to the public.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { redis } = await import('../lib/redis.js');
    const { getMasterKeypair, getSessionKeypair } = await import('../lib/wallet.js');
    const { getConnection, fundDerivedWallet, initUsdcAta, REQUIRED_USDC } = await import('../lib/solana.js');

    // Create a test session
    const sessionIndex = await redis.incr('day-after-day:session-counter');
    const masterKeypair = await getMasterKeypair();
    const sessionKeypair = await getSessionKeypair(sessionIndex);
    const paymentAddress = sessionKeypair.publicKey.toBase58();

    const sessionId = `sess_${sessionIndex}_${Date.now()}`;
    const session = {
      sessionId,
      sessionIndex,
      paymentAddress,
      outputType: 'photo',
      metadata: {
        mode: 'ember',
        speed: 1.0,
        fileUri: 'https://gateway.pinata.cloud/ipfs/bafkreigb4doitxxcdanajpe73f4bl7d3pn4iejt2vbpna4freziluvixyq',
        answers: { test: 'true' },
      },
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 30 * 1000,
      requiredUsdc: REQUIRED_USDC,
      buyerWallet: masterKeypair.publicKey.toBase58(),
      mintAddress: null,
      mintSignature: null,
      sweepSignature: null,
    };

    await redis.set(`session:${sessionId}`, session, 60 * 30);

    // Immediately trigger mint via poll handler with test mode
    const { default: pollHandler } = await import('./poll/[sessionId].js');
    const fakeReq = { method: 'GET', query: { sessionId, test: 'true' } };
    const fakeRes = {
      _code: 200, _data: null,
      status(c) { this._code = c; return this; },
      json(d) { this._data = d; return this; },
      end() { return this; },
    };

    await pollHandler(fakeReq, fakeRes);

    return res.status(fakeRes._code).json({
      sessionId,
      paymentAddress,
      mintResult: fakeRes._data,
    });

  } catch (err) {
    console.error('Test mint error:', err);
    return res.status(500).json({ error: err.message });
  }
}
