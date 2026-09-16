const express = require('express');
const path = require('path');

const app = express();
const port = 8080;
const distFolder = path.join(__dirname, 'dist', 'caso-estudio-2');

app.use(function (req, res, next) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

app.use(express.static(distFolder));

app.get('*', function (req, res) {
  res.sendFile(path.join(distFolder, 'index.html'));
});

app.listen(port, function () {
  console.log('Servidor corriendo en http://localhost:' + port);
  console.log('Recuerda ejecutar antes: npm run build');
});
