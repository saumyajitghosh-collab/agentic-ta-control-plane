// Loads the browser scripts into an isolated context, exactly as index.html does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = ['util.js', 'policy-pack.js', 'control.js', 'messages.js', 'data.js', 'analytics.js', 'agents.js', 'engine.js', 'story.js'];

function loadCore() {
  const sandbox = { console, TextEncoder, Math, Date, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of CORE) {
    const p = path.join(__dirname, '..', 'src', 'core', f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  return sandbox.TACP;
}
module.exports = { loadCore, CORE };
