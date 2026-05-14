const fs = require('fs');
const code = fs.readFileSync('server.js', 'utf8');
const regex = /app\.(post|get|put|delete|patch)\(\s*["']([^"']+)["']/g;
let match;
const endpoints = [];
while ((match = regex.exec(code)) !== null) {
  endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
}
console.log(endpoints.join('\n'));
