const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'tools/call') {
    // Return a large DOM-like response
    const bigDom = Array.from({ length: 200 }, (_, i) =>
      `- role: generic [ref=${i}]\n  - button "Item ${i}" [ref=${i + 1000}]`
    ).join('\n');

    const result = {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: bigDom }]
      }
    };
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
  }
});
