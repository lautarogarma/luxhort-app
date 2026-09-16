// ============================================================
//  nube.js — el transporte remoto de la app
// ============================================================
//  Sólo se carga en el despliegue ALOJADO. La copia que sirve el equipo no
//  lo incluye: en la red de la sala se habla por WebSocket con el equipo
//  directamente, sin cuenta y sin internet, que es justo cuando más falta
//  hace el panel — si se cayó todo y hay que entrar a mirar.
//
//  ── Qué hace y qué NO ──
//  Reemplaza el CÓMO viaja el comando, no el QUÉ. El objeto que se manda es
//  exactamente el mismo JSON que la app ya le pasaba al equipo por WebSocket,
//  y del otro lado lo ejecuta el mismo `handleCmd()`. No hay un segundo
//  formato ni un segundo manejador: la cadena de validación del equipo no
//  puede divergir porque no hay dos.
//
//  ── La cuenta la maneja Auth0, los datos Supabase ──
//  El ingreso (Google, correo y clave, confirmación del correo, clave
//  olvidada) es la página alojada de Auth0: no hay formularios propios que
//  mantener ni correos que redactar, y se ve como cualquier ingreso conocido.
//  Supabase acepta el token de Auth0 como proveedor externo, así que las
//  políticas de la base siguen decidiendo quién ve qué — con el `sub` del
//  token como identidad (ver supabase/auth-externo.sql). La biblioteca de
//  Supabase recibe ese token por `accessToken`; con esa opción su propio
//  módulo de cuentas queda apagado y acá no se usa.
//
//  ── El equipo no recibe: busca ──
//  Un comando se INSERTA en la tabla `comandos` y queda pendiente. El equipo
//  pregunta cada pocos segundos, lo ejecuta y escribe qué pasó. Por eso acá
//  se espera el resultado en vez de darlo por hecho: `enviarComando` no
//  devuelve cuando el comando salió, devuelve cuando el equipo contestó —o
//  cuando venció.
//
//  Y vencen a propósito. Un «encendé las luces» disparado a un equipo sin
//  internet, ejecutado seis horas después cuando vuelve, enciende DE NOCHE:
//  interrumpir la oscuridad puede revertir una floración.
// ============================================================

