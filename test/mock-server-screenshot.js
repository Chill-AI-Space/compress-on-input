const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/call') {
    // Read screenshot and return as base64
    const imgPath = path.join(__dirname, 'fixtures', 'screenshot.png');
    const base64 = fs.readFileSync(imgPath).toString('base64');

    const result = {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{
          type: 'image',
          data: base64,
          mimeType: 'image/png'
        }]
      }
    };
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
  }
});
