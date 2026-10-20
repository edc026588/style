'use strict';
// Copies the web app (../index.html and ../icons) into desktop/app so the desktop
// build ships exactly the page the website serves.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const dest = path.join(__dirname, '..', 'app');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(dest, 'index.html'));
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });
console.log('Copied the web app into desktop/app');