(function () {
  "use strict";

  const CFG = window.CFG || {};
  if (!CFG.url || !CFG.anon) {
    console.warn("[nube] sin configuración: falta web/supabase/config.js");
    return;
  }

  // ------------------------------------------------------------
  //  Cuenta (Auth0)
  // ------------------------------------------------------------
  const A0 = CFG.auth0 || {};
  const configurado = !!(A0.domain && A0.clientId && A0.audience && window.auth0);
  if (!configurado) console.warn("[nube] falta la configuración de Auth0 en config.js (ver supabase/AUTH0.md)");

  // A dónde vuelve Auth0 después de entrar o salir: esta misma página, sin
  // query ni hash. Tiene que estar en «Allowed Callback URLs» y «Allowed
  // Logout URLs» de la aplicación en Auth0, exacta.
  const RETORNO = location.origin + location.pathname;

  // El cliente se crea una vez y es asíncrono: todo lo que lo usa espera
  // esta promesa. `localstorage` para que la sesión sobreviva a cerrar la
  // pestaña (y a la PWA instalada); los refresh tokens para renovarla sin
  // iframes ocultos, que la CSP de la app no permite.
  const cliente = configurado
    ? window.auth0.createAuth0Client({
        domain: A0.domain,
        clientId: A0.clientId,
        cacheLocation: "localstorage",
        useRefreshTokens: true,
        authorizationParams: {
          redirect_uri: RETORNO,
          audience: A0.audience,
          ui_locales: "es",
        },
      })
    : Promise.resolve(null);

  // El token que se le manda a Supabase en cada consulta. Es el ID TOKEN, no
  // el access token: Supabase lo pide así porque Auth0 quita en silencio los
  // claims sin namespace de los access tokens, y el `role` que pone la acción
  // post-login viajaría vacío (docs de Supabase, third-party/auth0).
  //
  // getTokenSilently() va primero igual: es lo que renueva la sesión con el
  // refresh token cuando el access token venció, y de paso trae un ID token
  // nuevo. Pero los dos vencen por separado (ID token 10 h, access token 24 h
  // por defecto), así que si el ID token ya venció con el access token vivo,
  // se fuerza la renovación saltando el caché.
  //
  // Sin sesión devuelve nulo y la biblioteca manda la clave pública sola: las
  // políticas no dejan ver nada, que es lo correcto.
  async function token() {
    const c = await cliente;
    if (!c) return null;
    try {
      await c.getTokenSilently();
      let claims = await c.getIdTokenClaims();
      if (!claims || (claims.exp || 0) * 1000 < Date.now() + 60000) {
        await c.getTokenSilently({ cacheMode: "off" });
        claims = await c.getIdTokenClaims();
      }
      return claims && claims.__raw ? claims.__raw : null;
    } catch (_) { return null; }
  }

  async function sesion() {
    const c = await cliente;
    if (!c) return false;
    // Sin token utilizable no hay sesión, aunque el caché diga que sí: el
    // refresh token pudo vencer o haber sido revocado.
    if (!(await c.isAuthenticated())) return false;
    return (await token()) !== null;
  }

  // Manda a la página de ingreso de Auth0. No devuelve: la página cambia.
  async function entrar() {
    if (!configurado) throw new Error("Falta configurar el ingreso (Auth0) en config.js — ver supabase/AUTH0.md");
    const c = await cliente;
    await c.loginWithRedirect();
  }

  // Cierra la sesión acá Y en Auth0, y vuelve a esta página.
  async function salir() {
    const c = await cliente;
    if (!c) return;
    await c.logout({ logoutParams: { returnTo: RETORNO } });
  }

  // Quién está adentro: { email, name, sub }. La app mostraba equipos sin decir
  // nunca con qué cuenta se entró: con dos cuentas —la de prueba y la del
  // cliente— no había forma de saber cuál estaba operando el equipo.
  async function usuario() {
    const c = await cliente;
    if (!c) return null;
    try { return (await c.getUser()) || null; } catch (_) { return null; }
  }

  // La vuelta desde Auth0. Devuelve nulo si no venimos de ahí o si entró
  // bien, o el texto del error si el ingreso fue rechazado. Deja la URL
  // limpia en los dos casos: el `code` es de un solo uso y recargar con él
  // en la barra daría un error que no es de nadie.
  async function procesarRetorno() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return null;
    let error = null;
    if (q.has("error")) {
      error = traducirIngreso(q.get("error"), q.get("error_description"));
    } else {
      try {
        const c = await cliente;
        if (c) await c.handleRedirectCallback();
      } catch (e) {
        error = traducirIngreso(e.error, e.error_description || e.message);
      }
    }
    history.replaceState(null, "", location.pathname);
    return error;
  }

  // Los rechazos de Auth0 vienen como código + descripción en inglés. La
  // acción post-login del proyecto (ver AUTH0.md) rechaza con la descripción
  // «correo_sin_confirmar» a quien todavía no abrió el correo de confirmación.
  function traducirIngreso(codigo, desc) {
    const d = String(desc || "");
    if (/correo_sin_confirmar/.test(d))
      return "Te mandamos un correo para confirmar tu cuenta. Abrí el enlace que trae y volvé a tocar Ingresar.";
    if (codigo === "access_denied")  return "No se pudo entrar: " + (d || "acceso denegado");
    if (codigo === "unauthorized")   return "Esta cuenta no tiene acceso: " + (d || "");
    if (codigo === "invalid_state" || /state/i.test(d))
      return "El ingreso venció o se abrió en otra pestaña: tocá Ingresar de nuevo.";
    if (/Failed to fetch|NetworkError/i.test(d)) return "Sin internet";
    return d || codigo || "No se pudo entrar";
  }

  // ------------------------------------------------------------
  //  Datos (Supabase, con el token de Auth0)
  // ------------------------------------------------------------
  const sb = window.supabase.createClient(CFG.url, CFG.anon, { accessToken: token });

  // Cada cuánto se relee el estado. El equipo lo publica cada 15 s, así que
  // pedirlo más seguido no trae nada nuevo — sólo gasta datos del teléfono.
  const ESTADO_MS = 8000;
  // Cuánto se espera a que el equipo conteste un comando antes de decir que
  // no llegó. El equipo busca cada 5 s; con 25 s entran varios intentos.
  const RESPUESTA_MS = 25000;

  let equipoId = null;
  let timerEstado = 0;
  // Se incrementa en cada tick de seguirEstado() — LH-INT-FUNC-001. Sin esto,
  // dos pedidos en vuelo a la vez (uno tarda más de ESTADO_MS por una red
  // lenta y el siguiente ya salió) podían volver en cualquier orden, y el que
  // llegaba SEGUNDO pisaba la pantalla con datos del que salió PRIMERO —
  // aunque fueran los más viejos. Cada tick guarda "el mío es el N", y sólo
  // pinta si sigue siendo el más nuevo cuando la respuesta vuelve.
  let estadoTick = 0;

  // Los mensajes de la base vienen en inglés y son de programador. Se
  // traducen los que un usuario puede provocar; el resto pasa tal cual, que
  // es mejor que un "error desconocido" que no deja buscar nada.
  function traducir(m) {
    const t = String(m || "");
    if (/JWT|JWS|token|expired|Unauthorized/i.test(t)) return "Sesión vencida: volvé a entrar";
    if (/rate limit|too many/i.test(t)) return "Demasiados intentos: esperá un rato";
    if (/Failed to fetch|NetworkError/i.test(t)) return "Sin internet";
    return t;
  }

  // ------------------------------------------------------------
  //  Equipos
  // ------------------------------------------------------------
  async function listarEquipos() {
    const { data, error } = await sb
      .from("equipos")
      .select("id, nombre, serie, estado(datos, actualizado)")
      .order("nombre");
    if (error) throw new Error(traducir(error.message));
    return data || [];
  }

  // Vincular con el código de 8 caracteres que muestra la pantalla, en la
  // pestaña Conexión. Es lo que convierte a quien lo escribe en dueño.
  async function vincular(codigo) {
    const { data, error } = await sb.rpc("vincular_equipo", {
      p_codigo: String(codigo || "").trim().toUpperCase(),
    });
    if (error) throw new Error(traducir(error.message));
    return data;   // el id del equipo
  }

  // ------------------------------------------------------------
  //  Estado
  // ------------------------------------------------------------
  //  Devuelve también CUÁNDO se publicó. Un estado viejo y uno de hace tres
  //  segundos se ven idénticos, y no son lo mismo: el primero significa que
  //  el equipo dejó de hablar.
  async function leerEstado(id) {
    const { data, error } = await sb
      .from("estado").select("datos, actualizado")
      .eq("equipo_id", id).maybeSingle();
    if (error) throw new Error(traducir(error.message));
    if (!data) return null;
    return { datos: data.datos, edadSeg: (Date.now() - new Date(data.actualizado)) / 1000 };
  }

  // ------------------------------------------------------------
  //  Comandos
  // ------------------------------------------------------------
  async function enviarComando(id, payload) {
    if (!(await sesion())) throw new Error("Sesión vencida: volvé a entrar");

    // `pedido_por` NO se manda: lo pone la base con quién tiene la sesión
    // (default de la columna, ver auth-externo.sql). Mandarlo desde acá era
    // una forma de equivocarse que ya no existe.
    const { data, error } = await sb.from("comandos")
      .insert({ equipo_id: id, payload })
      .select("id").single();
    if (error) throw new Error(traducir(error.message));

    // Esperar a que el equipo lo resuelva. No se da por aplicado al
    // insertarlo: eso sería decir "guardado" cuando lo único cierto es
    // "anotado".
    const hasta = Date.now() + RESPUESTA_MS;
    while (Date.now() < hasta) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: c } = await sb.from("comandos")
        .select("estado, resultado").eq("id", data.id).maybeSingle();
      if (!c) continue;
      if (c.estado === "aplicado")  return { ok: true,  msg: c.resultado || "Aplicado" };
      if (c.estado === "rechazado") return { ok: false, msg: c.resultado || "El equipo lo rechazó" };
      if (c.estado === "vencido")   return { ok: false, msg: "Venció sin que el equipo lo tomara" };
    }

    // ── Rendirse NO es olvidarse ──
    //  Hasta acá se devolvía «no respondió» y el comando quedaba PENDIENTE:
    //  el equipo podía tomarlo cinco minutos después, cuando volviera el
    //  enlace. Y para entonces la persona ya había visto el error y
    //  probablemente lo mandó de nuevo — así que se ejecutaban los dos, uno
    //  tarde. Sobre un fotoperíodo, «tarde» puede ser en pleno período
    //  oscuro.
    //
    //  Se cancela. Si el equipo ya lo había tomado, la cancelación no hace
    //  nada —eso ya no se puede deshacer desde acá— y se dice distinto,
    //  porque son dos situaciones distintas para quien está mirando.
    let cancelado = false;
    try {
      const { data: c } = await sb.rpc("cancelar_comando", { p_id: data.id });
      cancelado = c === true;
    } catch (_) { /* si falla, el vencimiento del servidor lo cierra igual */ }

    return { ok: false, msg: cancelado
      ? "El equipo no respondió — la orden se canceló"
      : "El equipo no respondió — la orden ya estaba en curso" };
  }

  // ------------------------------------------------------------
  //  Lo que la app usa
  // ------------------------------------------------------------
  window.NUBE = {
    disponible: true,
    configurado,
    sb, sesion, entrar, salir, usuario, procesarRetorno,
    listarEquipos, vincular, leerEstado, enviarComando,
    // Cuánto espera esta capa el acuse del equipo. La app ajusta su propio
    // plazo con este número en vez de suponerlo (UX-260908-03).
    respuestaMs: RESPUESTA_MS,
    get equipoId() { return equipoId; },
    set equipoId(v) { equipoId = v; },

    // Arranca el sondeo del estado y llama a `alRecibir` con cada foto.
    seguirEstado(id, alRecibir, alFallar) {
      clearInterval(timerEstado);
      // También invalida cualquier tick que hubiera quedado en vuelo de un
      // seguirEstado() anterior (cambiar de equipo A a B rápido): sin esto,
      // una respuesta tardía de A podía pintar la pantalla de B.
      estadoTick++;
      equipoId = id;
      const tick = async () => {
        const miTick = ++estadoTick;
        try {
          const e = await leerEstado(id);
          // Si mientras esta consulta estaba en el aire ya arrancó (o
          // terminó) otra más nueva, esta respuesta es vieja: se descarta en
          // vez de pintarla encima de un dato más reciente.
          if (miTick !== estadoTick) return;
          if (e) alRecibir(e.datos, e.edadSeg);
          else alFallar("El equipo todavía no publicó su estado");
        } catch (err) {
          if (miTick !== estadoTick) return;   // idem: un error viejo tampoco pisa un dato nuevo
          alFallar(err.message);
        }
      };
      tick();
      timerEstado = setInterval(tick, ESTADO_MS);
    },
    // Bumpear el contador acá, y no sólo limpiar el timer, invalida también
    // cualquier tick que ya haya salido y todavía no volvió: si la respuesta
    // llega después de dejar de seguir, no va a llamar a alRecibir/alFallar
    // sobre una pantalla que el usuario ya cerró.
    dejarDeSeguir() { clearInterval(timerEstado); timerEstado = 0; estadoTick++; },
  };
})();
