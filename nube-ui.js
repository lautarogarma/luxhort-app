// ============================================================
//  nube-ui.js — cuenta, equipos y vinculación en el despliegue alojado
// ============================================================
//  Se carga DESPUÉS de la app. Su trabajo es poner adelante las pantallas
//  que sólo existen cuando se entra desde internet —ingresar, elegir equipo,
//  vincular uno nuevo— y después desaparecer: a partir de ahí la app es la
//  misma de siempre, con el estado llegando por otro lado.
//
//  ── El ingreso no se dibuja acá ──
//  Tocar «Ingresar» manda a la página alojada de Auth0: ahí viven Google, el
//  correo y la clave, «¿olvidaste tu clave?» y la confirmación del correo,
//  hechos y en español. Acá queda un botón y el mensaje de vuelta si el
//  ingreso fue rechazado. Antes había cuatro formularios propios (entrar,
//  crear cuenta, recuperar, clave nueva) y cada uno era una forma de quedar
//  a medias (2026-09-16: el correo de confirmación llevaba a localhost).
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
      <p class="nsub" id="n-sub">Controlá tus equipos desde cualquier lado</p>
      <div id="n-cuenta" style="display:none"></div>

      <div id="n-paso-login">
        <div class="row">
          <button class="btn acc nbtn-entrar" id="n-entrar" type="button">Ingresar</button>
        </div>
        <p class="nsub" style="margin-top:12px">Se abre la página segura de ingreso.
          Podés entrar con tu cuenta de Google o crear una con tu correo.</p>
      </div>

      <div id="n-paso-vincular" style="display:none">
        <p class="nsub">Escribí el código de <b>8 caracteres</b> que muestra la pantalla
          del equipo, en la pestaña <b>Conexión</b>.</p>
        <input type="text" id="n-codigo" maxlength="8" autocomplete="off"
               placeholder="ABCD1234" style="text-transform:uppercase;letter-spacing:.2em;text-align:center;font-size:22px">
        <div class="row" style="margin-top:12px">
          <button class="btn acc" id="n-vincular" type="button">Vincular equipo</button>
        </div>
        <p class="nsub" style="margin-top:10px">El equipo tiene que estar encendido, con
          internet y <b>dado de alta en la nube</b>: en su app local (la de la red de casa),
          pestaña Conexión, la tarjeta <b>Control por internet</b> tiene que decir
          «Conectado». Si dice «Sin configurar», primero hay que cargarle su clave ahí.</p>
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
    /* Un solo botón, grande: es lo único que hay que hacer en esta pantalla. */
    .nbtn-entrar{min-height:52px;font-size:17px;font-weight:700}
    #n-msg{font-size:13.5px;line-height:1.5;margin-top:12px;padding:0}
    #n-msg.err{color:#ff9d95}
    #n-msg.ok{color:var(--acc)}
    .nequipo{display:flex;justify-content:space-between;align-items:center;gap:10px;
      width:100%;min-height:56px;background:#21262d;border:1px solid #30363d;color:var(--tx);
      border-radius:9px;padding:10px 14px;margin-top:8px;cursor:pointer;text-align:left}
    .nequipo small{display:block;color:var(--dim);font-size:11.5px;font-weight:400}
    .npunto{width:9px;height:9px;border-radius:50%;flex:0 0 9px}
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

  const PASOS = ["login", "vincular", "equipos"];
  // Título de cada paso, para que el diálogo se anuncie por lo que hace y no
  // siempre por el nombre del producto.
  const TITULOS = {
    login: "LUXHorticultura", vincular: "Vincular un equipo", equipos: "Tus equipos",
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
  //  Entrar y salir
  // ------------------------------------------------------------
  $("n-entrar").onclick = async () => {
    const b = $("n-entrar"); msg("");
    b.disabled = true; b.textContent = "Abriendo el ingreso…";
    try { await N.entrar(); }   // no vuelve: la página cambia
    catch (e) { msg(e.message, "err"); b.disabled = false; b.textContent = "Ingresar"; }
  };

  // Cerrar sesión también cierra la de Auth0 y vuelve a esta página limpia.
  const cerrarSesion = async () => { N.dejarDeSeguir(); await N.salir(); };
  $("n-salir").onclick = cerrarSesion;

  // ------------------------------------------------------------
  //  Equipos
  // ------------------------------------------------------------
  async function despuesDeEntrar() {
    msg("");
    try {
      const u = await N.usuario();
      correoActual = (u && (u.email || u.name)) || "";
    } catch (_) { correoActual = ""; }

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
      //  alojada, donde vive la sesion. Se arma con nodos y textContent, que
      //  no interpreta nada.
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
    } catch (e) {
      // El mensaje de la base no puede distinguir "código mal" de "este equipo
      // nunca publicó nada": la causa más común la primera vez es la segunda
      // (2026-09-16), y hay que decirla.
      msg(e.message + (/incorrecto/i.test(e.message)
        ? " Si es la primera vez que vinculás este equipo, fijate que en su app local " +
          "(Conexión → Control por internet) diga «Conectado»: si no tiene cargada su clave, " +
          "no publica en la nube y ningún código va a servir."
        : ""), "err");
    }
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
    salir.onclick = cerrarSesion;
    barra.appendChild(salir);
  }

  // ------------------------------------------------------------
  //  Arranque
  // ------------------------------------------------------------
  (async () => {
    paso("login");
    if (!N.configurado) {
      msg("El ingreso todavía no está configurado (faltan los datos de Auth0 en config.js).", "err");
      return;
    }
    try {
      // Si venimos de la página de Auth0, esto consume el código de la URL y
      // deja la sesión lista — o devuelve el motivo del rechazo.
      const rechazo = await N.procesarRetorno();
      if (rechazo) { msg(rechazo, "err"); return; }
      if (await N.sesion()) await despuesDeEntrar();
    } catch (e) { msg(e.message, "err"); }
  })();
})();
