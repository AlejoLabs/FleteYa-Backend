# API REST con Node.js

API REST construida con **Node.js**, **Express**, **TypeScript**, **Prisma** y **Socket.io**. Incluye autenticación JWT, manejo de archivos con Multer y validaciones con Zod.

---

## Tecnologías

- **Runtime:** Node.js + TypeScript
- **Framework:** Express 5
- **ORM:** Prisma (MySQL / MariaDB)
- **Autenticación:** JWT + bcryptjs
- **Tiempo real:** Socket.io
- **Validación:** Zod
- **Archivos:** Multer

---

## Requisitos previos

- Node.js >= 18
- MySQL o MariaDB corriendo localmente
- Una API Key de Google Maps (para cálculo de distancias y tiempos)

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd ApiRestNodeJs

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores reales

# 4. Generar el cliente de Prisma y aplicar migraciones
npx prisma migrate deploy
npx prisma generate
```

---

## Uso

```bash
# Modo desarrollo (recarga automática)
npm run dev

# Compilar a JavaScript
npm run build
```

El servidor arranca en `http://{HOST}:{PORT}` (por defecto `http://localhost:3000`).

---

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Bienvenida |
| POST | `/auth/login` | Iniciar sesión |
| POST | `/auth/register` | Registrar usuario |
| GET | `/users` | Listar usuarios |
| GET | `/drivers-position` | Posiciones de conductores |
| GET | `/client-requests` | Solicitudes de clientes |
| GET | `/driver-trip-offers` | Ofertas de viaje |
| GET | `/driver-car-info` | Información del vehículo |

Los archivos estáticos (fotos de perfil, etc.) se sirven desde `/uploads`.

---

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Cadena de conexión a MySQL/MariaDB |
| `HOST` | Host del servidor |
| `PORT` | Puerto del servidor |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT |
| `GOOGLE_MAPS_API_KEY` | API Key de Google Maps |

---

## Estructura del proyecto

```
src/
├── server.ts           # Punto de entrada
├── config/             # Configuración (JWT, etc.)
├── controllers/        # Lógica de cada recurso
├── middlewares/        # Auth, validación, errores, uploads
├── routes/             # Definición de rutas
├── services/           # Lógica de negocio y acceso a BD
├── sockets/            # Eventos de Socket.io
├── utils/              # Utilidades (errores personalizados)
└── validators/         # Esquemas de validación Zod
prisma/
├── schema.prisma       # Modelo de datos
└── migrations/         # Historial de migraciones
public/
└── uploads/            # Archivos subidos por los usuarios
```
