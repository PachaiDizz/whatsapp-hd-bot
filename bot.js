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
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
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

function sendWhatsAppMessage(fileUrl, caption) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      to: TO_NUMBER,
      type: 'video',
      video: { link: fileUrl, caption: caption }
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
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
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
      
      // Validate file type
      if (!ALLOWED_TYPES.includes(mimeType) && !mimeType.startsWith('video/')) {
        file.resume(); // Skip this file
        return;
      }

      file.on('data', (data) => {
        fileSize += data.length;
        if (fileSize > MAX_FILE_SIZE) {
          file.destroy(); // Stop receiving
          return;
        }
        chunks.push(data);
      });

      file.on('limit', () => {
        file.destroy();
      });
    });

    busboy.on('filesLimit', () => {
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', error: 'Too many files' }));
    });

    busboy.on('finish', async () => {
      if (chunks.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: 'error', error: 'No valid video file' }));
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

        console.log(`📤 Sending HD video (${(fileSize/1048576).toFixed(2)} MB)...`);

        const result = await sendWhatsAppMessage(fileUrl, '🎥 HD Video ready! Forward this to your Status.');

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

