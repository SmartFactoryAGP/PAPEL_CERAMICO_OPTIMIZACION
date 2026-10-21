// Cada persona imprime en SU Zebra: ZEBRA_PRINTER_POR_USUARIO manda ZUND1 a la impresora compartida de
// otra PC (\PC-ZUND\ZEBRA); el resto, a la de este puente. Las impresoras no existen en la prueba:
// se mira a QUÉ destino intentó mandar el puente (queda en su registro).
const assert = require('assert');
const { ok, sleep, prepararCopia, borrarCopia, arrancarPuente, api, login, prueba } = require('./comun');

prueba('Impresión: cada usuario en su Zebra', async limpiar=>{
  const dir = prepararCopia('impresion'); limpiar(()=>borrarCopia(dir));
  const p = await arrancarPuente(dir, 5132, { ZEBRA_PRINTER_SHARE: 'ZEBRA_DEL_PUENTE', ZEBRA_PRINTER_POR_USUARIO: 'ZUND1=\\\\PC-ZUND\\ZEBRA;Beto=OTRA_LOCAL;Raro=\\\\x\\y"&calc', ZEBRA_PAUSA_MS: '50' });
  limpiar(()=>p.cerrar());
  const adm = await login(p.url, 'Hfrodriguez', 'admin123');
  const crear = (usuario, clave, permisos) => api(p.url, 'POST', '/api/usuarios', { token: adm, cuerpo: { usuario, clave, permisos } });
  await crear('ZUND1', 'zund01', { tejidos: ['rack'] });
  const imprimir = async (usuario, clave) => api(p.url, 'POST', '/api/imprimir-zpl', { token: await login(p.url, usuario, clave), area: 'tejidos', cuerpo: { zpl: '^XA^XZ' } });

  await imprimir('ZUND1', 'zund01'); await imprimir('Ana', 'ana123'); await imprimir('Beto', 'beto123');
  const log = p.log();
  assert.ok(log.includes('→ \\\\PC-ZUND\\ZEBRA:'), 'ZUND1 tiene que ir a la Zebra de su PC:\n' + log);
  assert.ok(log.includes('→ \\\\localhost\\ZEBRA_DEL_PUENTE:'), 'Ana (sin destino propio) va a la Zebra del puente');
  assert.ok(log.includes('→ \\\\localhost\\OTRA_LOCAL:'), 'Beto va a otra impresora de este puente');
  assert.ok(!/calc/.test(log.replace(/ZEBRA_PRINTER_POR_USUARIO[^\n]*/g, '')), 'un destino con & o comillas no se acepta');
  ok('ZUND1 → \\PC-ZUND\ZEBRA, Ana → la del puente, Beto → otra compartida local; un destino con caracteres raros se ignora');

  assert.strictEqual((await api(p.url, 'POST', '/api/imprimir-zpl', { area: 'tejidos', cuerpo: { zpl: 'x' } })).s, 401, 'sin sesión');
  ok('sin sesión no imprime');
});
