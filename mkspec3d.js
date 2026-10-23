// node mkspec3d.js in_spec.json out_spec3d.json  -> adds textures for viewer
const m = require('./lib/minifig'); const fs = require('fs');
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); s.textures = m.textures(s); fs.writeFileSync(process.argv[3], JSON.stringify(s));
