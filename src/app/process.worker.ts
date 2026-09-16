/// <reference lib="webworker" />

addEventListener('message', async (event: MessageEvent) => {
  const data = event.data;

  if (data.type === 'echo') {
    (self as any).postMessage({ type: 'echo-done' });
    return;
  }

  const file: Blob = data.file;
  const blockSize: number = data.blockSize;
  const totalSize: number = data.totalSize;
  const counter = new Int32Array(data.sharedBuffer);
  const totalBlocks = Math.ceil(totalSize / blockSize);

  const meterIds: string[] = [];
  const timestamps: number[] = [];
  const values: number[] = [];
  const versions: number[] = [];
  const flags: number[] = [];
  let gapCount = 0;
  let blocksDone = 0;

  console.log('Worker iniciado, esperando bloques disponibles');

  while (true) {
    const blockIndex = Atomics.add(counter, 0, 1);
    if (blockIndex >= totalBlocks) {
      break;
    }

    const start = blockIndex * blockSize;
    const baseEnd = Math.min(start + blockSize, totalSize);
    const paddedEnd = Math.min(baseEnd + 300, totalSize);

    const rawChunk = file.slice(start, paddedEnd);
    let text = await rawChunk.text();

    if (blockIndex > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
    }

    if (paddedEnd < totalSize) {
      const usefulLimit = baseEnd - start;
      const nextBreak = text.indexOf('\n', usefulLimit);
      if (nextBreak !== -1) {
        text = text.slice(0, nextBreak);
      }
    }

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 0) continue;
      if (line.indexOf('meter_id') === 0) continue;

      const parts = line.split(',');
      if (parts.length < 5) continue;

      const rawValue = parts[2];
      const value = rawValue === '' ? NaN : parseFloat(rawValue);
      if (isNaN(value)) {
        gapCount++;
      }

      meterIds.push(parts[0]);
      timestamps.push(parseInt(parts[1], 10));
      values.push(value);
      versions.push(parseInt(parts[3], 10));
      flags.push(parseInt(parts[4], 10));
    }

    blocksDone++;
    (self as any).postMessage({ type: 'progress', blockIndex: blockIndex });
  }

  console.log('Worker termino, bloques procesados: ' + blocksDone);

  (self as any).postMessage({
    type: 'done',
    meterIds: meterIds,
    timestamps: timestamps,
    values: values,
    versions: versions,
    flags: flags,
    gapCount: gapCount
  });
});
