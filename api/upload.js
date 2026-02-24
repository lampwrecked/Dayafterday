// api/upload.js
// POST /api/upload
// Uploads media to Pinata (IPFS) — reliable free tier
// Returns IPFS URI for NFT metadata

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const pinataJwt = (process.env.PINATA_JWT || '').trim();
    if (!pinataJwt) throw new Error('PINATA_JWT not configured');

    // Parse multipart form data
    const { IncomingForm } = await import('formidable');
    const form = new IncomingForm({ maxFileSize: 150 * 1024 * 1024 });

    const { files, fields } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ files, fields });
      });
    });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) throw new Error('No file provided');

    const fs = await import('fs');
    const fileBuffer = fs.readFileSync(file.filepath);
    const mimeType = file.mimetype || 'video/webm';
    const outputType = Array.isArray(fields.outputType)
      ? fields.outputType[0]
      : (fields.outputType || 'video');

    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `day-after-day-${Date.now()}.${ext}`;

    // Upload to Pinata via their pinFileToIPFS endpoint
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, filename);
    formData.append('pinataMetadata', JSON.stringify({
      name: filename,
      keyvalues: { project: 'day-after-day', artist: 'lampwrecked' }
    }));
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${pinataJwt}` },
      body: formData,
    });

    const pinData = await pinRes.json();
    console.log('Pinata response:', JSON.stringify(pinData).slice(0, 200));

    if (!pinData.IpfsHash) {
      throw new Error('Pinata upload failed: ' + JSON.stringify(pinData));
    }

    const cid = pinData.IpfsHash;
    const fileUri = `https://gateway.pinata.cloud/ipfs/${cid}`;

    // Clean up temp file
    try { fs.unlinkSync(file.filepath); } catch {}

    return res.status(200).json({
      success: true,
      fileUri,
      cid,
      mimeType,
      outputType,
    });

  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
