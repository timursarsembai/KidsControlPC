const fs = require('fs');
['package.json', 'agent/package.json'].forEach(f => {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/"version":\s*"[^"]+"/, '"version": "1.1.22"');
  fs.writeFileSync(f, c);
});
let config = fs.readFileSync('agent/src/config.js', 'utf8');
config = config.replace(/AGENT_VERSION\s*=\s*[^;]+/, "AGENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.22'");
fs.writeFileSync('agent/src/config.js', config);
