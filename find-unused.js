const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const compsDir = './components';
const appDir = './app';

const comps = fs.readdirSync(compsDir).filter(f => f.endsWith('.tsx'));
comps.forEach(c => {
  const name = c.replace('.tsx', '');
  try {
    execSync(`findstr /S /M /C:"${name}" .\\app\\*.tsx .\\components\\*.tsx`, { stdio: 'ignore' });
  } catch (e) {
    console.log('Unused Component:', c);
  }
});
