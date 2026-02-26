/**
 * create-collection.js
 * One-time script to create the Lossy Metaplex certified collection on mainnet.
 *
 * Run from repo root:
 *   node scripts/create-collection.js
 *
 * Requires env vars (copy from Vercel or .env):
 *   MASTER_WALLET_SEED  — BIP39 mnemonic or base58 secret key
 *   SOLANA_RPC_URL      — Helius RPC URL
 *   PINATA_JWT          — Pinata JWT for image + metadata upload
 *
 * Outputs:
 *   Collection mint address — add this as COLLECTION_MINT in Vercel env vars
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  Metaplex,
  keypairIdentity,
  toMetaplexFile,
} from '@metaplex-foundation/js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const RPC_URL     = process.env.SOLANA_RPC_URL;
const PINATA_JWT  = process.env.PINATA_JWT;
const WALLET_SEED = process.env.MASTER_WALLET_SEED; // mnemonic or base58

const COLLECTION_NAME   = 'Lossy';
const COLLECTION_SYMBOL = 'LOSSY';
const COLLECTION_DESC   = 'Lossy. An extension of Day After Day by lampwrecked. The signal persists in spite of decay.';
const SELLER_FEE_BPS    = 1500; // 15%
const CREATOR_ADDRESS   = 'FrstHD18pJsFRatk2hnfv4EztP1p87mJ1SL6QyXCcQju';
const IMAGE_PATH        = path.join(__dirname, '..', 'lossy-collection.jpg');

if (!RPC_URL || !PINATA_JWT || !WALLET_SEED) {
  console.error('Missing env vars: SOLANA_RPC_URL, PINATA_JWT, MASTER_WALLET_SEED');
  process.exit(1);
}

// ── Derive master wallet ─────────────────────────────────────────────────────
function getMasterKeypair() {
  try {
    // Try base58 secret key first
    const decoded = bs58.decode(WALLET_SEED);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  } catch {}
  // Fall back to mnemonic
  const seed = bip39.mnemonicToSeedSync(WALLET_SEED);
  const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  return Keypair.fromSeed(key);
}

// ── Upload to Pinata ─────────────────────────────────────────────────────────
async function uploadImageToPinata(imagePath) {
  console.log('Uploading collection image to Pinata...');
  const imageBytes = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append('file', imageBytes, {
    filename: 'lossy-collection.jpg',
    contentType: 'image/jpeg',
  });
  form.append('pinataMetadata', JSON.stringify({ name: 'Lossy Collection Image' }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...form.getHeaders() },
    body: form,
  });
  const data = await res.json();
  if (!data.IpfsHash) throw new Error('Image upload failed: ' + JSON.stringify(data));
  const uri = `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
  console.log('Image uploaded:', uri);
  return uri;
}

async function uploadMetadataToPinata(imageUri) {
  console.log('Uploading collection metadata to Pinata...');
  const metadata = {
    name: COLLECTION_NAME,
    symbol: COLLECTION_SYMBOL,
    description: COLLECTION_DESC,
    image: imageUri,
    seller_fee_basis_points: SELLER_FEE_BPS,
    properties: {
      files: [{ uri: imageUri, type: 'image/jpeg' }],
      category: 'image',
      creators: [{ address: CREATOR_ADDRESS, share: 100 }],
    },
  };

  const form = new FormData();
  form.append('file', Buffer.from(JSON.stringify(metadata, null, 2)), {
    filename: 'lossy-collection-metadata.json',
    contentType: 'application/json',
  });
  form.append('pinataMetadata', JSON.stringify({ name: 'Lossy Collection Metadata' }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...form.getHeaders() },
    body: form,
  });
  const data = await res.json();
  if (!data.IpfsHash) throw new Error('Metadata upload failed: ' + JSON.stringify(data));
  const uri = `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`;
  console.log('Metadata uploaded:', uri);
  return uri;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n── Lossy Collection Creator ──\n');

  const keypair = getMasterKeypair();
  console.log('Master wallet:', keypair.publicKey.toBase58());

  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  console.log('SOL balance:', balance / 1e9, 'SOL');

  if (balance < 15000000) { // 0.015 SOL minimum
    console.error('Insufficient SOL. Need at least 0.015 SOL in master wallet.');
    process.exit(1);
  }

  // Upload image + metadata to Pinata
  const imageUri    = await uploadImageToPinata(IMAGE_PATH);
  const metadataUri = await uploadMetadataToPinata(imageUri);

  // Create collection via Metaplex
  console.log('\nCreating Metaplex collection on mainnet...');
  const metaplex = Metaplex.make(connection).use(keypairIdentity(keypair));

  const { nft: collectionNft } = await metaplex.nfts().create({
    name:                  COLLECTION_NAME,
    symbol:                COLLECTION_SYMBOL,
    uri:                   metadataUri,
    sellerFeeBasisPoints:  SELLER_FEE_BPS,
    isCollection:          true,
    creators: [
      { address: new PublicKey(CREATOR_ADDRESS), share: 100 },
    ],
  });

  const collectionMint = collectionNft.address.toBase58();

  console.log('\n✅ Collection created successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Collection mint address:', collectionMint);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\nNext steps:');
  console.log('1. Add this to Vercel env vars:');
  console.log(`   COLLECTION_MINT = ${collectionMint}`);
  console.log('2. Redeploy Vercel — all future mints will be part of the collection');
  console.log('3. View on Explorer:');
  console.log(`   https://explorer.solana.com/address/${collectionMint}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
