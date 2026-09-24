// Firebase Functions discovery registers HTTP routes before reading exports.
// An incompatible path-to-regexp override made this throw while deploy exited 0.
const express = require('express');

const app = express();
app.get('/__/functions.yaml', (_request, response) => response.end('ok'));
app.get('/__/quitquitquit', (_request, response) => response.end('ok'));

console.log('Firebase Functions discovery router initialized.');
