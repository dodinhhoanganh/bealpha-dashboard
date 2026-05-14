const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const regex = /        let urlParts;[\s\S]*?const fileUrl = \`\/\$\{urlParts\.join\("\/"\)\}\`;/g;

code = code.replace(regex, `        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");`);

fs.writeFileSync('server.js', code);
console.log('Fixed fileUrl generation in server.js');
