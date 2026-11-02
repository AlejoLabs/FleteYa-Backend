# FleteYa · Backend

API de **FleteYa**, una app colombiana de fletes en la que el cliente propone el precio y los conductores le hacen ofertas, al estilo InDriver. Solo maneja vehículos de carga: carry, camioneta de estacas, furgón y camión.

La app móvil está en [FleteYa-Frontend](https://github.com/AlejoLabs/FleteYa-Frontend).

## Qué hace

- **Cuentas:** registro de cliente y de conductor (con vehículo y documentos), inicio de sesión con correo o con Google, recuperación de contraseña con un código por correo.
- **Solicitudes y negociación:** precio sugerido según distancia, tiempo, peso, tamaño y vehículo. El cliente sube su oferta y los conductores cercanos que tienen un vehículo donde cabe la carga contraofertan. También hay fletes programados.
- **Viaje en curso:** posición del conductor en tiempo real (Socket.IO), fotos al cargar y al entregar, y un código de entrega de 4 dígitos para cerrar el viaje.
- **Pagos:** en efectivo o por la app. Hay integración con Wompi y una pasarela de prueba propia mientras no haya llaves de Wompi. La comisión de FleteYa (10 %) se guarda en cada viaje.
- **Después del viaje:** chat entre cliente y conductor, calificaciones y reporte de incidentes.
- **Notificaciones push** con Firebase Cloud Messaging: ofertas, conductor asignado, solicitudes nuevas cerca, documentos por vencer, etc.
- **Panel de administración web** en `/admin`:
  - Estadísticas del negocio.
  - Verificación de conductores: los nuevos esperan aprobación.
  - Suspender, reactivar o anonimizar cuentas.
  - Viajes, pagos y liquidación de comisiones en efectivo.
  - Incidentes y tarifas.
  - Registro de cada acción del admin.

## Tecnologías

Node.js, TypeScript, Express 5, Prisma 7 con MySQL o MariaDB, Socket.IO, JWT con bcryptjs, Zod, Multer, Nodemailer y Firebase Admin.

## Requisitos

- Node.js 20 o más nuevo.
- MySQL 8 o MariaDB.
- Una llave de Google Maps con la **Distance Matrix API** activa.
- Opcional:
  - Un proyecto de Firebase, para las notificaciones push.
  - Un correo con contraseña de aplicación, para los códigos de recuperación.
  - Un ID de cliente de Google, para entrar con Google.

## Puesta en marcha

```bash
git clone https://github.com/AlejoLabs/FleteYa-Backend.git
cd FleteYa-Backend
npm install

# Variables de entorno: copia el ejemplo y llena tus valores
cp .env.example .env

# Crea las tablas, genera el cliente de Prisma y carga los datos base (roles y tarifas)
npx prisma migrate deploy
npx prisma generate
npm run db:seed

# Servidor en modo desarrollo (se recarga solo)
npm run dev
```

Antes de correr la migración, crea la base de datos vacía que pusiste en `DATABASE_URL`, por ejemplo `CREATE DATABASE fleteya;`.

## Panel de administración

Corre en el mismo servidor, en `http://HOST:PORT/admin`. Para entrar, crea una cuenta desde la app (o con `POST /auth/register`) y dale el rol de administrador:

```bash
npm run admin:grant -- tu-correo@ejemplo.com
```

Desde el panel:

- **Conductores.** Un conductor nuevo queda "en revisión" hasta que lo apruebes. Solo los conductores aprobados y con documentos vigentes pueden ponerse disponibles, ver solicitudes y ofertar. Si lo rechazas, la app le muestra el motivo, y cuando corrige sus datos vuelve a la cola.
- **Suspender una cuenta.** La sesión se corta al instante: su siguiente petición responde `403 ACCOUNT_SUSPENDED` y su conexión en tiempo real se cierra. La app vuelve al inicio de sesión mostrando el motivo.
- **Anonimizar una cuenta** (Ley 1581 de 2012). Borra nombre, correo, celular, foto y documentos de la persona, y conserva sus viajes y pagos.
- **Comisiones.** En los viajes pagados en efectivo, el conductor recibe todo el dinero y le debe la comisión a FleteYa. Desde "Pagos y comisiones" se marca como liquidada cuando la entrega.
- **Tarifas y comisión.** Los cambios aplican a los fletes nuevos. Cada viaje ya acordado guardó su propia comisión.

La sesión del panel es aparte de la de la app:

- Vive en una cookie `httpOnly` y `SameSite=Strict` que dura 8 horas.
- Todo cambio exige además el encabezado `X-FleteYa-Admin`.
- Cada acción queda en el registro de acciones del panel.

El servidor queda en `http://HOST:PORT`. Para probar desde un emulador o un celular, `HOST` debe ser la IP de tu PC en la red Wi-Fi, no `localhost`.

## Variables de entorno

Todas están explicadas en [`.env.example`](.env.example).

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | Conexión a MySQL o MariaDB |
| `HOST`, `PORT` | Dirección del servidor. También se usa para armar las direcciones de las fotos |
| `JWT_SECRET` | Firma de las sesiones. Usa una cadena larga y aleatoria |
| `GOOGLE_MAPS_API_KEY` | Distancia y tiempo de cada flete |
| `SMTP_*`, `MAIL_FROM` | Correo con el código para restablecer la contraseña. Sin esto, el código se imprime en la consola |
| `GOOGLE_WEB_CLIENT_ID` | Entrar con Google |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Ruta al JSON de la cuenta de servicio de Firebase, para las notificaciones push |
| `WOMPI_*` | Llaves de Wompi. Si están, se cobra con Wompi |
| `PAYMENTS_SIMULATOR` | Si no hay llaves de Wompi y vale `true`, se usa la pasarela de prueba |
| `TEST_*` | Cuentas para `npm test` |

## Lo que nunca se sube al repositorio

El `.gitignore` ya deja fuera estos archivos:

- `.env`, con las claves reales.
- `firebase-service-account.json`, la llave privada de Firebase.
- `storage/`, con las fotos privadas de viajes, vehículos e incidentes. Solo las ven quienes tienen permiso.
- `public/uploads/`, con las fotos de perfil.
- `src/generated/prisma`, que se genera con `npx prisma generate`.

Si alguna llave se llega a publicar por error, cámbiala en el servicio que la emitió (Google Cloud, Firebase, Wompi o Gmail). Borrarla del código no basta: queda en el historial de git.

## Pagos de prueba

Sin llaves de Wompi y con `PAYMENTS_SIMULATOR=true`, "Pagar por la app" abre una pasarela de prueba propia en `/payments/simulator`. Pide tarjeta, Nequi o PSE, pero solo acepta estos datos de prueba y nunca guarda los números.

| Medio | Aprobado | Rechazado |
|---|---|---|
| Tarjeta | `4242 4242 4242 4242` | `4111 1111 1111 1111` |
| Nequi | `3991111111` | `3992222222` |
| PSE | "Banco de pruebas que aprueba" | "Banco de pruebas que rechaza" |

Para la tarjeta sirve cualquier fecha futura y cualquier CVC de 3 dígitos. Con las tres llaves `WOMPI_*` en el `.env` se usa el checkout real de Wompi, en modo sandbox si las llaves son de prueba, sin cambiar código.

## Pruebas

```bash
npm test
```

Corren 8 suites contra el servidor encendido: seguridad, negociación, cuentas, fotos y entrega, chat con calificaciones e incidentes, pagos, vehículos y panel de administración.

Antes de correrlas, en tu base local deben existir el cliente y el conductor de `TEST_CLIENT_EMAIL` y `TEST_DRIVER_EMAIL`. El conductor debe tener un vehículo de estacas.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm run build` | Compila TypeScript |
| `npm test` | Pruebas de la API |
| `npm run db:seed` | Roles y tarifas base. Se puede correr varias veces |
| `npm run admin:grant -- correo` | Da el rol de administrador a una cuenta que ya existe, para entrar al panel |
| `npm run trips:cancel-stale -- 6` | Cancela los viajes abiertos que llevan más de 6 horas sin cambios |
| `npm run users:hash-passwords` | Cifra contraseñas antiguas que hayan quedado en texto plano |

## Estructura

```
src/
├── server.ts        Punto de entrada: Express, rutas y Socket.IO
├── config/          JWT
├── controllers/     Leen la petición y llaman al servicio
├── services/        Reglas del negocio y acceso a la base (admin/ para el panel)
├── routes/          Rutas de cada recurso, incluida la pasarela de prueba
├── middlewares/     Sesión, validación, subida de fotos y errores
├── validators/      Esquemas Zod de lo que entra
├── sockets/         Eventos en tiempo real, con sesión verificada
├── utils/           Permisos, push, correo, pagos, vehículos
├── scripts/         Tareas de mantenimiento y datos base
└── database/        Cliente de Prisma
prisma/
├── schema.prisma    Modelo de datos
└── migrations/      Historial de cambios de la base
admin/               Panel web (HTML, CSS y JavaScript sin compilar; las vistas en views/)
tests/               Pruebas de la API (npm test)
```

## API

Todas las rutas, salvo las de `/auth`, piden el encabezado `Authorization: Bearer <token>`. Cada usuario solo ve y modifica lo suyo; los accesos negados quedan registrados.

| Recurso | Rutas principales |
|---|---|
| `/auth` | `login`, `register`, `register-driver`, `google`, `forgot-password`, `reset-password`, `password` |
| `/client-requests` | Crear y cotizar fletes, solicitudes cercanas, cancelar, subir el precio, estados del viaje, entrega con código, fotos, chat, incidentes, calificaciones y pago |
| `/driver-trip-offers` | Ofertar, rechazar y retirar ofertas |
| `/driver-car-info` | Vehículo, capacidad, documentos y fotos del conductor |
| `/drivers-position` | Posición de los conductores disponibles |
| `/users` | Perfil, foto y token de notificaciones |
| `/payments` | Pasarela de prueba y regreso desde Wompi |
| `/admin/api` | API del panel, con su propia sesión: estadísticas, usuarios, conductores, viajes, pagos, incidentes, tarifas y registro |

Un token vencido o inválido responde `401` con `code: "SESSION_EXPIRED"`, y una cuenta suspendida, `403` con `code: "ACCOUNT_SUSPENDED"`. Así la app sabe que debe volver al inicio de sesión. Un conductor sin aprobar recibe `403` con `code: "DRIVER_NOT_APPROVED"` y el motivo. Tras 5 intentos fallidos de inicio de sesión con el mismo correo, ese correo espera 15 minutos.

## Licencia

[MIT](LICENSE) © 2026 Alejandro Beltrán
