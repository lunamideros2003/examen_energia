const fs = require('fs');

const meterCount = 200;
const hourCount = 720;
const gapPercentage = 0.06;
const duplicatePercentage = 0.012;
const transferCount = 10;
const fraudMeterCount = 5;
const fraudMagnitude = 0.5;

const startTimestamp = 1767225600;

function randomHex(length) {
  const chars = '0123456789ABCDEF';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

console.log('Generando ' + meterCount + ' medidores por ' + hourCount + ' horas');

const meterIds = [];
for (let m = 0; m < meterCount; m++) {
  meterIds.push(randomHex(12));
}

const transformerCount = 10;
const transformerIds = [];
for (let t = 0; t < transformerCount; t++) {
  transformerIds.push('TR-' + String(1000 + t));
}

const meterTransformer = {};
for (let m = 0; m < meterCount; m++) {
  meterTransformer[meterIds[m]] = transformerIds[m % transformerCount];
}

const fraudMeters = meterIds.slice(0, fraudMeterCount);

const readingLines = ['meter_id,ts,kwh,version,flags'];

for (let t = 0; t < transformerCount; t++) {
  readingLines.push([transformerIds[t], startTimestamp, 0, 1, 0].join(','));
}

for (let m = 0; m < meterCount; m++) {
  const meterId = meterIds[m];
  const isFraudMeter = fraudMeters.indexOf(meterId) !== -1;

  for (let h = 0; h < hourCount; h++) {
    const timestamp = startTimestamp + h * 3600;
    let value = 0.3 + Math.random() * 0.3;

    if (Math.random() < gapPercentage) {
      readingLines.push([meterId, timestamp, '', 1, 2].join(','));
      continue;
    }

    let realValue = value;
    if (isFraudMeter) {
      realValue = value * (1 - fraudMagnitude);
    }

    readingLines.push([meterId, timestamp, realValue.toFixed(3), 1, 0].join(','));

    if (Math.random() < duplicatePercentage) {
      readingLines.push([meterId, timestamp, (realValue + 0.01).toFixed(3), 2, 0].join(','));
    }
  }
}

for (let t = 0; t < transformerCount; t++) {
  for (let h = 0; h < hourCount; h++) {
    const timestamp = startTimestamp + h * 3600;
    let sumOfMeters = 0;
    for (let m = 0; m < meterCount; m++) {
      if (meterTransformer[meterIds[m]] === transformerIds[t]) {
        sumOfMeters += 0.3;
      }
    }
    const macroValue = sumOfMeters * 1.03;
    readingLines.push([transformerIds[t], timestamp, macroValue.toFixed(3), 1, 0].join(','));
  }
}

fs.writeFileSync('lecturas_mes.csv', readingLines.join('\n'));
console.log('Archivo lecturas_mes.csv generado con ' + readingLines.length + ' lineas');

const topologyLines = ['nodo_id,tipo,padre_id,desde,hasta'];
const endOfTime = 4102444800;
const middleTimestamp = startTimestamp + Math.floor(hourCount / 2) * 3600;

for (let m = 0; m < meterCount; m++) {
  const meterId = meterIds[m];
  const homeTransformer = meterTransformer[meterId];

  if (m < transferCount) {
    const otherTransformer = transformerIds[(m + 1) % transformerCount];
    topologyLines.push([meterId, 'MEDIDOR', homeTransformer, startTimestamp, middleTimestamp].join(','));
    topologyLines.push([meterId, 'MEDIDOR', otherTransformer, middleTimestamp, endOfTime].join(','));
  } else {
    topologyLines.push([meterId, 'MEDIDOR', homeTransformer, startTimestamp, endOfTime].join(','));
  }
}

for (let t = 0; t < transformerCount; t++) {
  topologyLines.push([transformerIds[t], 'TRAFO', 'CIR-01', startTimestamp, endOfTime].join(','));
}
topologyLines.push(['CIR-01', 'CIRCUITO', 'SUB-01', startTimestamp, endOfTime].join(','));
topologyLines.push(['SUB-01', 'SUBESTACION', '', startTimestamp, endOfTime].join(','));

fs.writeFileSync('topologia.csv', topologyLines.join('\n'));
console.log('Archivo topologia.csv generado con ' + topologyLines.length + ' lineas');
console.log('Medidores con fraude sembrado: ' + fraudMeters.join(', '));
