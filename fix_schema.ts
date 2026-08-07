const fs = require('fs');
let c = fs.readFileSync('prisma/schema.prisma', 'utf8');
c = c.replace(/@map\(".*?"\)/g, '').replace(/@@map\(".*?"\)\r?\n?/g, '');
fs.writeFileSync('prisma/schema.prisma', c);
console.log('Schema mapped fields removed.');
