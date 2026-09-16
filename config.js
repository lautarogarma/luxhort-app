// ============================================================
//  Los dos datos del proyecto de Supabase
// ============================================================
//  Están en un archivo aparte a propósito: es lo único que cambia entre un
//  proyecto y otro, y así actualizar la aplicación no pisa la configuración
//  ni al revés.
//
//  Los dos son PÚBLICOS por diseño. La clave `anon` viaja dentro de la
//  aplicación —cualquiera que abra la página la puede leer— y eso está bien:
//  lo que protege los datos NO es su secreto, son las políticas de acceso que
//  instala `esquema.sql`. Sin haber iniciado sesión, con la anon en la mano
//  no se ve nada.
//
//  La que NO va acá ni en ningún otro lado del lado del cliente es la
//  `service_role`: saltea todas las políticas.
//
//  Este archivo NO se embebe en el firmware: la copia que sirve el equipo en
//  la red local no habla con la nube. Ver docs/ARQUITECTURA-ACCESO-REMOTO.md.
window.CFG = {
  // Project Settings → API → Project URL
  url: "https://tptdmbfmbgfzfxlkkbja.supabase.co",

  // Project Settings → API → API Keys → publishable
  // Empieza con "sb_publishable_". Los proyectos viejos usan en su lugar un
  // JWT largo que empieza con "eyJ"; los dos sirven, es el mismo permiso.
  anon: "sb_publishable_XiAue8O59_-XY-8QJHfIfw_b5Ko_y2u",
};
