const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// Load from environment variables (NEVER hardcode)
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1089394250929176';
const TO_NUMBER = process.env.TO_NUMBER || '601116266163';
const PORT = process.env.PORT || 10000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB limit
const UPLOAD_DIR = '/tmp/uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

console.log('🤖 Bot started (Secure WhatsApp Cloud API)!\n');

// Clean old files on startup
fs.readdir(UPLOAD_DIR, (err, files) => {
  if (!err) {
    files.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)));
    console.log('🧹 Cleaned old uploads');
  }
});

function sendWhatsAppMessage(fileUrl, caption, isVideo) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      to: TO_NUMBER,
      type: isVideo ? 'video' : 'image',
      [isVideo ? 'video' : 'image']: { link: fileUrl, caption: caption }
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v18.0/${PHONE_NUMBER_ID}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve uploaded files
  if (req.method === 'GET' && req.url.startsWith('/files/')) {
    const fileName = path.basename(req.url.replace('/files/', ''));
    const filePath = path.join(UPLOAD_DIR, fileName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const ext = path.extname(fileName).toLowerCase();
      const mime = ext === '.mp4' ? 'video/mp4' : ext === '.jpg' ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200);
    res.end('Bot running');
    return;
  }

  // Upload endpoint
  if (req.method === 'POST' && req.url === '/upload') {
    let phone = '';
    let fileName = '';
    let fileSize = 0;
    let isVideo = true;
    const chunks = [];

    const busboy = Busboy({ 
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE }
    });

    busboy.on('field', (name, val) => {
      if (name === 'phone') phone = val;
    });

    busboy.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      fileName = filename;
      
      // Accept any media file (video or image)
      const isMedia = mimeType.includes('video') || 
                      mimeType.includes('image') ||
                      filename.endsWith('.mp4') || 
                      filename.endsWith('.mov') ||
                      filename.endsWith('.avi') ||
                      filename.endsWith('.jpg') ||
                      filename.endsWith('.jpeg') ||
                      filename.endsWith('.png') ||
                      filename.endsWith('.webp');
      
      // Detect if it's an image
      if (mimeType.includes('image') || 
          filename.endsWith('.jpg') || 
          filename.endsWith('.jpeg') ||
          filename.endsWith('.png') ||
          filename.endsWith('.webp')) {
        isVideo = false;
      }

      if (!isMedia) {
        file.resume();
        return;
      }

      file.on('data', (data) => {
        fileSize += data.length;
        if (fileSize > MAX_FILE_SIZE) {
          file.destroy();
          return;
        }
        chunks.push(data);
      });
    });

    busboy.on('finish', async () => {
      if (chunks.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: 'error', error: 'No valid media file' }));
        return;
      }

      try {
        const videoData = Buffer.concat(chunks);
        const uniqueName = `${Date.now()}_${path.basename(fileName)}`;
        const filePath = path.join(UPLOAD_DIR, uniqueName);
        fs.writeFileSync(filePath, videoData);

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        const mediaType = isVideo ? 'Video' : 'Photo';
        console.log(`📤 Sending HD ${mediaType} (${(fileSize/1048576).toFixed(2)} MB)...`);

        const result = await sendWhatsAppMessage(
          fileUrl, 
          `🎥 HD ${mediaType} ready! Forward this to your Status.`,
          isVideo
        );

        if (result.error) {
          console.error('❌ WhatsApp error:', result.error.message);
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'error', error: result.error.message }));
        } else {
          console.log('✅ Sent!');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'sent' }));

          // Delete file after 5 minutes
          setTimeout(() => {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }, 5 * 60 * 1000);
        }

      } catch (err) {
        console.error('❌ Error:', err.message);
        res.writeHead(500);
        res.end(JSON.stringify({ status: 'error', error: err.message }));
      }
    });

    req.pipe(busboy);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
