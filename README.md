# Miranda Digital — Web real (backend + base de datos)

## Qué incluye
- Registro de usuarios.
- Cuentas quedan `pending` hasta aprobación.
- Administrador aprueba/rechaza/bloquea.
- Inicio de sesión con contraseña cifrada.
- Sesiones.
- Base de datos SQLite.
- Carga de Excel de asistencia/tareo.
- Procesamiento de DNI, nombre, puesto, ingreso, labor y lote según encabezados.
- Dashboard.
- Historial de cargas.
- Registro de actividad.
- API lista para publicar.

## Ejecutar en una PC/servidor
1. Instala Node.js 20+.
2. Abre terminal dentro de esta carpeta.
3. Ejecuta:
   `npm install`
4. Ejecuta:
   `npm start`
5. Abre:
   `http://localhost:3000`

Usuario inicial:
- usuario: `admin`
- contraseña: `admin123`

Antes de publicar cambia:
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Ejemplo:
`ADMIN_PASSWORD="una-clave-segura" SESSION_SECRET="otra-clave-larga" npm start`

## Para ponerlo online
Este proyecto ya contiene frontend + backend. En un hosting que soporte Node.js se despliega la carpeta, se ejecuta `npm install` y `npm start`, y se configura almacenamiento persistente para `miranda.db`.

Para varios usuarios simultáneos, usa un servidor con HTTPS y almacenamiento persistente. SQLite funciona para una primera versión; para crecimiento se puede migrar a PostgreSQL sin cambiar la interfaz.
