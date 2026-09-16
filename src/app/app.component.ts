import { Component, OnInit } from '@angular/core';

interface TopologyRow {
  nodeId: string;
  type: string;
  parentId: string;
  from: number;
  to: number;
}

interface TableRow {
  meterId: string;
  transformerId: string;
}

interface RankingItem {
  transformerId: string;
  totalLoss: number;
}

interface BenchmarkItem {
  size: string;
  copyTime: number;
  transferTime: number;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {

  workerCount = 4;
  totalBlocks = 0;
  progressBlocks = 0;
  finishedWorkers = 0;
  isProcessing = false;
  statusMessage = 'Esperando archivo de lecturas';

  meterIndex: Map<string, number> = new Map();
  nextMeterIndex = 0;

  meterIdColumn: number[] = [];
  timestampColumn: number[] = [];
  valueColumn: number[] = [];
  versionColumn: number[] = [];
  flagsColumn: number[] = [];
  totalGaps = 0;

  topologyRows: TopologyRow[] = [];

  finalReadings: Map<string, { value: number, version: number, flags: number }> = new Map();
  imputedPercentage = 0;

  monthStartTimestamp = 0;
  hourCount = 720;

  transformerHourSum: { [transformerId: string]: number[] } = {};
  macroHourValue: { [transformerId: string]: number[] } = {};
  residualValue: { [transformerId: string]: number[] } = {};
  anomalyFlag: { [transformerId: string]: boolean[] } = {};

  rankingList: RankingItem[] = [];

  tableRows: TableRow[] = [];
  filteredRows: TableRow[] = [];
  filterText = '';

  crossOriginIsolatedValue = false;
  inpValue = 0;
  longTaskCount = 0;

  sharedWorkerConnection: any = null;

  selectedSubtreeNode = '';
  subtreeHourFrom = 0;
  subtreeHourTo = 719;
  subtreeResult = 0;

  transferBenchmarkResults: BenchmarkItem[] = [];
  benchmarkRunning = false;

  ngOnInit() {
    this.crossOriginIsolatedValue = (window as any).crossOriginIsolated === true;
    console.log('crossOriginIsolated vale: ' + this.crossOriginIsolatedValue);
    this.setupPerformanceObservers();
    this.connectSharedWorker();
  }

  setupPerformanceObservers() {
    try {
      const eventObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const entry: any = entries[i];
          if (entry.duration && entry.duration > this.inpValue) {
            this.inpValue = entry.duration;
          }
        }
      });
      eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 } as any);
    } catch (e) {
      console.log('Este navegador no permite medir el INP directamente');
    }

    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        this.longTaskCount += list.getEntries().length;
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true } as any);
    } catch (e) {
      console.log('Este navegador no soporta longtask');
    }
  }

  connectSharedWorker() {
    try {
      const shared = new SharedWorker(new URL('./shared-index.worker', import.meta.url));
      this.sharedWorkerConnection = shared.port;
      this.sharedWorkerConnection.start();
      this.sharedWorkerConnection.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'result-updated' && message.payload) {
          console.log('Se recibió un resultado ya calculado desde otra pestaña');
          this.rankingList = message.payload.rankingList || [];
          if (this.rankingList.length > 0) {
            this.statusMessage = 'Resultado cargado desde otra pestaña, no fue necesario procesar de nuevo';
          }
        }
      };
      this.sharedWorkerConnection.postMessage({ type: 'ask-result' });
    } catch (e) {
      console.log('Este navegador no soporta SharedWorker');
    }
  }

  onTopologyFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.split('\n');
      this.topologyRows = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.indexOf('nodo_id') === 0) {
          continue;
        }
        const parts = line.split(',');
        if (parts.length < 5) {
          continue;
        }
        this.topologyRows.push({
          nodeId: parts[0],
          type: parts[1],
          parentId: parts[2],
          from: parseInt(parts[3], 10),
          to: parseInt(parts[4], 10)
        });
      }
      console.log('Topologia cargada, filas: ' + this.topologyRows.length);
    };
    reader.readAsText(file);
  }

  onReadingsFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    this.startProcessing(file);
  }

  startProcessing(file: File) {
    this.isProcessing = true;
    this.statusMessage = 'Procesando archivo de lecturas';
    this.progressBlocks = 0;
    this.finishedWorkers = 0;
    this.meterIdColumn = [];
    this.timestampColumn = [];
    this.valueColumn = [];
    this.versionColumn = [];
    this.flagsColumn = [];
    this.meterIndex = new Map();
    this.nextMeterIndex = 0;

    const blockSize = 4 * 1024 * 1024;
    this.totalBlocks = Math.ceil(file.size / blockSize);

    this.workerCount = navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    console.log('Numero de workers segun hardwareConcurrency: ' + this.workerCount);

    const sharedBuffer = new SharedArrayBuffer(4);
    const counterView = new Int32Array(sharedBuffer);
    counterView[0] = 0;

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(new URL('./process.worker', import.meta.url));
      worker.onmessage = (event: MessageEvent) => {
        this.handleWorkerMessage(event.data, worker);
      };
      worker.postMessage({
        file: file,
        blockSize: blockSize,
        totalSize: file.size,
        sharedBuffer: sharedBuffer
      });
    }
  }

  handleWorkerMessage(data: any, worker: Worker) {
    if (data.type === 'progress') {
      this.progressBlocks++;
      return;
    }

    if (data.type === 'done') {
      for (let i = 0; i < data.meterIds.length; i++) {
        let intId = this.meterIndex.get(data.meterIds[i]);
        if (intId === undefined) {
          intId = this.nextMeterIndex;
          this.meterIndex.set(data.meterIds[i], intId);
          this.nextMeterIndex++;
        }
        this.meterIdColumn.push(intId);
        this.timestampColumn.push(data.timestamps[i]);
        this.valueColumn.push(data.values[i]);
        this.versionColumn.push(data.versions[i]);
        this.flagsColumn.push(data.flags[i]);
      }
      this.totalGaps += data.gapCount;
      this.finishedWorkers++;
      worker.terminate();

      if (this.finishedWorkers === this.workerCount) {
        console.log('Todos los workers terminaron, filas leidas: ' + this.meterIdColumn.length);
        this.afterAllWorkersDone();
      }
    }
  }

  async afterAllWorkersDone() {
    this.statusMessage = 'Resolviendo versiones y huecos';
    await this.resolveVersionsAndGaps();

    this.statusMessage = 'Calculando jerarquia por transformador';
    await this.aggregateByTransformer();

    this.statusMessage = 'Calculando residuales y anomalias';
    await this.calculateResidualsAndAnomalies();

    this.statusMessage = 'Construyendo ranking de transformadores';
    await this.buildRanking();

    this.statusMessage = 'Preparando tabla de medidores';
    this.prepareTableRows();

    this.isProcessing = false;
    this.statusMessage = 'Analisis terminado';

    if (this.sharedWorkerConnection) {
      this.sharedWorkerConnection.postMessage({
        type: 'save-result',
        payload: { rankingList: this.rankingList }
      });
    }

    console.log('Analisis completo terminado');
  }

  yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  async resolveVersionsAndGaps() {
    this.finalReadings = new Map();
    const winningVersion: Map<string, number> = new Map();

    for (let i = 0; i < this.meterIdColumn.length; i++) {
      const key = this.meterIdColumn[i] + '_' + this.timestampColumn[i];
      const currentVersion = this.versionColumn[i];
      const bestVersion = winningVersion.get(key);
      if (bestVersion === undefined || currentVersion >= bestVersion) {
        winningVersion.set(key, currentVersion);
        this.finalReadings.set(key, {
          value: this.valueColumn[i],
          version: currentVersion,
          flags: this.flagsColumn[i]
        });
      }
      if (i % 200000 === 0) {
        await this.yieldToBrowser();
      }
    }

    const sumPerMeter: Map<number, number> = new Map();
    const countPerMeter: Map<number, number> = new Map();
    this.finalReadings.forEach((reading, key) => {
      const meterIntId = parseInt(key.split('_')[0], 10);
      if (!isNaN(reading.value)) {
        sumPerMeter.set(meterIntId, (sumPerMeter.get(meterIntId) || 0) + reading.value);
        countPerMeter.set(meterIntId, (countPerMeter.get(meterIntId) || 0) + 1);
      }
    });

    let imputedCount = 0;
    let totalCount = 0;
    this.finalReadings.forEach((reading, key) => {
      totalCount++;
      if (isNaN(reading.value)) {
        const meterIntId = parseInt(key.split('_')[0], 10);
        const total = sumPerMeter.get(meterIntId) || 0;
        const count = countPerMeter.get(meterIntId) || 1;
        reading.value = total / count;
        imputedCount++;
      }
    });

    this.imputedPercentage = totalCount > 0 ? (imputedCount / totalCount) * 100 : 0;
    console.log('Porcentaje de valores imputados: ' + this.imputedPercentage.toFixed(2) + '%');

    let minTimestamp = Infinity;
    for (let i = 0; i < this.timestampColumn.length; i++) {
      if (this.timestampColumn[i] < minTimestamp) {
        minTimestamp = this.timestampColumn[i];
      }
    }
    this.monthStartTimestamp = minTimestamp === Infinity ? 0 : minTimestamp;
  }

  getTopologyRowAt(nodeId: string, timestamp: number): TopologyRow | null {
    for (let i = 0; i < this.topologyRows.length; i++) {
      const row = this.topologyRows[i];
      if (row.nodeId === nodeId && timestamp >= row.from && timestamp < row.to) {
        return row;
      }
    }
    return null;
  }

  async aggregateByTransformer() {
    this.transformerHourSum = {};
    this.macroHourValue = {};

    const reverseIndex: string[] = [];
    this.meterIndex.forEach((intId, meterId) => {
      reverseIndex[intId] = meterId;
    });

    let processed = 0;
    const entries: [string, { value: number, version: number, flags: number }][] = Array.from(this.finalReadings.entries());

    for (let e = 0; e < entries.length; e++) {
      const key = entries[e][0];
      const reading = entries[e][1];
      const parts = key.split('_');
      const meterIntId = parseInt(parts[0], 10);
      const timestamp = parseInt(parts[1], 10);
      const meterId = reverseIndex[meterIntId];
      const hourIndex = Math.floor((timestamp - this.monthStartTimestamp) / 3600);

      if (hourIndex < 0 || hourIndex >= this.hourCount || !meterId) {
        continue;
      }

      const topologyRow = this.getTopologyRowAt(meterId, timestamp);

      if (!topologyRow) {
        processed++;
        continue;
      }

      if (topologyRow.type === 'TRAFO') {
        if (!this.macroHourValue[meterId]) {
          this.macroHourValue[meterId] = new Array(this.hourCount).fill(0);
        }
        this.macroHourValue[meterId][hourIndex] += reading.value;
      } else {
        const transformerId = topologyRow.parentId;
        if (!this.transformerHourSum[transformerId]) {
          this.transformerHourSum[transformerId] = new Array(this.hourCount).fill(0);
        }
        this.transformerHourSum[transformerId][hourIndex] += reading.value;
      }

      processed++;
      if (processed % 200000 === 0) {
        console.log('Registros agregados a transformadores: ' + processed);
        await this.yieldToBrowser();
      }
    }

    console.log('Agregacion jerarquica terminada, transformadores encontrados: ' + Object.keys(this.transformerHourSum).length);
  }

  async calculateResidualsAndAnomalies() {
    this.residualValue = {};
    this.anomalyFlag = {};
    const transformerIds = Object.keys(this.transformerHourSum);

    for (let t = 0; t < transformerIds.length; t++) {
      const transformerId = transformerIds[t];
      const sumArray = this.transformerHourSum[transformerId];
      const macroArray = this.macroHourValue[transformerId] || new Array(this.hourCount).fill(0);
      const residualArray = new Array(this.hourCount).fill(0);
      const anomalyArray = new Array(this.hourCount).fill(false);

      for (let h = 0; h < this.hourCount; h++) {
        const technicalLoss = macroArray[h] * 0.03;
        residualArray[h] = macroArray[h] - sumArray[h] - technicalLoss;
      }

      for (let h = 0; h < this.hourCount; h++) {
        const windowStart = Math.max(0, h - 167);
        const windowValues = residualArray.slice(windowStart, h + 1);
        if (windowValues.length >= 24) {
          const sorted = windowValues.slice().sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const deviations = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
          const mad = deviations[Math.floor(deviations.length / 2)];
          if (residualArray[h] > median + 3 * mad) {
            anomalyArray[h] = true;
          }
        }
      }

      this.residualValue[transformerId] = residualArray;
      this.anomalyFlag[transformerId] = anomalyArray;

      if (t % 50 === 0) {
        await this.yieldToBrowser();
      }
    }

    console.log('Anomalias calculadas para ' + transformerIds.length + ' transformadores');
  }

  async buildRanking() {
    const totals: RankingItem[] = [];
    const transformerIds = Object.keys(this.residualValue);

    for (let t = 0; t < transformerIds.length; t++) {
      const transformerId = transformerIds[t];
      const residualArray = this.residualValue[transformerId];
      const anomalyArray = this.anomalyFlag[transformerId];
      let total = 0;
      for (let h = 0; h < residualArray.length; h++) {
        if (anomalyArray[h]) {
          total += residualArray[h];
        }
      }
      totals.push({ transformerId: transformerId, totalLoss: total });
      if (t % 200 === 0) {
        await this.yieldToBrowser();
      }
    }

    totals.sort((a, b) => b.totalLoss - a.totalLoss);
    this.rankingList = totals.slice(0, 200);
    console.log('Ranking construido, transformador con mayor perdida: ' +
      (this.rankingList[0] ? this.rankingList[0].transformerId : 'ninguno'));
  }

  prepareTableRows() {
    this.tableRows = [];
    const reverseIndex: string[] = [];
    this.meterIndex.forEach((intId, meterId) => {
      reverseIndex[intId] = meterId;
    });

    for (let i = 0; i < reverseIndex.length; i++) {
      const meterId = reverseIndex[i];
      if (!meterId) {
        continue;
      }
      let transformerId = '-';
      for (let r = 0; r < this.topologyRows.length; r++) {
        if (this.topologyRows[r].nodeId === meterId && this.topologyRows[r].type === 'MEDIDOR') {
          transformerId = this.topologyRows[r].parentId;
          break;
        }
      }
      this.tableRows.push({ meterId: meterId, transformerId: transformerId });
    }

    this.filteredRows = this.tableRows;
    console.log('Tabla preparada con ' + this.tableRows.length + ' medidores');
  }

  onFilterChange() {
    const text = this.filterText.toLowerCase();
    if (text === '') {
      this.filteredRows = this.tableRows;
    } else {
      this.filteredRows = this.tableRows.filter((row) => {
        return row.meterId.toLowerCase().indexOf(text) !== -1 ||
          row.transformerId.toLowerCase().indexOf(text) !== -1;
      });
    }
  }

  getAllDescendantTransformers(nodeId: string): string[] {
    const directChildren: string[] = [];
    for (let i = 0; i < this.topologyRows.length; i++) {
      const row = this.topologyRows[i];
      if (row.parentId === nodeId && row.type === 'TRAFO') {
        directChildren.push(row.nodeId);
      }
    }
    if (directChildren.length === 0 && Object.prototype.hasOwnProperty.call(this.transformerHourSum, nodeId)) {
      return [nodeId];
    }
    return directChildren;
  }

  querySubtree() {
    let total = 0;
    const nodeId = this.selectedSubtreeNode.trim();
    if (nodeId === '') {
      return;
    }
    const transformerIds = this.getAllDescendantTransformers(nodeId);
    for (let i = 0; i < transformerIds.length; i++) {
      const array = this.transformerHourSum[transformerIds[i]];
      if (!array) {
        continue;
      }
      for (let h = this.subtreeHourFrom; h <= this.subtreeHourTo && h < array.length; h++) {
        total += array[h];
      }
    }
    this.subtreeResult = total;
    console.log('Consulta de subarbol para ' + nodeId + ': ' + total.toFixed(2) + ' kwh');
  }

  async runTransferBenchmark() {
    this.benchmarkRunning = true;
    const sizes = [1 * 1024 * 1024, 8 * 1024 * 1024, 32 * 1024 * 1024];
    this.transferBenchmarkResults = [];

    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];

      const bufferForCopy = new ArrayBuffer(size);
      const startCopy = performance.now();
      await this.sendToTempWorker(bufferForCopy, false);
      const copyTime = performance.now() - startCopy;

      const bufferForTransfer = new ArrayBuffer(size);
      const startTransfer = performance.now();
      await this.sendToTempWorker(bufferForTransfer, true);
      const transferTime = performance.now() - startTransfer;

      this.transferBenchmarkResults.push({
        size: (size / 1024 / 1024) + ' MB',
        copyTime: copyTime,
        transferTime: transferTime
      });

      console.log('Tamaño ' + (size / 1024 / 1024) + ' MB, copia: ' +
        copyTime.toFixed(2) + ' ms, transferencia: ' + transferTime.toFixed(2) + ' ms');
    }

    this.benchmarkRunning = false;
  }

  sendToTempWorker(buffer: ArrayBuffer, useTransfer: boolean): Promise<void> {
    return new Promise((resolve) => {
      const worker = new Worker(new URL('./process.worker', import.meta.url));
      worker.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'echo-done') {
          worker.terminate();
          resolve();
        }
      };
      if (useTransfer) {
        worker.postMessage({ type: 'echo', buffer: buffer }, [buffer]);
      } else {
        worker.postMessage({ type: 'echo', buffer: buffer });
      }
    });
  }
}
