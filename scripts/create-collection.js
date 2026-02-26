// api/create-collection.js
// ONE-TIME USE — creates the Lossy Metaplex certified collection
// Hit once, copy the mint address, then DELETE THIS FILE from GitHub
//
// Usage:
//   GET /api/create-collection?secret=lossy2026
//
// After running:
//   1. Copy the collectionMint address from the response
//   2. Add COLLECTION_MINT=<address> to Vercel env vars
//   3. Delete this file from GitHub immediately

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Secret guard — prevents anyone else from triggering this
  const { secret } = req.query;
  if (secret !== 'lossy2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { createUmi }        = await import('@metaplex-foundation/umi-bundle-defaults');
    const { createNft, mplTokenMetadata } = await import('@metaplex-foundation/mpl-token-metadata');
    const {
      createSignerFromKeypair,
      signerIdentity,
      generateSigner,
      percentAmount,
      publicKey: umiPublicKey,
    } = await import('@metaplex-foundation/umi');

    const { getMasterKeypair } = await import('../lib/wallet.js');

    const COLLECTION_NAME   = 'Lossy';
    const COLLECTION_SYMBOL = 'LOSSY';
    const COLLECTION_DESC   = 'Lossy. An extension of Day After Day by lampwrecked. The signal persists in spite of decay.';
    const CREATOR_ADDRESS   = 'FrstHD18pJsFRatk2hnfv4EztP1p87mJ1SL6QyXCcQju';
    const PINATA_JWT        = (process.env.PINATA_JWT || '').trim();

    if (!PINATA_JWT) throw new Error('PINATA_JWT not configured');

    // ── 1. Upload collection image to Pinata ──────────────────────────────
    // Fetch the image we already uploaded to the repo via raw GitHub
    console.log('Fetching collection image...');
    const imageRes = await fetch(
      'https://raw.githubusercontent.com/lampwrecked/Lossy/main/lossy-collection.jpg'
    );
    if (!imageRes.ok) throw new Error('Could not fetch lossy-collection.jpg from GitHub');
    const imageBuffer = await imageRes.arrayBuffer();
    const imageBytes  = new Uint8Array(imageBuffer);

    const imageForm = new FormData();
    const imageBlob = new Blob([imageBytes], { type: 'image/jpeg' });
    imageForm.append('file', imageBlob, 'lossy-collection.jpg');
    imageForm.append('pinataMetadata', JSON.stringify({ name: 'Lossy Collection Image' }));
    imageForm.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

    const imgPinRes  = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method:  'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body:    imageForm,
    });
    const imgPinData = await imgPinRes.json();
    if (!imgPinData.IpfsHash) throw new Error('Image upload failed: ' + JSON.stringify(imgPinData));
    const imageUri = `https://gateway.pinata.cloud/ipfs/${imgPinData.IpfsHash}`;
    console.log('Image uploaded:', imageUri);

    // ── 2. Upload collection metadata JSON to Pinata ──────────────────────
    const collectionMetadata = {
      name:        COLLECTION_NAME,
      symbol:      COLLECTION_SYMBOL,
      description: COLLECTION_DESC,
      image:       imageUri,
      seller_fee_basis_points: 1500,
      properties: {
        files:    [{ uri: imageUri, type: 'image/jpeg' }],
        category: 'image',
        creators: [{ address: CREATOR_ADDRESS, share: 100 }],
      },
    };

    const metaForm = new FormData();
    const metaBlob = new Blob([JSON.stringify(collectionMetadata, null, 2)], { type: 'application/json' });
    metaForm.append('file', metaBlob, 'lossy-collection-metadata.json');
    metaForm.append('pinataMetadata', JSON.stringify({ name: 'Lossy Collection Metadata' }));
    metaForm.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

    const metaPinRes  = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method:  'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body:    metaForm,
    });
    const metaPinData = await metaPinRes.json();
    if (!metaPinData.IpfsHash) throw new Error('Metadata upload failed: ' + JSON.stringify(metaPinData));
    const metadataUri = `https://gateway.pinata.cloud/ipfs/${metaPinData.IpfsHash}`;
    console.log('Metadata uploaded:', metadataUri);

    // ── 3. Create collection NFT on Solana ────────────────────────────────
    console.log('Creating collection on mainnet...');
    const masterKeypair = await getMasterKeypair();

    const umi       = createUmi(process.env.SOLANA_RPC_URL).use(mplTokenMetadata());
    const umiKp     = umi.eddsa.createKeypairFromSecretKey(masterKeypair.secretKey);
    const signer    = createSignerFromKeypair(umi, umiKp);
    umi.use(signerIdentity(signer));

    const collectionMint = generateSigner(umi);

    const { signature } = await createNft(umi, {
      mint:                 collectionMint,
      name:                 COLLECTION_NAME,
      symbol:               COLLECTION_SYMBOL,
      uri:                  metadataUri,
      sellerFeeBasisPoints: percentAmount(15, 2),
      isCollection:         true,
      creators: [{
        address:  umiPublicKey(CREATOR_ADDRESS),
        verified: false,
        share:    100,
      }],
      isMutable: true, // keep mutable so we can verify creators later
    }).sendAndConfirm(umi);

    const bs58      = await import('bs58');
    const sigStr    = bs58.default.encode(signature);
    const mintAddr  = collectionMint.publicKey;

    console.log('Collection created:', mintAddr);

    return res.status(200).json({
      success:       true,
      collectionMint: mintAddr,
      metadataUri,
      imageUri,
      signature:     sigStr,
      explorerUrl:   `https://explorer.solana.com/address/${mintAddr}`,
      nextSteps: [
        `1. Add to Vercel env vars: COLLECTION_MINT = ${mintAddr}`,
        '2. Redeploy Vercel',
        '3. DELETE api/create-collection.js from GitHub immediately',
      ],
    });

  } catch (err) {
    console.error('Create collection error:', err);
    return res.status(500).json({ error: err.message });
  }
}
