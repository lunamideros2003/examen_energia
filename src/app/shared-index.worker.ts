/// <reference lib="webworker" />

let storedResult: any = null;
const connectedPorts: MessagePort[] = [];

(self as any).onconnect = function (event: any) {
  const port = event.ports[0];
  connectedPorts.push(port);

  console.log('Nueva pestaña conectada, total pestañas: ' + connectedPorts.length);

  port.onmessage = function (messageEvent: any) {
    const message = messageEvent.data;

    if (message.type === 'save-result') {
      storedResult = message.payload;
      console.log('Resultado guardado en el shared worker, se avisa a las demas pestañas');
      for (let i = 0; i < connectedPorts.length; i++) {
        connectedPorts[i].postMessage({ type: 'result-updated', payload: storedResult });
      }
    }

    if (message.type === 'ask-result') {
      port.postMessage({ type: 'result-updated', payload: storedResult });
    }
  };

  port.start();
};
