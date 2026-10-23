// Los scripts de base de datos no necesitan toda la configuración del servidor.
export function loadConfigForScripts() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero',
    datosGovToken: process.env.DATOSGOV_APP_TOKEN,
  }
}
