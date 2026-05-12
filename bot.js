const http = require('http');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const ACCOUNT_SID = 'AC52a45e18747ad646fcbf4d68ab692f92';
const AUTH_TOKEN = 'ebb3d16b09fe398eb2936401c4e999aa';
const FROM_NUMBER = 'whatsapp:+14155238886';
const PORT = process.env.PORT || 10000;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// Serve uploaded files
if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads');

console.log('🤖 Bot started!\n');

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
    const fileName = req.url.replace('/files/', '');
    const filePath = path.join('/tmp/uploads', fileName);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size
      });
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

  if (req.method === 'POST' && req.url === '/upload') {
    let phone = '';
    let fileName = '';
    const chunks = [];

    const busboy = Busboy({ headers: req.headers });

    busboy.on('field', (name, val) => {
      if (name === 'phone') phone = val;
    });

    busboy.on('file', (name, file, info) => {
      fileName = info.filename;
      file.on('data', (data) => chunks.push(data));
    });

    busboy.on('finish', async () => {
      try {
        const videoData = Buffer.concat(chunks);
        const uniqueName = `${Date.now()}_${fileName}`;
        const filePath = path.join('/tmp/uploads', uniqueName);

        // Save file
        fs.writeFileSync(filePath, videoData);
        console.log(`📤 Saved: ${uniqueName} (${videoData.length} bytes)`);

        // Get public URL
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        console.log(`📤 File URL: ${fileUrl}`);

        // Send via Twilio
        const msg = await client.messages.create({
          from: FROM_NUMBER,
          to: `whatsapp:+${phone}`,
          mediaUrl: [fileUrl],
          body: '🎥 HD Video ready! Forward this to your Status.'
        });

        console.log('✅ Message sent! SID:', msg.sid);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent', sid: msg.sid }));

      } catch (err) {
        console.error('❌ Error:', err.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
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
