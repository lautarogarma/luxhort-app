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

  const sb = window.supabase.createClient(CFG.url, CFG.anon, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

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

  // ------------------------------------------------------------
  //  Cuenta
  // ------------------------------------------------------------
  async function sesion() {
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  async function entrar(correo, clave) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: correo, password: clave,
    });
    if (error) throw new Error(traducir(error.message));
    return data.session;
  }

  async function registrarse(correo, clave) {
    const { data, error } = await sb.auth.signUp({
      email: correo, password: clave,
    });
    if (error) throw new Error(traducir(error.message));
    // Con confirmación por correo activada no viene sesión: hay que ir al
    // buzón. Se distingue para poder decirlo, en vez de dejar la pantalla
    // como si no hubiera pasado nada.
    return { sesion: data.session, confirmar: !data.session };
  }

  async function salir() { await sb.auth.signOut(); }

  // ── Recuperar la clave (UX-260908-12) ──
  //  No había ninguna: quien olvidaba la clave se quedaba afuera del producto
  //  y la única salida era escribirle a alguien. Supabase manda un correo con
  //  un enlace que vuelve a esta misma página ya con sesión y en modo
  //  «recuperación»; ahí se pide la clave nueva.
  //
  //  El resultado NO distingue si el correo existe: decir «esa cuenta no
  //  existe» convierte el formulario en un verificador de correos registrados.
  async function recuperar(correo) {
    const { error } = await sb.auth.resetPasswordForEmail(String(correo || "").trim(), {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw new Error(traducir(error.message));
  }

  async function cambiarClave(nueva) {
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) throw new Error(traducir(error.message));
  }

  // Quién está adentro. La app mostraba equipos sin decir nunca con qué cuenta
  // se entró: con dos cuentas —la de prueba y la del cliente— no había forma
  // de saber cuál estaba operando el equipo.
  async function usuario() {
    const s = await sesion();
    return s ? s.user : null;
  }

  // Los mensajes de Supabase vienen en inglés y son de programador. Se
  // traducen los que un usuario puede provocar; el resto pasa tal cual, que
  // es mejor que un "error desconocido" que no deja buscar nada.
  function traducir(m) {
    const t = String(m || "");
    if (/Invalid login credentials/i.test(t)) return "Correo o clave incorrectos";
    if (/Email not confirmed/i.test(t)) return "Falta confirmar el correo: mirá tu buzón";
    if (/User already registered/i.test(t)) return "Ese correo ya tiene cuenta — probá entrar";
    if (/Password should be at least/i.test(t)) return "La clave es muy corta (mínimo 6)";
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
    const s = await sesion();
    if (!s) throw new Error("Sesión vencida: volvé a entrar");

    const { data, error } = await sb.from("comandos")
      .insert({ equipo_id: id, pedido_por: s.user.id, payload })
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
    sb, sesion, entrar, registrarse, salir, recuperar, cambiarClave, usuario,
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
