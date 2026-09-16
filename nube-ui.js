// ============================================================
//  nube-ui.js — cuenta, equipos y vinculación en el despliegue alojado
// ============================================================
//  Se carga DESPUÉS de la app. Su trabajo es poner adelante las tres
//  pantallas que sólo existen cuando se entra desde internet —ingresar,
//  elegir equipo, vincular uno nuevo— y después desaparecer: a partir de ahí
//  la app es la misma de siempre, con el estado llegando por otro lado.
//
//  ── Por qué reemplaza `send` en vez de tener botones propios ──
//  La app entera ya sabe pedir cosas: `send({cmd:...})`. Cambiando SÓLO a
//  dónde va ese objeto, los ciento y pico de controles que ya existen
//  funcionan desde internet sin tocarlos. Una segunda interfaz «remota»
//  obligaría a mantener dos, y a que el operador decida a cuál creerle.
// ============================================================

(function () {
  "use strict";
  if (!window.NUBE || !window.NUBE.disponible) return;

  const $ = (id) => document.getElementById(id);
  const N = window.NUBE;

  // ------------------------------------------------------------
  //  La capa de acceso
  // ------------------------------------------------------------
  const capa = document.createElement("div");
  capa.id = "nube-capa";
  // Es un diálogo modal: tapa la app entera y no hay nada operable detrás.
  // Sin decirlo, un lector de pantalla sigue leyendo la app de abajo y la
  // persona no entiende por qué nada responde (UX-260908-12).
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-labelledby", "n-titulo");
  capa.innerHTML = `
    <div class="ncard">
      <h1 class="ntitulo" id="n-titulo">LUXHorticultura</h1>
      <p class="nsub" id="n-sub">Entrá para controlar tus equipos desde cualquier lado</p>
      <div id="n-cuenta" style="display:none"></div>

      <div id="n-paso-login">
        <button class="btn nbtn-google" id="n-google" type="button">
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
          Continuar con Google
        </button>
        <div class="nsep"><span>o con tu correo</span></div>
        <label class="fl" for="n-correo">Correo</label>
        <input type="email" id="n-correo" autocomplete="email" placeholder="vos@ejemplo.com">
        <label class="fl" for="n-clave" style="margin-top:8px">Clave</label>
        <input type="password" id="n-clave" autocomplete="current-password" placeholder="Mínimo 6 caracteres">
        <div class="row" style="margin-top:12px">
          <button class="btn acc" id="n-entrar" type="button">Entrar</button>
        </div>
        <div class="row">
          <button class="btn" id="n-crear" type="button">Crear una cuenta</button>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="nlink" id="n-olvide" type="button">¿Olvidaste tu clave?</button>
        </div>
      </div>

      <!-- Recuperación de clave. Faltaba por completo: quien olvidaba la clave
           no tenía ninguna salida dentro del producto (UX-260908-12). -->
      <div id="n-paso-recuperar" style="display:none">
        <p class="nsub">Te mandamos un enlace por correo para poner una clave nueva.</p>
        <label class="fl" for="n-rec-correo">Correo</label>
        <input type="email" id="n-rec-correo" autocomplete="email" placeholder="vos@ejemplo.com">
        <div class="row" style="margin-top:12px">
          <button class="btn acc" id="n-rec-enviar" type="button">Enviar el enlace</button>
        </div>
        <div class="row">
          <button class="btn" id="n-rec-volver" type="button">← Volver</button>
        </div>
      </div>

      <!-- Vuelta del enlace del correo: Supabase deja una sesión de
           recuperación y acá se elige la clave nueva. -->
      <div id="n-paso-nueva" style="display:none">
        <p class="nsub">Elegí tu clave nueva.</p>
        <label class="fl" for="n-nueva">Clave nueva</label>
        <input type="password" id="n-nueva" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
        <label class="fl" for="n-nueva2" style="margin-top:8px">Repetila</label>
        <input type="password" id="n-nueva2" autocomplete="new-password">
        <div class="row" style="margin-top:12px">
          <button class="btn acc" id="n-nueva-ok" type="button">Guardar la clave</button>
        </div>
      </div>

      <div id="n-paso-vincular" style="display:none">
        <p class="nsub">Escribí el código de <b>8 caracteres</b> que muestra la pantalla
          del equipo, en la pestaña <b>Conexión</b>.</p>
        <input type="text" id="n-codigo" maxlength="8" autocomplete="off"
               placeholder="ABCD1234" style="text-transform:uppercase;letter-spacing:.2em;text-align:center;font-size:22px">
        <div class="row" style="margin-top:12px">
          <button class="btn acc" id="n-vincular" type="button">Vincular equipo</button>
        </div>
        <p class="nsub" style="margin-top:10px">El equipo tiene que estar encendido y con
          internet: sólo se puede vincular uno que esté en línea.</p>
      </div>

      <div id="n-paso-equipos" style="display:none">
        <p class="nsub">Elegí el equipo</p>
        <div id="n-lista"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="n-otro" type="button">＋ Vincular otro equipo</button>
        </div>
      </div>

      <div id="n-msg" role="status" aria-live="polite"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" id="n-salir" type="button" style="display:none">Cerrar sesión</button>
      </div>
    </div>`;

  const css = document.createElement("style");
  css.textContent = `
    #nube-capa{position:fixed;inset:0;z-index:9999;background:var(--bg);
      display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto}
    #nube-capa .ncard{background:var(--card);border:1px solid var(--line);border-radius:14px;
      padding:22px;width:100%;max-width:420px}
    #nube-capa .ntitulo{font-size:22px;margin-bottom:4px}
    #nube-capa .nsub{color:var(--dim);font-size:13.5px;line-height:1.5;margin-bottom:14px}
    #nube-capa input{margin-bottom:2px}
    /* Chrome pinta los campos autocompletados de BLANCO con texto oscuro, y
       sobre un tema oscuro eso se ve como un error de la pagina. No hay
       propiedad para cambiar el fondo: el truco conocido es una sombra
       interior enorme del color que uno quiere, mas el color del texto
       forzado por -webkit-text-fill-color. La transicion larga evita el
       parpadeo blanco del primer cuadro. */
    #nube-capa input:-webkit-autofill,
    #nube-capa input:-webkit-autofill:hover,
    #nube-capa input:-webkit-autofill:focus{
      -webkit-box-shadow:0 0 0 1000px #0d1117 inset !important;
      -webkit-text-fill-color:var(--tx) !important;
      caret-color:var(--tx);
      transition:background-color 9999s ease-in-out 0s}
    #nube-capa .nsep{display:flex;align-items:center;gap:10px;color:var(--dim);
      font-size:12px;margin:14px 0}
    #nube-capa .nsep::before,#nube-capa .nsep::after{content:"";flex:1;height:1px;background:var(--line)}
    /* El botón de Google va en blanco a propósito: es el que la gente
       reconoce de memoria, y disfrazarlo del resto de la interfaz lo vuelve
       un botón más entre muchos. */
    .nbtn-google{background:#fff !important;color:#1f1f1f !important;border-color:#dadce0 !important;
      display:flex;align-items:center;justify-content:center;gap:10px;font-weight:600}
    #n-msg{font-size:13.5px;line-height:1.5;margin-top:12px;padding:0}
    #n-msg.err{color:#ff9d95}
    #n-msg.ok{color:var(--acc)}
    .nequipo{display:flex;justify-content:space-between;align-items:center;gap:10px;
      width:100%;min-height:56px;background:#21262d;border:1px solid #30363d;color:var(--tx);
      border-radius:9px;padding:10px 14px;margin-top:8px;cursor:pointer;text-align:left}
    .nequipo small{display:block;color:var(--dim);font-size:11.5px;font-weight:400}
    .npunto{width:9px;height:9px;border-radius:50%;flex:0 0 9px}
    /* Enlace de texto, no botón: es una salida secundaria y no compite con
       Entrar. Sigue midiendo 44 px de alto para poder tocarlo. */
    .nlink{background:none;border:0;color:#58a6ff;font-size:13.5px;cursor:pointer;
      padding:12px 4px;min-height:44px;text-decoration:underline;flex:1}
    .nlink:focus-visible{outline:3px solid var(--focus,#58a6ff);outline-offset:2px;border-radius:6px}
    /* Con qué cuenta se entró. Se mostraba la lista de equipos sin decirlo
       nunca; con dos cuentas no había forma de saber cuál estaba operando. */
    #n-cuenta{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dim);
      background:#0d1117;border:1px solid var(--line);border-radius:8px;
      padding:8px 10px;margin-bottom:12px;word-break:break-all}
    /* La misma identidad, ya dentro de la app. */
    #nube-barra{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
      font-size:12.5px;color:var(--dim);margin-bottom:12px}
    #nube-barra .btn{flex:0 0 auto;min-width:auto;min-height:36px;padding:7px 12px;font-size:13px}`;
  document.head.appendChild(css);
  document.body.appendChild(capa);

  const msg = (t, clase) => { const m = $("n-msg"); m.textContent = t || ""; m.className = clase || ""; };

  const PASOS = ["login", "recuperar", "nueva", "vincular", "equipos"];
  // Título de cada paso, para que el diálogo se anuncie por lo que hace y no
  // siempre por el nombre del producto.
  const TITULOS = {
    login: "LUXHorticultura", recuperar: "Recuperar la clave",
    nueva: "Clave nueva", vincular: "Vincular un equipo", equipos: "Tus equipos",
  };
  let pasoActual = "login";

  const paso = (cual) => {
    pasoActual = cual;
    PASOS.forEach((p) => { $("n-paso-" + p).style.display = p === cual ? "" : "none"; });
    const conSesion = cual === "vincular" || cual === "equipos";
    $("n-salir").style.display = conSesion ? "" : "none";
    $("n-sub").style.display = cual === "login" ? "" : "none";
    $("n-titulo").textContent = TITULOS[cual] || "LUXHorticultura";
    pintarCuenta(conSesion);
    enfocarPrimero();
  };

  // ── Foco (UX-260908-12) ──
  //  La capa aparecía sin mover el foco: con teclado o lector de pantalla, el
  //  foco seguía en la app tapada de abajo y la pantalla parecía congelada.
  //  Al entrar a un paso, el foco va al primer campo —o al primer botón si el
  //  paso no tiene campos.
  function enfocarPrimero() {
    const vivo = $("n-paso-" + pasoActual);
    if (!vivo) return;
    const el = vivo.querySelector("input:not([disabled])")
            || vivo.querySelector("button:not([disabled])");
    if (!el) return;
    // `paso()` ya puso el display antes de llamar acá, así que el elemento es
    // enfocable ahora mismo. El reintento diferido cubre el caso de un paso
    // que se muestra dentro de una promesa todavía sin resolver: sin él, la
    // primera llamada se pierde en silencio y el foco se queda en el paso
    // anterior. Sólo se reintenta si el foco NO se movió.
    try { el.focus(); } catch (_) { }
    if (document.activeElement !== el) {
      setTimeout(() => { try { el.focus(); } catch (_) { } }, 0);
    }
  }

  // Y no se sale de la capa con el tabulador: detrás no hay nada operable, y
  // tabular hacia una app tapada es la forma clásica de perderse.
  capa.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const foco = [...capa.querySelectorAll("input,button,a[href],[tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!foco.length) return;
    const primero = foco[0], ultimo = foco[foco.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });

  // Con quién se entró, escrito. `correoActual` lo llena `despuesDeEntrar`.
  let correoActual = "";
  function pintarCuenta(mostrar) {
    const c = $("n-cuenta");
    if (!c) return;
    if (!mostrar || !correoActual) { c.style.display = "none"; c.textContent = ""; return; }
    c.style.display = "";
    c.textContent = "";
    const t = document.createElement("span");
    t.textContent = "Sesión de ";
    const e = document.createElement("b");
    e.style.color = "var(--tx)";
    e.textContent = correoActual;     // textContent: viene de la cuenta, no se interpola
    c.appendChild(t); c.appendChild(e);
  }

  // ------------------------------------------------------------
  //  Entrar
  // ------------------------------------------------------------
  $("n-google").onclick = async () => {
    msg("");
    try {
      const { error } = await N.sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    } catch (e) {
      // El caso frecuente no es un error de red: es que el proveedor no está
      // habilitado todavía en el proyecto. Decirlo evita mandar a revisar la
      // clave, que está bien.
      msg(/provider is not enabled/i.test(e.message)
        ? "El ingreso con Google todavía no está habilitado en el proyecto."
        : e.message, "err");
    }
  };

  $("n-entrar").onclick = async () => {
    const b = $("n-entrar"); msg("");
    b.disabled = true; b.textContent = "Entrando…";
    try {
      await N.entrar($("n-correo").value.trim(), $("n-clave").value);
      await despuesDeEntrar();
    } catch (e) { msg(e.message, "err"); }
    b.disabled = false; b.textContent = "Entrar";
  };

  $("n-crear").onclick = async () => {
    const b = $("n-crear"); msg("");
    const correo = $("n-correo").value.trim(), clave = $("n-clave").value;
    if (!correo || clave.length < 6) {
      msg("Poné tu correo y una clave de al menos 6 caracteres", "err"); return;
    }
    b.disabled = true; b.textContent = "Creando…";
    try {
      const r = await N.registrarse(correo, clave);
      if (r.confirmar) msg("Cuenta creada. Confirmá el correo que te mandamos y volvé a entrar.", "ok");
      else await despuesDeEntrar();
    } catch (e) { msg(e.message, "err"); }
    b.disabled = false; b.textContent = "Crear una cuenta";
  };

  $("n-salir").onclick = async () => {
    N.dejarDeSeguir(); await N.salir(); location.reload();
  };

  // ------------------------------------------------------------
  //  Recuperar la clave
  // ------------------------------------------------------------
  $("n-olvide").onclick = () => {
    $("n-rec-correo").value = $("n-correo").value.trim();
    paso("recuperar"); msg("");
  };
  $("n-rec-volver").onclick = () => { paso("login"); msg(""); };

  $("n-rec-enviar").onclick = async () => {
    const b = $("n-rec-enviar"), correo = $("n-rec-correo").value.trim();
    if (!correo) { msg("Escribí tu correo", "err"); return; }
    b.disabled = true; b.textContent = "Enviando…";
    try {
      await N.recuperar(correo);
      // El mismo mensaje exista o no la cuenta: si dijera «ese correo no está
      // registrado», el formulario sería un verificador de qué correos tienen
      // cuenta acá, para cualquiera que quiera preguntarle.
      msg("Si ese correo tiene cuenta, va a llegarle un enlace para poner una "
        + "clave nueva. Revisá también el correo no deseado.", "ok");
    } catch (e) { msg(e.message, "err"); }
    b.disabled = false; b.textContent = "Enviar el enlace";
  };

  $("n-nueva-ok").onclick = async () => {
    const b = $("n-nueva-ok"), c1 = $("n-nueva").value, c2 = $("n-nueva2").value;
    if (c1.length < 6) { msg("La clave nueva necesita al menos 6 caracteres", "err"); return; }
    if (c1 !== c2) { msg("Las dos claves no coinciden", "err"); return; }
    b.disabled = true; b.textContent = "Guardando…";
    try {
      await N.cambiarClave(c1);
      msg("Clave cambiada", "ok");
      $("n-nueva").value = $("n-nueva2").value = "";
      await despuesDeEntrar();
    } catch (e) { msg(e.message, "err"); }
    b.disabled = false; b.textContent = "Guardar la clave";
  };

  // ------------------------------------------------------------
  //  Equipos
  // ------------------------------------------------------------
  async function despuesDeEntrar() {
    msg("");
    try { const u = await N.usuario(); correoActual = (u && u.email) || ""; }
    catch (_) { correoActual = ""; }

    let equipos = [];
    try { equipos = await N.listarEquipos(); }
    catch (e) { msg(e.message, "err"); return; }

    if (!equipos.length) { paso("vincular"); return; }
    paso("equipos");

    const host = $("n-lista"); host.innerHTML = "";
    equipos.forEach((eq) => {
      const edad = eq.estado && eq.estado.actualizado
        ? (Date.now() - new Date(eq.estado.actualizado)) / 1000 : null;
      // En línea = publicó hace menos de un minuto. El equipo publica cada
      // 15 s, así que un minuto tolera un par de intentos perdidos sin
      // declararlo caído por un bache de red.
      const vivo = edad !== null && edad < 60;
      // ── El nombre del equipo NO se interpola en HTML ──
      //  Lo elige un miembro del equipo y viaja por la base: un nombre como
      //  `<img src=x onerror=...>` se ejecutaria en el origen de la app
      //  alojada, donde vive la sesion de Supabase. Se arma con nodos y
      //  textContent, que no interpreta nada.
      const b = document.createElement("button");
      b.className = "nequipo";
      const envoltorio = document.createElement("span");
      const titulo = document.createElement("span");
      titulo.textContent = eq.nombre;
      const detalle = document.createElement("small");
      detalle.textContent = vivo ? "en línea"
        : edad === null ? "nunca se conectó"
        : "sin señal hace " + fmtEdad(edad);
      envoltorio.appendChild(titulo);
      envoltorio.appendChild(detalle);
      b.appendChild(envoltorio);
      const p = document.createElement("span");
      p.className = "npunto";
      p.style.background = vivo ? "var(--acc)" : "#6e7681";
      b.appendChild(p);
      b.onclick = () => abrirEquipo(eq.id, eq.nombre);
      host.appendChild(b);
    });
    // El foco recién ahora: `paso("equipos")` corrió con la lista vacía, así
    // que habría enfocado el botón de vincular otro en vez del primer equipo.
    enfocarPrimero();
  }

  const fmtEdad = (s) => s < 3600 ? Math.round(s / 60) + " min"
    : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " días";

  $("n-otro").onclick = () => { paso("vincular"); msg(""); };

  $("n-vincular").onclick = async () => {
    const b = $("n-vincular"); msg("");
    b.disabled = true; b.textContent = "Vinculando…";
    try {
      await N.vincular($("n-codigo").value);
      msg("Equipo vinculado", "ok");
      await despuesDeEntrar();
    } catch (e) { msg(e.message, "err"); }
    b.disabled = false; b.textContent = "Vincular equipo";
  };

  // ------------------------------------------------------------
  //  Abrir el equipo: de acá en adelante manda la app de siempre
  // ------------------------------------------------------------
  function abrirEquipo(id, nombre) {
    capa.style.display = "none";
    document.title = nombre + " · LUXHorticultura";

    // ── El plazo del acuse lo fija el transporte (UX-260908-03) ──
    //  La app da una orden por perdida a los 8 s, que es lo correcto en la red
    //  local. Por internet el equipo BUSCA sus órdenes cada 5 s y esta capa
    //  espera hasta 25 s: con 8 s, una orden perfectamente válida se mostraba
    //  como «El equipo no respondió» mientras seguía en curso. El margen de
    //  5 s cubre el viaje de la respuesta de vuelta.
    if (window.opTimeout) window.opTimeout((N.respuestaMs || 25000) + 5000);

    // El transporte. Todo lo demás de la app ya sabe llamar a `send`.
    window.send = function (o) {
      if (!o || !o.cmd) return false;
      // Las lecturas no viajan: el estado ya llega solo por el sondeo.
      if (o.cmd === "get_state" || o.cmd === "get_programs") return true;
      const op = o.op || 0;
      N.enviarComando(id, o)
        .then((r) => { if (op && window.opCerrar) opCerrar(op, r.ok ? "ok" : "error", r.msg); })
        .catch((e) => { if (op && window.opCerrar) opCerrar(op, "error", e.message); });
      return true;
    };

    N.seguirEstado(id, (datos, edadSeg) => {
      window.applyState(datos);
      const s = $("status");
      if (s) s.textContent = edadSeg < 60
        ? "conectado por internet · " + nombre
        : "⚠ sin señal del equipo hace " + fmtEdad(edadSeg);
    }, (err) => {
      const s = $("status"); if (s) s.textContent = "⚠ " + err;
    });

    // ── La barra de identidad ──
    //  Qué equipo se está operando y con qué cuenta, siempre a la vista. Antes
    //  sólo había un botón «← Mis equipos» y, una vez adentro, nada decía a
    //  nombre de quién viajaban las órdenes (UX-260908-12).
    //
    //  Se crea UNA vez: `abrirEquipo` corre cada vez que se elige un equipo, y
    //  la versión anterior insertaba otro botón en cada vuelta — a la tercera
    //  había tres.
    let barra = $("nube-barra");
    if (!barra) {
      barra = document.createElement("div");
      barra.id = "nube-barra";
      const sub = $("status");
      if (sub && sub.parentNode) sub.parentNode.insertBefore(barra, sub.nextSibling);
      else document.body.insertBefore(barra, document.body.firstChild);
    }
    barra.textContent = "";

    const volver = document.createElement("button");
    volver.className = "btn";
    volver.textContent = "← Mis equipos";
    volver.onclick = () => {
      N.dejarDeSeguir();
      // Vuelve al plazo local: si desde acá se opera otro equipo por WebSocket
      // —no pasa hoy, pero el estado global no debería quedar mal puesto—.
      capa.style.display = "flex";
      despuesDeEntrar();
    };
    barra.appendChild(volver);

    const quien = document.createElement("span");
    quien.textContent = correoActual ? "· " + correoActual : "";
    barra.appendChild(quien);

    const salir = document.createElement("button");
    salir.className = "btn";
    salir.textContent = "Cerrar sesión";
    salir.onclick = async () => { N.dejarDeSeguir(); await N.salir(); location.reload(); };
    barra.appendChild(salir);
  }

  // ------------------------------------------------------------
  //  Arranque
  // ------------------------------------------------------------
  // La vuelta del enlace de recuperación llega con sesión pero NO hay que
  // entrar: hay que pedir la clave nueva. Supabase lo avisa con este evento, y
  // el `type=recovery` del hash es el respaldo por si el evento llega antes de
  // que este archivo se haya cargado.
  let recuperando = /(^|[#&?])type=recovery(&|$)/.test(location.hash + location.search);
  N.sb.auth.onAuthStateChange((evento) => {
    if (evento !== "PASSWORD_RECOVERY") return;
    recuperando = true;
    history.replaceState(null, "", location.pathname);
    capa.style.display = "flex";
    paso("nueva");
    msg("Elegí una clave nueva para tu cuenta.", "ok");
  });

  (async () => {
    paso("login");
    // Vuelta del ingreso con Google: Supabase deja la sesión en la URL.
    try {
      const s = await N.sesion();
      if (recuperando) {
        history.replaceState(null, "", location.pathname);
        paso("nueva");
        msg("Elegí una clave nueva para tu cuenta.", "ok");
        return;
      }
      if (s) {
        history.replaceState(null, "", location.pathname);
        await despuesDeEntrar();
      }
    } catch (e) { msg(e.message, "err"); }
  })();
})();
