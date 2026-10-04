# Recepción del gimnasio

Sistema para la recepción del gimnasio: registrar entradas con QR o cédula, cobrar pases diarios y mensualidades, avisar por WhatsApp a quienes se les vence la membresía y ver los ingresos y las horas de más tráfico.

## Requisitos

- [Node.js](https://nodejs.org) 22.13 o más nuevo, instalado en la computadora que hará de servidor.
- La tablet de recepción y esa computadora deben estar conectadas a la misma red wifi.

## Instalación (una sola vez)

```
npm install
```

## Uso diario

```
npm start
```

La consola muestra dos direcciones:

- **En este equipo:** `http://localhost:3100`
- **En la tablet o celular:** `https://192.168.x.x:3443` (ábrela en el navegador y agrégala a la pantalla de inicio). Si alguien abre la dirección `http://…:3100` desde otro equipo, el sistema lo lleva solo a esta.

La primera vez, el celular mostrará **"La conexión no es privada"**. Es normal: el certificado de seguridad lo genera el propio sistema (se guarda en `data/cert/`). Toca **Configuración avanzada → Acceder** y no vuelve a preguntar. Hace falta HTTPS porque los celulares y tablets solo permiten usar la cámara en páginas seguras.

Los datos se guardan en `data/gym.db`. **Copia ese archivo con frecuencia** (a un pendrive o a la nube): ahí está todo.

## Probar con datos de ejemplo

```
npm run demo
```

Crea `data/demo.db` con 160 miembros y dos meses de entradas inventadas, y abre el sistema con esos datos. No toca tu base real (`data/gym.db`).

## Demo web (Netlify)

Para presentar el proyecto hay una versión **demo que funciona solo en el navegador**: no necesita el servidor ni toca la base real. Las reglas del sistema corren en el navegador (SQLite compilado para la web) y cada visitante recibe su propia copia con datos de ejemplo, guardada en su navegador. La franja de arriba tiene un botón **Reiniciar demo**.

```
npm run demo:web     # la arma en dist/ y la abre en http://localhost:4173
npm run build:demo   # solo la arma (es lo que ejecuta Netlify)
```

`netlify.toml` ya tiene la configuración: Netlify ejecuta `npm run build:demo` y publica la carpeta `dist/`.

## Cómo funciona

### Estados de la membresía

| Estado | Cuándo (valores por defecto) | ¿Entra? |
|---|---|---|
| Al día | Faltan más de 5 días para el corte | Sí |
| Por vencer | Faltan 5 días o menos (incluye el mismo día) | Sí, con aviso |
| En gracia | Venció hace 1 a 3 días | Sí, con alerta |
| Vencida | Venció hace más de 3 días | No, hasta renovar |
| Inactivo | Venció hace más de 30 días | No (se considera ex-miembro) |

Todos estos días se cambian en **Ajustes**.

### Renovaciones

Si el miembro renueva dentro de los 15 días siguientes a su corte, el nuevo periodo **cuenta desde la fecha de corte**, no desde el día en que paga. Por ejemplo, si vencía el 29 sep y paga el 3 oct, queda hasta el 29 oct. Si vuelve después de mucho tiempo, el periodo empieza el día que paga.

### Clientes de pase diario con QR

La primera vez que alguien paga el día, se anotan su nombre (y si quiere, su cédula y teléfono) con la casilla **"Guardar sus datos y darle un QR"** marcada. Recibe un código `D00001` con su QR, que se le puede enviar por WhatsApp.

Las siguientes veces se escanea su QR (o se escribe su cédula o teléfono): aparece su nombre y solo se elige el método de pago. Si vuelve el mismo día, entra **sin pagar otra vez**.

En la pestaña **Pase diario** se ve cuánto vino y gastó cada uno en el mes y a quién **le conviene la mensualidad**. Con "Inscribir" pasa a ser miembro sin reescribir sus datos.

### Escanear el QR

- **Lector de códigos USB o Bluetooth (recomendado):** funciona como un teclado. Escanea el carnet y la entrada se registra sola.
- **Cámara:** funciona en la tablet o el celular abriendo la dirección `https://…:3443`, y en la computadora con `localhost`.
- Siempre se puede escribir la cédula (con o sin puntos y guiones) o el código del miembro (`M00001`).

### WhatsApp

Los botones de **Recordar** y **Enviar por WhatsApp** abren WhatsApp con el mensaje ya escrito; solo hay que tocar enviar. Los mensajes no salen solos: para eso hace falta la API de WhatsApp Business (es un servicio de pago).

### "En el gym ahora"

Es un estimado: cuenta a quienes entraron en los últimos 90 minutos (ajustable). No se registran las salidas.

## Pendientes antes de usarlo con clientes reales

- **No tiene contraseña.** Cualquier persona conectada a la misma red wifi puede abrirlo. Úsalo en una red privada, no en el wifi para clientes.
- No hay forma de anular un pago registrado por error desde la pantalla.

## Desarrollo

```
npm test     # pruebas de las reglas de negocio
```

- `server.js`: servidor web
- `src/service.js`: reglas del negocio (estados, renovaciones, cobros, reportes)
- `src/db.js`: base de datos SQLite (incluida en Node, sin instalar nada aparte)
- `public/`: la interfaz (HTML, CSS y JavaScript sin compilación)
