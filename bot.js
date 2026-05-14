const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

// WhatsApp Cloud API
const ACCESS_TOKEN = 'EAAhhCgfBBmcBRUc15oZAVScDFw2Fg8JFeEfBZBAnCgyZCQeNFZCIDJVO8e3wD3yOB4rcM4HJS2A2EKC7qZAwUX2dCVJEIOF7ZAsxeJOIDD7hxLKAMsANjfrkF0NOdoZAV7X8tUMJOGChfOZAXUY0suhynWKImDF3DVIEWsZB1ymXGQjxfHpZCO0Qd42T1R0zesgWmbfJUZCRXEGtrbXTBuH7z631c2tsqM7fxQQZC2WclHoZCmfeRNTfZBxs5eXcaAEFNCFRucdxLnyT2nqxmNRDLtZBZBvHVgZDZD';
const PHONE_NUMBER_ID = '1096393916895966';
const TO_NUMBER = '601116266163';
const PORT = process.env.PORT || 10000;

if (!fs.existsSync('/tmp/uploads')) fs.mkdirSync('/tmp/uploads');

console.log('🤖 Bot started (WhatsApp Cloud API)!\n');

function sendWhatsAppMessage(fileUrl, caption) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      messaging_product: 'whatsapp',
      to: TO_NUMBER,
      type: 'video',
      video: {
        link: fileUrl,
        caption: caption
      }
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
      res.on('end', () => {
        console.log('📤 WhatsApp response:', body);
        resolve(JSON.parse(body));
      });
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

  if (req.method === 'GET' && req.url.startsWith('/files/')) {
    const fileName = req.url.replace('/files/', '');
    const filePath = path.join('/tmp/uploads', fileName);
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
        fs.writeFileSync(filePath, videoData);

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host;
        const fileUrl = `${protocol}://${host}/files/${uniqueName}`;

        console.log(`📤 Sending HD video...`);
        console.log(`📤 File URL: ${fileUrl}`);

        const result = await sendWhatsAppMessage(fileUrl, '🎥 HD Video ready! Forward this to your Status.');
        console.log('✅ Result:', JSON.stringify(result));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'sent', result }));

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

