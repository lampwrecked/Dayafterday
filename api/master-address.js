// api/master-address.js
// GET /api/master-address
// Returns the public key of the master wallet derived from MASTER_SEED_PHRASE
// Use this to know where to send SOL to fund minting operations

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { getMasterKeypair } = await import('../lib/wallet.js');
    const masterKeypair = await getMasterKeypair();
    const address = masterKeypair.publicKey.toBase58();

    const { getConnection } = await import('../lib/solana.js');
    const { LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const connection = getConnection();
    const balance = await connection.getBalance(masterKeypair.publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;

    return res.status(200).json({
      masterAddress: address,
      solBalance: solBalance.toFixed(6),
      solBalanceRaw: balance,
      funded: solBalance >= 0.05,
      recommendation: solBalance < 0.05
        ? `Send at least 0.1 SOL to ${address} to fund minting operations`
        : 'Balance looks good',
    });

  } catch (err) {
    console.error('Master address error:', err);
    return res.status(500).json({ error: err.message });
  }
}
