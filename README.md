# Caso de estudio 2 - Auditoria de perdidas de energia

Aplicacion en Angular que procesa el archivo de lecturas de medidores directamente en el navegador, usando Web Workers, SharedWorker y Service Worker, sin subir el archivo a ningun servidor.

## Como correr el proyecto (con Sublime Text solo se edita el codigo, para ejecutarlo se necesita Node.js instalado)

1. Instalar dependencias:
   npm install

2. Generar datos de prueba (opcional, crea lecturas_mes.csv y topologia.csv en la raiz):
   npm run generar-datos

3. Modo desarrollo:
   npm start
   Esto abre en http://localhost:4200


Flujo del dato
El usuario selecciona los archivos topologia.csv y lecturas_mes.csv.
El programa lee topologia.csv completo porque es un archivo pequeño.
lecturas_mes.csv es más grande, por eso se divide en bloques de 4 MB.
Se crean varios Workers para trabajar con los bloques al mismo tiempo.
Cada Worker toma un bloque, lee sus datos y los convierte en filas.
Los Workers comparten un contador para saber qué bloque deben leer después.
El programa junta todos los datos y organiza los medidores usando un Map.
Si hay datos repetidos, se conserva la versión más reciente.
Si falta una lectura, se calcula un promedio para completar el dato.
Se usa topologia.csv para saber qué medidores pertenecen a cada transformador.
Se suman las lecturas de los medidores por cada hora.
Se compara el consumo de los medidores con el consumo del transformador para encontrar posibles pérdidas.
Las horas que presentan valores extraños se marcan como anomalías.
Se suman las pérdidas de cada transformador y se ordenan para mostrar los 200 con mayores pérdidas.
El resultado se guarda para que otra pestaña pueda utilizarlo sin procesar nuevamente todos los archivos.