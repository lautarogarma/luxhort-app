"use strict";
const NCH=5, COLORS=["--c0","--c1","--c2","--c3","--c4"];
// ── Vocabulario de canales (UX-260908-07) ──
//  Una sola forma canónica, la misma que `CHANNEL_DEFS` en include/config.h.
//  Antes el mismo canal se llamaba «UV» en la fila, «UV 365+395nm» abajo y
//  «UVA» en la advertencia, y no había cómo saber si eran la misma cosa.
//  `CH_NOMBRE` es lo que se dice en cualquier texto —gráfico, aviso,
//  confirmación, etiqueta accesible—; `CH_CORTO` sólo existe porque la columna
//  de la fila mide 64 px y el nombre entero no entra ahí.
const CH_NOMBRE=["Blanco cálido 3000 K","Blanco frío 5000 K","Rojo (660 nm)",
                 "Rojo lejano (730 nm)","UVA (365 + 395 nm)"];
const CH_CORTO=[["Blanco","cálido 3000 K"],["Blanco","frío 5000 K"],
                ["Rojo","660 nm"],["Rojo lejano","730 nm"],["UVA","365+395 nm"]];
const CH_TAG=["W3000","W5000","R660","FR730","UVA"];
const $=id=>document.getElementById(id);
let ws=null, demo=false, state=null, sendTimer={};
// Una sola puesta en hora automática por conexión: sin esto, el equipo tarda
// un instante en reflejar la hora nueva y el heartbeat volvería a disparar la
// sincronización en cada estado que llegue mientras tanto.
let autoTimeSynced=false;
// "45 s" / "12 min" / "3 h 20 min" / "2 h"
// Redondear a minutos ANTES de decidir el formato. Haciéndolo al revés, 3570 s
// caía en la rama "<1 h" y salía "60 min", y con otro reparto daba
// "1 h 60 min" (UX-028). Así 3570 s dice "1 h", que es lo correcto.
const fmtDur=s=>{
  if(s<60)return s+" s";
  let m=Math.round(s/60);
  if(m<60)return m+" min";
  const h=Math.floor(m/60); m-=h*60;
  return m?h+" h "+m+" min":h+" h";
};
// Se manda UTC real y el firmware aplica la zona configurada DEL EQUIPO.
// Abrir la app desde un telefono en otra zona nunca desplaza el fotoperiodo.
const sendTime=()=>send({cmd:"set_time",epoch:Math.floor(Date.now()/1000),utc:true});

// ---------- almacenamiento del navegador ----------
// localStorage no siempre deja leer ni escribir. Con "bloquear todos los datos
// de sitios", bajo ciertas politicas de empresa y en algunos WebView, el solo
// hecho de TOCAR la propiedad lanza una excepcion. La lectura del token estaba
// en el nivel superior del script y sin proteger, asi que esa excepcion cortaba
// el archivo entero: no se definia nada de lo que venia despues, no se conectaba
// el WebSocket y la app quedaba en blanco, sin un mensaje que el usuario pudiera
// accionar. Escribir tampoco es seguro: la cuota se puede llenar.
const almacen={
  leer(k){    try{ return localStorage.getItem(k); }catch(e){ return null; } },
  guardar(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } },
  borrar(k){  try{ localStorage.removeItem(k); }catch(e){} }
};

// ---------- emparejamiento (modelo Bambu Lab) ----------
// El equipo muestra un código de 8 caracteres en SU PANTALLA. La app lo manda
// una vez y recibe un token de sesión que guarda y reenvía en cada comando.
// Para poder controlar el equipo hay que haber estado físicamente frente a él
// alguna vez, aunque se esté en la misma WiFi.
let authToken=almacen.leer("gl_token")||"";
// El QR de la pantalla trae el codigo de acceso en la URL (?c=XXXXXXXX): con
// eso la app se empareja sola al conectar, sin tipear. Se saca de la barra
// enseguida para que no quede en el historial ni en un enlace compartido.
let codigoDeQr="";
try{
  const q=new URLSearchParams(location.search);
  if(q.get("c")){ codigoDeQr=q.get("c").trim().toUpperCase(); history.replaceState(null,"",location.pathname); }
}catch(_){}
// La orden que provocó el pedido de emparejamiento, para reenviarla una vez
// que el equipo acepta el código. Sin esto, la primera acción del usuario se
// perdía: emparejaba y tenía que volver a hacer lo que ya había hecho (UX-002).
// Sólo se guarda UNA y sólo hasta que se resuelve el emparejamiento — no es
// una cola de comandos pendientes.
let pendingCmd=null, lastWrite=null;
function pedirCodigo(motivo){
  const c=prompt((motivo?motivo+"\n\n":"")
    +"Escribí el código de acceso que muestra la pantalla del equipo\n"
    +"(pestaña Conex.), 8 caracteres:");
  if(c) send({cmd:"auth",code:c.trim().toUpperCase()});
}

const DEMO_STATE={evt:"state",fw:"demo",id:"DEMO",hw:false,dim:100,
 channels:[{id:0,name:"Blanco cálido 3000 K",tag:"W3000",pct:60,on:true},
  {id:1,name:"Blanco frío 5000 K",tag:"W5000",pct:100,on:true},
  {id:2,name:"Rojo (660 nm)",tag:"R660",pct:45,on:true},
  {id:3,name:"Rojo lejano (730 nm)",tag:"FR730",pct:0,on:false},
  {id:4,name:"UVA (365 + 395 nm)",tag:"UVA",pct:0,on:false}],
 role:0,
 schedule:{enabled:false,on:360,off:1080,ramp:30,sunsim:false,specmode:0,cyclemode:0,
  light:720,dark:720,anchor:0,progid:"",day:[60,100,45,0,0],
  stages:[[35,25,25,0,0],[50,75,35,0,0],[60,100,45,0,0],[50,75,35,0,0],[35,25,25,0,0]]},
 time:"--:--:--",wifi:"demo",tq:"demo",tqi:4,cal:true,tz:-180,
 onramp:false,onrampmin:10};

// ---------- UI ----------
// Recuerda el ultimo % > 0 de cada canal, para restaurarlo al re-encender
// con el boton (en vez de quedar en el valor que tenia justo antes de
// apagarse, que puede ser 0).
const chLastPct=Array(NCH).fill(50);
function buildChannels(){
  const host=$("channels"); host.innerHTML="";
  for(let i=0;i<NCH;i++){
    const d=document.createElement("div"); d.className="ch";
    // Nombre humano primero, especificacion tecnica despues (UX-260908-07).
    // Estaba al reves: el renglon grande decia "UV" —una abreviatura— y el
    // chico "UV 365+395nm". La columna mide 64 px, asi que el nombre canonico
    // completo no entra: va partido, y entero en el aria-label, en el grafico
    // y en las confirmaciones.
    d.innerHTML=`<div class="nm" title="${CH_NOMBRE[i]}">${CH_CORTO[i][0]}<small>${CH_CORTO[i][1]}</small><small class="ch-nota" id="nota${i}" style="display:none;color:#e3b341"></small></div>
      <div class="sl-cell"><input type="range" id="sl${i}" min="0" max="100" step="1" value="0">
      <div class="bar" id="bar${i}" style="--cc:var(${COLORS[i]});--p:0%"></div></div>
      <div class="pct pc" id="pc${i}">0%</div>
      <button class="sw" id="sw${i}" role="switch" aria-checked="false"
              aria-label="Encender ${CH_NOMBRE[i]}"></button>`;
    d.querySelector("input[type=range]").setAttribute("aria-label",CH_NOMBRE[i]);
    host.appendChild(d);
    $("sl"+i).addEventListener("input",()=>{
      // Banda muerta 0..10 %: el slider no puede quedar ahí. Al arrastrar
      // salta al borde más cercano (0 o 10), y el equipo lo rechazaría igual
      // (normalizeSchedule lo deja en 0). Ver CH_MIN_ON_PCT en config.h.
      const v=bandaMuerta(+$("sl"+i).value);
      $("sl"+i).value=v;
      // Modo Personalizado: el slider edita la ETAPA seleccionada, no la receta
      // fija del equipo. No se manda nada todavía —las cinco etapas viajan
      // juntas al tocar Guardar—, así que se marca el borrador como sucio para
      // que el botón lo pida. Ver CL-046.
      if(editandoEtapa()){
        dynStages[dynSel][i]=v;
        paintCh(i,v,v>0.5);
        drawSpd();
        markSchDirty();
        return;
      }
      if(v>0) chLastPct[i]=v;
      // mover el slider enciende el canal solo (y a 0 lo apaga). "on" se manda
      // SIEMPRE (no solo cuando cambia respecto al switch ya pintado en el
      // DOM): en un arrastre continuo se disparan varios eventos "input" en
      // menos de 120ms, y paintCh ya deja el switch pintado como "on" antes
      // de que el envio debounced del evento anterior llegue a salir —
      // comparar contra ese DOM ya actualizado hacia que "on" se perdiera
      // (el relé real quedaba apagado aunque el DAC ya tuviera el nivel nuevo).
      const on=v>0;
      paintCh(i,v,on);
      sendChannel(i,{pct:v,on});
    });
    $("sw"+i).addEventListener("click",()=>{
      const turningOn=!$("sw"+i).classList.contains("on");
      // Editando una etapa, el interruptor pone ese canal en 0 o lo devuelve a
      // su último valor DENTRO de la etapa: apagar un canal en el atardecer no
      // debería apagarlo en el resto del día.
      if(editandoEtapa()){
        const nuevo=turningOn?(chLastPct[i]||50):0;
        dynStages[dynSel][i]=nuevo;
        $("sl"+i).value=nuevo;
        paintCh(i,nuevo,turningOn);
        drawSpd();
        markSchDirty();
        return;
      }
      const pct=turningOn?(chLastPct[i]||50):0;
      if(!turningOn){const cur=+$("sl"+i).value; if(cur>0)chLastPct[i]=cur;}
      paintCh(i,pct,turningOn);
      sendChannel(i,{pct,on:turningOn});
    });
  }
  // Aviso de modo automatico. Va DENTRO de la tarjeta, arriba de las filas: el
  // usuario tiene que entender por que desaparecieron los controles antes de
  // buscarlos.
  const auto=document.createElement("div");
  auto.id="ch-auto";
  auto.style.cssText="display:none;margin-bottom:10px;padding:9px 12px;border-radius:8px;"+
    "background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.3);font-size:13px;line-height:1.45";
  host.insertBefore(auto,host.firstChild);
}
// Un interruptor dibujado con un <button> y una clase no le dice nada a un
// lector de pantalla: hay que declarar que es un interruptor y en que estado
// esta. Todo el pintado pasa por aca para que la clase y aria-checked no se
// puedan separar.
function pintarSw(el,on){
  if(!el)return;
  el.classList.toggle("on",on);
  el.setAttribute("role","switch");
  el.setAttribute("aria-checked",on?"true":"false");
}
// `real` (opcional): lo que SALE del canal ahora, para la barrita de abajo.
// El slider y el numero son la RECETA —lo que la persona puso—; sin esto, el
// slider mostraba la salida (receta x brillo, o 0 bajo el minimo del 10 %) y
// "cambiaba solo" apenas llegaba el estado (2026-09-17: 5 % de UVA -> 0;
// 30 % con brillo 41 % -> 12).
// El driver no regula entre 0 y 10 %: un valor ahí deja el canal apagado con
// un número que miente. Ningún control de la app puede producirlo.
const PCT_MIN_ON=10;
function bandaMuerta(v){ return (v>0&&v<PCT_MIN_ON)?(v<PCT_MIN_ON/2?0:PCT_MIN_ON):v; }
function paintCh(i,pct,on,real){
  if(pct!=null){$("sl"+i).value=pct;$("pc"+i).textContent=Math.round(pct)+"%";$("bar"+i).style.setProperty("--p",(real!=null?real:pct)+"%");if(pct>0.5)chLastPct[i]=pct;}
  if(on!=null)pintarSw($("sw"+i),on);
  scheduleSpd();
}

// ---------- espectro (SPD) ----------
// Curvas 380-780nm paso 2nm, normalizadas, extraídas del SPD mixer de Cree
// (W3000/W5000 = Cree J Series 730/750 · R660 = XP-G3 Photo Red ·
//  FR730 = XP-E2 Far Red · UV = XE-G Violet ~405nm, placeholder de 365+395)
const SPD=[
/*W3000*/[0.006,0.005,0.006,0.005,0.002,0.002,0.002,0.003,0.003,0.003,0.005,0.006,0.007,0.008,0.011,0.016,0.021,0.027,0.036,0.05,0.063,0.082,0.104,0.131,0.164,0.201,0.243,0.295,0.347,0.409,0.479,0.553,0.618,0.665,0.67,0.62,0.532,0.429,0.341,0.276,0.233,0.201,0.173,0.148,0.124,0.102,0.087,0.075,0.067,0.062,0.059,0.057,0.057,0.057,0.06,0.066,0.076,0.087,0.103,0.122,0.144,0.17,0.195,0.226,0.258,0.29,0.324,0.355,0.387,0.417,0.446,0.472,0.497,0.519,0.54,0.56,0.58,0.597,0.612,0.627,0.642,0.656,0.671,0.686,0.699,0.712,0.728,0.741,0.757,0.772,0.788,0.803,0.82,0.836,0.851,0.868,0.882,0.898,0.913,0.927,0.941,0.951,0.964,0.974,0.982,0.988,0.991,0.996,0.995,1,0.997,0.993,0.986,0.983,0.971,0.963,0.949,0.937,0.921,0.903,0.886,0.869,0.846,0.825,0.804,0.781,0.758,0.736,0.712,0.687,0.662,0.64,0.615,0.59,0.567,0.545,0.523,0.498,0.478,0.456,0.436,0.415,0.396,0.378,0.358,0.34,0.324,0.307,0.291,0.276,0.262,0.249,0.235,0.223,0.211,0.2,0.188,0.178,0.168,0.159,0.15,0.142,0.134,0.127,0.12,0.113,0.107,0.1,0.095,0.089,0.085,0.08,0.075,0.071,0.067,0.063,0.06,0.057,0.054,0.051,0.048,0.044,0.042,0.04,0.038,0.036,0.033,0.032,0.03,0.028,0.027,0.025,0.024,0.023,0.022,0.021,0.019,0.019,0.017,0.017,0.017],
/*W5000*/[0.007,0.004,0.002,0.002,0.001,0,0.001,0,0.001,0.001,0.002,0.003,0.005,0.007,0.01,0.015,0.02,0.027,0.037,0.047,0.062,0.079,0.099,0.125,0.156,0.192,0.234,0.285,0.341,0.407,0.484,0.571,0.664,0.765,0.87,0.952,1,0.989,0.923,0.817,0.698,0.59,0.502,0.436,0.381,0.333,0.289,0.251,0.215,0.189,0.169,0.158,0.149,0.145,0.147,0.149,0.155,0.166,0.18,0.199,0.221,0.247,0.273,0.304,0.336,0.365,0.398,0.427,0.455,0.484,0.509,0.534,0.555,0.573,0.592,0.608,0.619,0.633,0.645,0.652,0.66,0.667,0.675,0.679,0.682,0.687,0.692,0.693,0.696,0.696,0.699,0.697,0.699,0.699,0.698,0.695,0.695,0.692,0.69,0.686,0.68,0.677,0.67,0.664,0.658,0.649,0.639,0.63,0.621,0.613,0.602,0.591,0.578,0.569,0.556,0.544,0.529,0.517,0.503,0.488,0.474,0.46,0.445,0.432,0.418,0.404,0.388,0.375,0.361,0.349,0.334,0.322,0.309,0.296,0.285,0.273,0.26,0.249,0.238,0.228,0.217,0.207,0.198,0.188,0.179,0.17,0.162,0.155,0.147,0.14,0.133,0.126,0.119,0.114,0.108,0.102,0.097,0.092,0.087,0.083,0.078,0.074,0.07,0.066,0.062,0.059,0.055,0.052,0.05,0.047,0.044,0.042,0.039,0.037,0.035,0.033,0.031,0.029,0.028,0.026,0.024,0.023,0.022,0.02,0.019,0.018,0.017,0.016,0.015,0.014,0.013,0.012,0.011,0.01,0.01,0.009,0.008,0.008,0.007,0.007,0.007],
/*R660*/[0.003,0.003,0.001,0,0.002,0.002,0.003,0.002,0.001,0.002,0.002,0.001,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.003,0.003,0.002,0.002,0.002,0.002,0.003,0.003,0.002,0.002,0.002,0.002,0.003,0.002,0.002,0.002,0.003,0.002,0.002,0.002,0.002,0.002,0.003,0.003,0.002,0.003,0.002,0.002,0.003,0.003,0.003,0.002,0.003,0.003,0.002,0.002,0.002,0.002,0.002,0.003,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.003,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.002,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.004,0.004,0.004,0.005,0.005,0.006,0.006,0.007,0.009,0.01,0.011,0.013,0.016,0.018,0.022,0.026,0.031,0.036,0.043,0.054,0.063,0.075,0.088,0.104,0.127,0.149,0.174,0.201,0.233,0.269,0.322,0.371,0.432,0.504,0.584,0.697,0.793,0.888,0.97,1,0.964,0.858,0.704,0.548,0.41,0.301,0.204,0.149,0.109,0.079,0.058,0.04,0.03,0.023,0.018,0.015,0.011,0.01,0.008,0.007,0.006,0.005,0.005,0.004,0.004,0.004,0.004,0.004,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.003,0.002,0.002,0.003,0.003,0.003],
/*FR730*/[0,0.001,0,0,0,0.001,0,0,0.001,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.002,0.002,0.002,0.002,0.003,0.003,0.004,0.005,0.006,0.007,0.009,0.011,0.013,0.015,0.017,0.02,0.024,0.028,0.035,0.041,0.049,0.058,0.068,0.081,0.095,0.114,0.133,0.155,0.181,0.209,0.249,0.286,0.33,0.391,0.445,0.5,0.56,0.631,0.684,0.73,0.79,0.835,0.882,0.924,0.975,0.999,0.998,0.944,0.855,0.733,0.601,0.443,0.334,0.251,0.168,0.124,0.092,0.067,0.048,0.036,0.027,0.021,0.017,0.013,0.01,0.008,0.006,0.005,0.005,0.004,0.003],
/*UV*/[0.022,0.033,0.047,0.075,0.116,0.172,0.257,0.357,0.491,0.65,0.803,0.923,0.989,0.968,0.881,0.717,0.555,0.419,0.322,0.251,0.195,0.148,0.111,0.082,0.062,0.048,0.037,0.029,0.023,0.017,0.013,0.011,0.008,0.007,0.005,0.004,0.003,0.003,0.002,0.002,0.002,0.002,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0.001,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];
// Eje del gráfico: 340-780nm. Las 4 curvas de Cree arrancan en 380 => se rellenan
// con ceros a la izquierda. El canal UV se sintetiza con DOS picos (365 + 395nm),
// que es el armado real del canal (curva de fábrica de Cree 405nm descartada).
const WL_MIN=340,WL_MAX=780,WL_STEP=2;
{
  const pad=Array((380-WL_MIN)/WL_STEP).fill(0);
  for(let c=0;c<4;c++)SPD[c]=pad.concat(SPD[c]);
  const N=(WL_MAX-WL_MIN)/WL_STEP+1;
  // Curvas REALES de los datasheets de los LEDs UV (puntos leídos de los
  // gráficos SPD; asimétricas, con cola derecha — no gaussianas):
  // LED 365nm @500mA: pico ~367nm.  LED 395nm @700mA: pico ~392nm.
  const UV365=[[345,0],[350,.02],[355,.05],[358,.10],[360,.20],[362,.35],[364,.60],[366,.90],[368,1],[370,.80],[372,.55],[374,.35],[376,.22],[378,.16],[380,.12],[384,.07],[388,.05],[392,.035],[396,.025],[400,.02],[405,.012],[410,.008],[420,0]];
  const UV395=[[362,0],[368,.01],[372,.02],[376,.05],[380,.08],[384,.22],[386,.32],[388,.50],[390,.75],[392,1],[394,.97],[396,.80],[398,.65],[400,.52],[402,.38],[404,.28],[406,.20],[408,.15],[410,.11],[414,.06],[418,.035],[422,.02],[430,.012],[440,.006],[450,0]];
  const interp=(pts,w)=>{
    if(w<=pts[0][0]||w>=pts[pts.length-1][0])return 0;
    for(let k=1;k<pts.length;k++){if(w<=pts[k][0]){const a=pts[k-1],b=pts[k];return a[1]+(b[1]-a[1])*(w-a[0])/(b[0]-a[0]);}}
    return 0;
  };
  // mezcla 1:0.95 (ajustar si la potencia radiante de cada LED difiere)
  const uv=[];
  for(let i=0;i<N;i++){const w=WL_MIN+i*WL_STEP;uv.push(interp(UV365,w)+0.95*interp(UV395,w));}
  // suavizado kernel-5: elimina los quiebres de la interpolación sin
  // achatar los picos (verificado: picos 367/392nm, valle 38%)
  const suav=a=>a.map((v,i)=>{const g=j=>a[Math.max(0,Math.min(a.length-1,j))];
    return (g(i-2)+2*g(i-1)+3*v+2*g(i+1)+g(i+2))/9});
  const uvS=suav(suav(suav(uv)));   // x3: validado visualmente (picos 367/394, valle 41%)
  const m=Math.max(...uvS);
  SPD[4]=uvS.map(v=>+(v/m).toFixed(3));
}
// color aproximado por longitud de onda (look ThinkGrow)
function wl2rgb(w){
  let r=0,g=0,b=0;
  if(w<440){r=Math.min(.85,(440-w)/60);b=1}   // <380: violeta profundo (UV)
  else if(w<490){g=(w-440)/50;b=1}
  else if(w<510){g=1;b=-(w-510)/20}
  else if(w<580){r=(w-510)/70;g=1}
  else if(w<645){r=1;g=-(w-645)/65}
  else{r=1}
  let f=1;
  if(w<420)f=Math.max(.22,.3+.7*(w-380)/40);
  else if(w>700)f=Math.max(.25,.3+.7*(780-w)/80);
  return `rgb(${Math.round(255*r*f)},${Math.round(255*g*f)},${Math.round(255*b*f)})`;
}
let spdTmr=0;
function scheduleSpd(){if(!spdTmr)spdTmr=setTimeout(()=>{spdTmr=0;drawSpd()},30);}
function drawSpd(){
  const cv=$("spd");if(!cv)return;
  const dpr=window.devicePixelRatio||1;
  const W=cv.clientWidth*dpr,H=cv.clientHeight*dpr;
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  const ctx=cv.getContext("2d");ctx.clearRect(0,0,W,H);
  const N=SPD[0].length;
  // EL GRAFICO MUESTRA EL ESPECTRO CONFIGURADO, NO LO QUE SALE AHORA.
  // Decision de producto (usuario, 2026-08-15): es "el espectro que la lampara
  // VA A EMITIR", así que se dibuja igual con la luz apagada — de noche por el
  // fotoperíodo, o con canales en off. Antes el peso incluía el estado del
  // switch, así que apagar un canal (o toda la lámpara) vaciaba el gráfico y
  // se perdía de vista la mezcla que uno acababa de configurar.
  // En los modos DINÁMICOS la mezcla configurada cambia con la hora, así que
  // los sliders (que muestran la receta del modo fijo) no son la fuente
  // correcta: dibujarlos ahí mostraba un espectro que la lámpara no va a
  // emitir. El equipo publica en `specnow` la mezcla de ESTE momento del ciclo,
  // calculada con la misma función que decide la salida real. Sin horario
  // activo no viene, y ahí los sliders sí son la verdad.
  const dyn=(state&&Array.isArray(state.specnow)&&state.schedule&&state.schedule.specmode!==0)
              ? state.specnow : null;
  const mix=new Array(N).fill(0);
  for(let c=0;c<NCH;c++){
    let wgt;
    if(dyn){ wgt=(+dyn[c]||0)/100; }
    else { const sl=$("sl"+c); if(!sl)continue; wgt=(+sl.value)/100; }
    if(wgt<=0)continue;
    for(let i=0;i<N;i++)mix[i]+=SPD[c][i]*wgt;
  }
  pintarTablaSpd();   // antes del return temprano: con todo apagado tambien vale
  const top=Math.max(...mix);
  // grilla
  ctx.strokeStyle="rgba(139,148,158,.15)";ctx.lineWidth=1;
  for(let gy=1;gy<4;gy++){ctx.beginPath();ctx.moveTo(0,H*gy/4);ctx.lineTo(W,H*gy/4);ctx.stroke()}
  if(top<=0)return;  // todo apagado: solo grilla
  const pad=2*dpr,h=H-pad;
  // relleno arcoíris recortado por la curva
  ctx.save();
  ctx.beginPath();ctx.moveTo(0,H);
  for(let i=0;i<N;i++)ctx.lineTo(i/(N-1)*W,H-(mix[i]/top)*h);
  ctx.lineTo(W,H);ctx.closePath();ctx.clip();
  const gr=ctx.createLinearGradient(0,0,W,0);
  for(let w=WL_MIN;w<=WL_MAX;w+=10)gr.addColorStop((w-WL_MIN)/(WL_MAX-WL_MIN),wl2rgb(w));
  ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
  ctx.restore();
  // contorno
  ctx.beginPath();
  for(let i=0;i<N;i++){const x=i/(N-1)*W,y=H-(mix[i]/top)*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}
  ctx.strokeStyle="rgba(255,255,255,.55)";ctx.lineWidth=1.2*dpr;ctx.stroke();
}
// Alternativa textual del grafico: los mismos cinco numeros que dibuja la
// curva, para quien no puede verla. Se rellena en cada redibujado.
function pintarTablaSpd(){
  const host=$("spd-tabla"); if(!host)return;
  const dyn=(state&&Array.isArray(state.specnow)&&state.schedule&&state.schedule.specmode!==0)
              ? state.specnow : null;
  const val=c=>{ if(dyn) return Math.round(+dyn[c]||0);
                 const sl=$("sl"+c); return sl?Math.round(+sl.value):0; };
  // Leyenda con el NOMBRE, no con el tag (UX-260908-07): "FR730 30 %" no le
  // dice a nadie cuál curva es la del rojo lejano. El color del texto es el
  // mismo con el que se dibuja la curva, así la leyenda y el gráfico se
  // pueden emparejar sin contarlos de izquierda a derecha.
  host.textContent="";
  CH_NOMBRE.forEach((n,i)=>{
    if(i){ host.appendChild(document.createTextNode(" · ")); }
    const sp=document.createElement("span");
    sp.style.color="var("+COLORS[i]+")";
    sp.textContent=n+" "+val(i)+"%";
    host.appendChild(sp);
  });
  // El resumen del encabezado plegado: sin abrir el gráfico ya se ve qué está
  // emitiendo, que es la pregunta que el gráfico contesta.
}
window.addEventListener("resize",scheduleSpd);
// Contesta las cuatro preguntas del operador: si esta encendida, que receta
// rige, que va a pasar despues y si hay algo que atender.
// El enlace remoto, dicho como se siente y no como se implementa.
function pintarNube(n){
  const caja=$("nu-estado"); if(!caja)return;
  if(!n){ caja.textContent="—"; return; }
  // Un enlace que dice "en linea" y hace veinte minutos que no habla no esta
  // en linea. Por eso se mira tambien cuanto hace del ultimo contacto.
  const viejo = n.cod===3 && n.hace>90;
  const col = n.cod===3 && !viejo ? "var(--acc)"
            : n.cod===4||n.cod===5 ? "#ff9d95"
            : "var(--dim)";
  const txt = viejo ? "sin hablar con el servidor hace "+fmtDur(n.hace)
            : n.cod===3 ? "conectado — última señal hace "+fmtDur(n.hace)
            : n.cod===0 ? "desactivado"
            : n.cod===2 && /registrando/.test(n.motivo||"") ? "registrando el equipo en la nube…"
            : n.st;
  // `motivo` y `serie` vienen del equipo. Hoy son literales del firmware,
  // pero un equipo comprometido —o un estado manipulado en la base— podria
  // traer HTML. Se arma con nodos: es la misma defensa que en la lista de
  // equipos y cuesta lo mismo.
  caja.textContent="";
  const punto=document.createElement("span");
  punto.style.color=col; punto.textContent="● ";
  const fuerte=document.createElement("b"); fuerte.textContent=txt;
  caja.appendChild(punto); caja.appendChild(fuerte);
  const linea=t=>{ caja.appendChild(document.createElement("br"));
    const e=document.createElement("span"); e.style.color="var(--dim)";
    e.textContent=t; caja.appendChild(e); };
  if(n.cod===4||n.cod===5) linea(n.motivo||"");
  linea("serie "+(n.serie||"—")+(n.env?" · "+n.env+" envíos":"")+
        (n.fall?" · "+n.fall+" fallos":""));
}

// La tarjeta Actualizaciones: pinta lo que el equipo dice de si mismo
// (instalada, disponible, en que anda) y decide que boton toca.
function pintarUpd(u){
  const caja=$("upd-estado"), bb=$("upd-buscar"), bh=$("upd-hacer");
  if(!caja||!bb||!bh) return;
  if(!u){ caja.textContent="—"; bb.disabled=true; bh.style.display="none"; return; }
  const esc=t=>{const d=document.createElement("span");d.textContent=t;return d.innerHTML;};
  let html="", col="var(--tx)", buscar=true, hacer=false, txtHacer="Actualizar ahora";
  const inst="Instalada <b>"+esc(u.inst||"?")+"</b>";
  switch(u.st){
    case "buscando":    html=inst+"<br>Buscando…"; buscar=false; break;
    case "al_dia":      html=inst+" · <span style='color:var(--acc)'>es la última versión</span>"; break;
    case "disponible":  html=inst+" → disponible <b style='color:var(--warn)'>"+esc(u.disp)+"</b>"
                          +(u.notas?"<br><span style='color:var(--dim)'>"+esc(u.notas)+"</span>":"")
                          +(u.bytes?"<br><span style='color:var(--dim)'>"+Math.round(u.bytes/1024)+" KB</span>":"");
                        hacer=true; break;
    case "descargando": html="Actualizando a <b>"+esc(u.disp)+"</b>: descargando "+(u.prog|0)+" %"
                          +"<br><span style='color:var(--warn)'>No apagues el equipo.</span>"; buscar=false; break;
    case "verificando": html="Actualizando a <b>"+esc(u.disp)+"</b>: verificando…"; buscar=false; break;
    case "listo":       html="<span style='color:var(--acc)'>Actualización instalada.</span> El equipo se está reiniciando; "
                          +"la app se reconecta sola."; buscar=false; break;
    case "error":       html=inst+"<br><span style='color:#ff9d95'>No se pudo: "+esc(u.msg||"")+"</span>";
                        if(u.disp){ hacer=true; txtHacer="Reintentar"; } break;
    case "sin_red":     html=inst+"<br><span style='color:var(--dim)'>El equipo no tiene internet: no puede buscar.</span>"; break;
    default:            html=inst; break;
  }
  caja.innerHTML=html; caja.style.color=col;
  bb.disabled=!buscar;
  bh.style.display=hacer?"":"none"; bh.textContent=txtHacer;
}

function pintarResumen(st){
  const card=$("resumen"); if(!card||!st)return;
  card.style.display="";

  const sc=st.schedule||{};
  const ne=sc.enabled&&sc.next&&typeof sc.next.on==="boolean"?sc.next:null;
  // "Encendida" con el mismo criterio que el indicador de la pantalla: dentro
  // de la ventana de luz del fotoperíodo cuenta como encendida aunque los
  // canales todavía estén por debajo del piso (rampa de encendido). Antes
  // sólo miraba los canales y los dos indicadores se contradecían un rato.
  const esDia=ne?!ne.on:null;
  const enc=(st.channels||[]).some(c=>c&&c.on&&c.pct>0)||esDia===true;
  const dim=+st.dim||0;
  $("rs-luz").innerHTML=enc
    ? "<span style='color:var(--acc)'>● Encendida</span> <span style='color:var(--dim);font-weight:400;font-size:14px'>— brillo "+dim+"%</span>"
    : "<span style='color:var(--dim)'>○ Apagada</span>";

  // Las horas, dichas: "Enciende a las 06:00 · Apaga a las 20:00". En
  // Superciclo (ciclo relativo) no hay horas fijas del día: se dice el
  // próximo cambio con su hora. Pedido del 2026-09-16.
  const hor=$("rs-horario");
  if(hor){
    let h="";
    if(sc.enabled&&!sc.cyclemode&&sc.on!=null&&sc.off!=null&&sc.on!==sc.off)
      h="Enciende a las <b>"+m2t(sc.on)+"</b> · Apaga a las <b>"+m2t(sc.off)+"</b>";
    else if(sc.enabled&&ne&&st.time){
      const tp=st.time.split(":"),tgt=((+tp[0])*60+(+tp[1])+(+ne.in||0))%1440;
      h=(ne.on?"Enciende":"Apaga")+" a las <b>"+m2t(tgt)+"</b>";
    }
    hor.innerHTML=h; hor.style.display=h?"":"none";
  }
  let rige;
  if(!sc.enabled) rige="Receta fija, sin fotoperíodo: luz continua.";
  else if(sc.specmode===1) rige="Espectro Día natural, dentro del fotoperíodo.";
  else if(sc.specmode===2) rige="Espectro por etapas, dentro del fotoperíodo.";
  else if(sc.specmode===3){
    const pr=(progsLib.custom||[]).concat(progsLib.factory||[]).find(x=>x&&x.id===sc.progid);
    rige="Programa "+((pr&&(pr.n||pr.name))||sc.progid||"—")+", dentro del fotoperíodo.";
  } else rige="Receta fija, dentro del fotoperíodo.";
  $("rs-rige").textContent="Rige: "+rige;

  // "Que pasa despues" sale del mismo calculo que ya alimenta la linea de
  // tiempo; si no hay horario, no hay proximo evento y se dice.
  const prox=$("rs-prox");
  const rem=$("sch-remain");
  if(!sc.enabled) prox.textContent="Sin cambios previstos: el fotoperíodo está apagado.";
  else if(rem&&rem.textContent.trim()) prox.textContent=rem.textContent.trim();
  // La cuenta regresiva sólo se calcula en modo 24 h; en Superciclo queda
  // vacía. Un renglón en blanco parece un error, así que se dice lo que sí
  // se sabe en vez de no decir nada.
  else prox.textContent=sc.cyclemode===1
    ? "Superciclo en curso ("+Math.round((+sc.light||0)/60)+" h luz / "
      +Math.round((+sc.dark||0)/60)+" h oscuridad)."
    : "Fotoperíodo activo.";

  // Una sola alerta, la mas grave primero.
  const al=$("rs-alerta");
  let msg="";
  // Por internet, `edadSeg` la pone la capa de nube: es la edad de la foto.
  // Una foto vieja se dice ANTES que nada — lo que se ve abajo puede no ser
  // lo que el equipo tiene ahora (2026-09-16: la PC cambió cosas, el
  // celular mostraba las de horas atrás y nada lo avisaba a la vista).
  if(st.edadSeg>60) msg="⚠ Datos de hace "+fmtDur(Math.round(st.edadSeg))+": el equipo no está publicando. Lo que ves puede haber cambiado.";
  else if(st.cfgfault) msg="⚠ "+st.cfgfault;
  else if(st.tqi===0||st.cal===false) msg="⚠ El equipo no tiene hora confiable: el horario puede no cumplirse.";
  else if(st.hw===false) msg="⚠ La placa de potencia no responde.";
  if(msg){al.style.display="";al.style.color="#e3b341";al.textContent=msg;}
  else al.style.display="none";
}

function applyState(st){
  state=st;
  // Aviso de rol: el firmware ignora cualquier comando de control que llegue
  // por WS salvo en rol 2 (WiFi Maestro) — sin este aviso, mover un slider en
  // rol 0/1 se pintaba solo (optimista) y milisegundos despues "rebotaba" al
  // valor real con el proximo estado del servidor, sin ninguna explicacion:
  // se sentia como un bug de lag, no como un bloqueo intencional.
  // Ademas del aviso, se atenuan y bloquean al toque los controles que el
  // firmware va a ignorar igual (clase .ro-target, ver CSS) — asi la app no
  // "miente" mostrando sliders tocables que en realidad no hacen nada.
  document.body.classList.toggle("ro-locked",st.role!==2);
  const banner=$("role-banner");
  if(banner){
    if(st.role===0){
      banner.textContent="🔒 Modo Local — los controles de abajo están deshabilitados, este equipo se controla solo desde su pantalla";
      banner.style.display="block";
    } else if(st.role===1){
      banner.textContent="🔒 Modo Esclavo — los controles de abajo están deshabilitados, recibe la configuración de otra luminaria por RS485";
      banner.style.display="block";
    } else {
      banner.style.display="none";
    }
  }
  // Salud del equipo: hora y red. Lo primero es la hora — de ella depende
  // TODO el fotoperiodo, y hasta ahora la app no tenía forma de mostrar que
  // el equipo estaba corriendo con una hora dudosa (o directamente sin hora).
  const dev=$("dev-banner");
  if(dev){
    const tqi=(st.tqi==null?4:st.tqi), net=st.net||{};
    // Sincronización automática al conectar, SOLO cuando no hay nada que
    // preservar: el equipo no sabe la hora, o sabe HH:MM (puesta a mano en la
    // pantalla) pero no sabe la FECHA. En esos dos casos no se está pisando
    // ninguna decisión del usuario, se está completando lo que falta.
    // Con una fecha real ya puesta NO se toca (decisión CL-010): ahí fijar la
    // hora corre la fase del fotoperíodo, y eso lo decide la persona con el
    // botón, no una reconexión.
    if(!autoTimeSynced&&!demo&&(tqi===0||!st.cal)){
      autoTimeSynced=true;
      if(send({cmd:"set_time",epoch:Math.floor(Date.now()/1000),utc:true}))
        toast("Poniendo en hora el equipo con este teléfono…");
      else autoTimeSynced=false;   // no salió: reintentar en el próximo estado
    }
    let html="", cls="";
    if(st.cfgfault){
      // Falla bloqueante: mientras dure, el equipo no enciende. Va primero
      // que cualquier otro aviso porque explica por qué no hay luz.
      cls="bad";
      html="⛔ <b>"+st.cfgfault+"</b><br>El equipo no va a encender hasta que lo reconfigures: "
          +"volvé a guardar el fotoperíodo y el modo de control.";
    }else if(tqi===0){
      cls="bad";
      html="⛔ <b>El equipo no tiene la hora puesta</b><br>El horario automático está detenido hasta que se la fijes."+
           "<button class='btn acc' id='btn-synctime'>Poner la hora ahora</button>";
    }else if(st.schedule&&st.schedule.cyclemode===1&&!st.cal){
      cls="bad";
      html="⛔ <b>Superciclo detenido: falta la fecha</b><br>HH:MM alcanza para <b>Día 24hs</b>, pero este modo necesita día, mes y año."+
           "<button class='btn acc' id='btn-synctime'>Sincronizar fecha y hora</button>";
    }else if(!st.cal){
      // Falta la FECHA aunque haya HH:MM (típico: hora puesta a mano desde la
      // pantalla). Antes este aviso existía SOLO si ya estabas en Superciclo,
      // así que en modo 24 h la app no decía nada y el usuario se enteraba
      // recién al intentar activar Superciclo — que además lo rechazaba
      // pidiendo sincronizar SIN darle ningún botón para hacerlo. Callejón
      // sin salida, reportado desde la placa (2026-08-16).
      cls="warn";
      html="⚠ <b>El equipo no sabe la fecha</b><br>Con HH:MM alcanza para <b>Día 24hs</b>, pero "+
           "<b>Superciclo</b> necesita día, mes y año."+
           "<button class='btn acc' id='btn-synctime'>Sincronizar fecha y hora</button>";
    }else if(tqi===1){
      cls="warn";
      html="⚠ <b>Hora estimada</b><br>El equipo perdió la hora exacta (sin internet ni pila de respaldo) y sigue "+
           "contando por su cuenta: el horario corre igual, pero puede estar corrido."+
           "<button class='btn acc' id='btn-synctime'>Sincronizar con este dispositivo</button>";
    }else if(net.cred&&net.off>120){
      cls="warn";
      html="📶 El equipo está <b>sin WiFi hace "+fmtDur(net.off)+"</b> y lo reintenta solo"+
           (net.next?" (próximo intento en "+fmtDur(net.next)+")":"")+
           ".<br>La luminaria sigue funcionando normalmente con su configuración guardada.";
    }
    dev.innerHTML=html;   // contenido fijo + números propios, sin datos de terceros
    dev.className=cls;
    dev.style.display=html?"block":"none";
    const bs=$("btn-synctime");
    if(bs)bs.onclick=()=>{sendTime();toast("Hora enviada al equipo");};
  }
  // Estado de la red, con el MISMO criterio de señal que usa la pantalla del
  // equipo (buena > -60, media -60..-75, débil < -75): que los dos digan lo
  // mismo del mismo dato es justamente lo que hace confiable a la interfaz.
  {
    const w=$("wf-status"), n=st.net||{};
    if(w){
      const esc=s=>{const d=document.createElement("span");d.textContent=s;return d.innerHTML;};
      if(n.st==="Conectado"){
        const r=+n.rssi||0;
        const cal=r>-60?"señal buena":r>-75?"señal media":"señal débil";
        const ico=r>-60?"●●●":r>-75?"●●○":"●○○";
        // El equipo publica el SSID en st.ssid y la IP en st.wifi (no dentro
        // de net): la tarjeta decia "Conectado a" a secas (2026-09-17).
        w.innerHTML="✅ Conectado a <b>"+esc(n.ssid||st.ssid||n.cfg||"")+"</b><br>"
          +"<span style='color:var(--dim)'>"+esc(n.ip||st.wifi||"")+" · "+ico+" "+r+" dBm · "+cal
          +(n.ntp?" · hora por internet":"")+"</span>";
        w.style.borderColor=r>-75?"rgba(63,185,80,.4)":"rgba(232,179,57,.5)";
      }else if(n.st==="Sin red"){
        // n.cfg = la red GUARDADA. Nombrarla es lo que convierte "sin red" en
        // algo accionable: el equipo se mudó de lugar y sigue buscando la red
        // de antes, y hasta que no se dice cuál es, el usuario no sabe qué
        // está pasando ni qué va a olvidar.
        // n.fail = por qué no entra ("clave" / "nored" / "otro"): el equipo lo
        // supo siempre y no lo decía (2026-09-16).
        const why=n.fail==="clave"?"❌ La clave de la red es incorrecta: volvé a configurarla"
                 :n.fail==="nored"?"❌ No se encuentra la red: revisá el nombre o el alcance"
                 :n.fail==="otro" ?"❌ No se pudo conectar (motivo "+(n.failn|0)+")":"";
        w.innerHTML="⚠️ <b>Sin red</b>"+(n.off?" hace "+fmtDur(n.off):"")
          +(why?"<br><span style='color:#f85149'>"+why+"</span>":"")
          +(n.cfg?"<br><span style='color:var(--dim)'>Busca <b>"+esc(n.cfg)+"</b></span>":"")
          +(n.next?"<br><span style='color:var(--dim)'>Reintenta en "+fmtDur(n.next)+"</span>":"");
        w.style.borderColor=why?"rgba(248,81,73,.5)":"rgba(232,179,57,.5)";
      }else if(n.st==="Conectando"){
        w.innerHTML="🔄 Conectando"+(n.cfg?" a <b>"+esc(n.cfg)+"</b>":"")+"…";
        w.style.borderColor="var(--line)";
      }else{
        w.innerHTML="○ <b>Sin red configurada</b><br><span style='color:var(--dim)'>"
          +"Estás usando la red propia del equipo"+(n.ap?" ("+esc(n.ap)+")":"")+".</span>";
        w.style.borderColor="var(--line)";
      }
      // La cuenta de reconexiones sólo aparece si hubo alguna: con señal justa
      // es el número que delata que el enlace se está cayendo cada tanto.
      if(n.rec>0) w.innerHTML+="<br><span style='color:var(--dim);font-size:13px'>"
        +n.rec+" reconexión"+(n.rec>1?"es":"")+" desde el arranque</span>";
    }
    // El botón de olvidar sigue a que HAYA una red guardada (n.cred), no a que
    // esté conectada: mudar el equipo de una red a otra es un caso normal.
    const fr=$("wf-forget-row");
    if(fr){
      fr.style.display=n.cred?"flex":"none";
      $("wf-forget").dataset.ssid=n.cfg||n.ssid||"";
      $("wf-forget").textContent=n.cfg?("Olvidar \""+n.cfg+"\""):"Olvidar la red guardada";
    }
  }
  // Con el horario activo, el valor "real" del canal (st.channels[i].pct) es
  // la receta YA multiplicada por la ventana horaria y el brillo global — de
  // noche (o en cualquier tramo apagado) cae a 0 y la pantalla se veía "toda
  // apagada". Esto le pasa a los 3 modos de espectro (fijo/día natural/
  // programa — Scheduler.cpp aplica el factor de ventana horaria a los tres
  // por igual), no solo al modo fijo. Para "fijo" y "día natural" hay un
  // valor de referencia razonable para mostrar en vez del 0 (schedule.day:
  // la receta directa en modo fijo, el pico de mediodía en día natural); en
  // modo "programa" no hay un único valor de referencia en el estado que
  // llega por WS, así que ahí se sigue mostrando el valor real (puede
  // mostrar 0 de noche, pero al menos queda protegido por el candado).
  const showRecipe=st.schedule.enabled&&(st.schedule.specmode===0||st.schedule.specmode===1);
  // MODO AUTOMATICO: con espectro dinamico la mezcla la maneja el equipo y el
  // usuario no puede cambiarla, asi que no tiene sentido mostrarle sliders y
  // switches que no van a hacer nada. Se retiran y la fila queda como lectura,
  // con el % de ESTE momento (specnow) siguiendo al grafico.
  const autoSpec=st.schedule.enabled&&st.schedule.specmode!==0&&
                 Array.isArray(st.specnow);
  const chCard=$("channels");
  if(chCard) chCard.classList.toggle("auto",autoSpec);
  const avisoAuto=$("ch-auto");
  if(avisoAuto){
    avisoAuto.style.display=autoSpec?"":"none";
    if(autoSpec){
      // Que diga QUE programa esta rigiendo, no solo "automatico": con un
      // programa del usuario el nombre es el unico dato que lo identifica.
      let quien="Día natural";
      if(st.schedule.specmode===2) quien="Espectro por etapas";
      else if(st.schedule.specmode===3){
        const p=(progsLib.custom||[]).concat(progsLib.factory||[])
                  .find(x=>x&&x.id===st.schedule.progid);
        // Los programas usan `n`, no `name`: con `p.name` esto era siempre falso
        // y terminaba mostrando el id tecnico ("veg18") en vez del nombre.
        quien="Programa "+((p&&(p.n||p.name))||st.schedule.progid||"—");
      }
      const t=document.createElement("span"); t.textContent=quien;
      avisoAuto.innerHTML="🔄 <b>Espectro automático</b> — "+t.innerHTML+
        "<br><span style='color:var(--dim)'>La mezcla la ajusta el equipo a lo largo del ciclo. "+
        "Los valores de abajo son los de este momento.</span>";
    }
  }
  // Editando una etapa, los sliders son el EDITOR de esa etapa: pisarlos con
  // lo que el equipo está emitiendo borra lo que el usuario acaba de mover, y
  // como el estado llega cada 5 s no llega ni a tocar Guardar. Ver CL-046.
  const notaCanal=(i,txt)=>{const n=$("nota"+i);if(!n)return;n.textContent=txt||"";n.style.display=txt?"":"none";};
  if(!editandoEtapa()) st.channels.forEach(c=>{
    // En automatico el numero que se muestra es el del momento (specnow), el
    // mismo que dibuja el grafico y que informa el monitor serie.
    // Receta = st.schedule.day (la mantiene el equipo tambien sin horario);
    // salida real = c.pct. En automatico se muestra la mezcla del momento.
    const day=Array.isArray(st.schedule.day)&&st.schedule.day[c.id]!=null?+st.schedule.day[c.id]:c.pct;
    const pct=autoSpec?st.specnow[c.id]:day;
    const on=autoSpec?pct>0.5:(st.schedule.enabled?day>0.5:c.on);
    paintCh(c.id,pct,on,autoSpec?null:+c.pct);
    // Un canal con receta pero apagado en plena fase de luz esta bajo el
    // minimo del 10 % (config.h): decirlo al lado, en vez de un slider que
    // parece ignorado.
    let nota="";
    if(!autoSpec&&day>0.5&&!c.on){
      const ne=st.schedule.next; const enLuz=!st.schedule.enabled||(ne&&ne.on===false);
      if(enLuz){ const dim=+st.dim||0; const sale=Math.round(day*dim/100);
        nota=dim<100?"con brillo "+dim+"% sale "+sale+"%: bajo el mínimo (10%), apagado":"bajo el mínimo (10%): apagado"; }
    }
    notaCanal(c.id,nota);
  });
  // Sin el guard de schDirty: tocar el interruptor solo marca el borrador
  // (sch-en.onclick no manda nada, hace falta "Guardar"), pero esta linea
  // corria en CADA estado que empuja el equipo (heartbeat de 5 s) y lo volvia
  // a pintar con el valor viejo antes de llegar a guardar — se veia como "lo
  // apago y se prende solo". Mismo criterio que setSchField() con los campos
  // de texto, ver comentario mas abajo.
  if(!schDirty) pintarSw($("sch-en"),st.schedule.enabled);
  toggleSchCfg(st.schedule.enabled);
  // No pisar un campo mientras el usuario lo tiene enfocado: el equipo empuja
  // el estado cada 5s (heartbeat de main.cpp), y sin este guard el valor recien
  // tipeado se sobreescribia con el viejo antes de llegar a tocar "Guardar" —
  // se sentia como "el campo siempre vuelve al valor anterior".
  const setIfIdle=(id,val)=>{const el=$(id);if(el&&document.activeElement!==el)el.value=val;};
  // ...pero el guard por foco solo alcanza para UN campo: el formulario del
  // fotoperíodo son varios. Cargabas la hora de encendido, pasabas a la de
  // apagado, y al soltar el primer campo el heartbeat de 5 s lo devolvía al
  // valor viejo del equipo — se veía como "poner el apagado me cambia el
  // encendido". Mientras haya un borrador sin guardar, el equipo NO pisa
  // ninguno de estos campos.
  const setSchField=(id,val)=>{if(!schDirty)setIfIdle(id,val);};
  setSchField("sch-on",m2t(st.schedule.on));
  setSchField("sch-off",m2t(st.schedule.off));
  setSchField("sch-ramp",st.schedule.ramp);
  if(st.onrampmin!=null) setSchField("onramp-min",st.onrampmin);
  if(st.onramp!=null&&!schDirty) pintarSw($("onramp-en"),!!st.onramp);
  // El bloque que decide qué controles se ven según el modo de espectro está
  // MÁS ABAJO, después de que dynMode se actualice desde el estado del equipo:
  // acá arriba todavía vale el modo anterior y el primer repintado saldría mal.
  // Modo de ciclo: sólo se adopta el del equipo si el usuario no está en
  // medio de configurarlo (mismo criterio que setIfIdle con los campos).
  if(!schDirty&&!cycDraftDirty&&st.schedule.cyclemode!=null&&!$("cfg-free").contains(document.activeElement)
     &&!$("cfg-daily").contains(document.activeElement)){
    cycMode=st.schedule.cyclemode?1:0;
  }
  if(st.schedule.light!=null) setSchField("cyc-light",(st.schedule.light/60));
  if(st.schedule.dark!=null)  setSchField("cyc-dark",(st.schedule.dark/60));
  if(st.schedule.anchor&&!schDirty){
    const el=$("cyc-anchor");
    if(el&&document.activeElement!==el){
      // anchor viene como epoch de hora de pared; para el input datetime-local
      // hay que volver a texto local sin que el navegador reinterprete la zona.
      el.value=new Date(st.schedule.anchor*1000).toISOString().slice(0,16);
    }
  }
  paintCycMode();
  // Mismo guard que sch-en un poco mas arriba: sin schDirty, el heartbeat de
  // 5 s pisaba el interruptor tocado antes de llegar a "Guardar".
  if(!schDirty) pintarSw($("sch-fr"),!!st.schedule.sunsim);
  {
    const sch=st.schedule;
    const offWrapsMidnight=sch.off<sch.on;
    const continuous24=!sch.cyclemode&&sch.on===sch.off;
    const offStr=m2t(sch.off)+(offWrapsMidnight?" (día sig.)":"");
    let statusHtml="";
    let isDay=false, left=0;
    if(sch.enabled&&st.time){
      // Si el equipo mandó el próximo evento, es la fuente autoritativa y
      // funciona igual en los dos modos de ciclo. El cálculo local queda de
      // respaldo (demo / firmware viejo) y sólo es válido en modo 24 h.
      if(continuous24){
        isDay=true;left=0;
      }else if(sch.next){
        isDay=!sch.next.on;
        left=isDay?sch.next.in:0;
      }else{
        const tp=(st.time||"0:0:0").split(":");
        const nowMin=(+tp[0])*60+(+tp[1]);
        const dur=(sch.off-sch.on+1440)%1440||1440;
        const since=(nowMin-sch.on+1440)%1440;
        isDay=since<dur;
        left=Math.max(0,dur-since);
      }
      statusHtml=' &nbsp;<span style="color:'+(isDay?'var(--acc)':'#4a8cc2')+';font-size:12px">&#9679;&nbsp;'+(isDay?'Encendido':'Noche')+'</span>';
    }
    // "rampa" acá era enganoso: sch.ramp es la ventana de far-red de
    // amanecer/atardecer, no la rampa de encendido (que vive en la pantalla
    // del equipo y no se configura desde la app).
    // En superciclo no existe una "hora de apagado" fija: cambia cada ciclo.
    const cabecera = continuous24 ? "Luz continua las 24 h" : sch.cyclemode
      ? ("Ciclo de "+(((sch.light||0)+(sch.dark||0))/60).toFixed(1).replace(/\.0$/,"")+" h: "
         +((sch.light||0)/60).toFixed(1).replace(/\.0$/,"")+" h de luz + "
         +((sch.dark||0)/60).toFixed(1).replace(/\.0$/,"")+" h de oscuridad")
      : ("Apaga a las "+offStr);
    $("sch-info").innerHTML=cabecera+statusHtml
      +(sch.sunsim?(" &mdash; amanecer/atardecer "+sch.ramp+" min"):"")+".";
    // Timeline 24h
    const tlBg=$("sch-tl-bg"),tlNow=$("sch-tl-now");
    if(tlBg){
      if(sch.enabled){
        const onF=(sch.on/14.4).toFixed(1),offF=(sch.off/14.4).toFixed(1);
        tlBg.style.background=continuous24?"var(--acc)":(!offWrapsMidnight)
          ?`linear-gradient(90deg,var(--line) ${onF}%,var(--acc) ${onF}%,var(--acc) ${offF}%,var(--line) ${offF}%)`
          :`linear-gradient(90deg,var(--acc) ${offF}%,var(--line) ${offF}%,var(--line) ${onF}%,var(--acc) ${onF}%)`;
      } else {
        tlBg.style.background="var(--line)";
      }
      if(st.time&&tlNow){
        const tp2=st.time.split(":"),nowMin2=(+tp2[0])*60+(+tp2[1]);
        tlNow.style.left=(nowMin2/14.4).toFixed(1)+"%";
        tlNow.style.display="";
      }
    }
    // Tiempo restante / próximo encendido.
    // Se prefiere el valor que manda el equipo (schedule.next): sale de
    // Scheduler::nextEvent(), la MISMA cuenta con la que el firmware decide
    // encender o apagar, así que la app no puede terminar diciendo algo
    // distinto de lo que va a pasar de verdad. El cálculo local queda solo de
    // respaldo, para el modo demo y para un equipo con firmware viejo.
    const remain=$("sch-remain");
    if(remain){
      const fmtHM=min=>{
        const h=Math.floor(min/60),m=min%60;
        if(h&&m)return h+"h "+m+"min";
        if(h)return h+"h";
        return m?m+"min":"menos de 1min";
      };
      let txt="", col="";
      const ne=sch.next;
      if(sch.enabled&&continuous24){
        txt="Luz continua: no hay próximo apagado";col="var(--acc)";
      }else if(sch.enabled&&ne){
        txt=ne.on?("Próximo encendido en "+fmtHM(ne.in)):("Quedan "+fmtHM(ne.in)+" de luz hoy");
        col=ne.on?"#4a8cc2":"var(--acc)";
      } else if(sch.enabled&&st.time){
        if(isDay){ txt="Quedan "+fmtHM(left)+" de luz hoy"; col="var(--acc)"; }
        else {
          const tp4=st.time.split(":"),nm4=(+tp4[0])*60+(+tp4[1]);
          txt="Próximo encendido en "+fmtHM((sch.on-nm4+1440)%1440); col="#4a8cc2";
        }
      }
      remain.textContent=txt;
      remain.style.color=col;
      remain.style.display=txt?"block":"none";
    }
  }
  // espectro dinámico
  if(!cycDraftDirty){
    dynMode=st.schedule.specmode||0;
    activeProg=st.schedule.progid||"";
  }
  // Mientras haya un borrador sin guardar NO se pisan las etapas: el equipo
  // manda su estado cada 5 s, así que sin esta guarda el usuario mueve un
  // canal en modo Personalizado y se le revierte solo antes de poder guardar.
  // Mismo criterio que setSchField() con los campos del horario.
  if(st.schedule.stages&&!schDirty)dynStages=st.schedule.stages.map(e=>e.slice());
  pintarSw($("dyn-en"),dynMode>0);
  $("dyn-body").style.display=dynMode>0?"block":"none";
  // uiTab es NAVEGACIÓN DEL USUARIO —qué pestaña está mirando—, no estado del
  // equipo. Antes se re-derivaba de dynMode en CADA latido: al tocar
  // "Programas" con día natural activo, la lista se abría y a los pocos
  // segundos el heartbeat la cerraba sola y devolvía la selección a día natural
  // (reportado desde la placa, 2026-08-17). Es el mismo defecto que CL-018 con
  // el borrador del horario: el estado del equipo pisando la intención del
  // usuario. Ahora la pestaña sólo se re-deriva cuando el equipo CAMBIA de
  // modo, que es la única vez que corresponde moverla sola.
  if(dynMode!==lastDynModeSeen){
    lastDynModeSeen=dynMode;
    if(dynMode>0) uiTab=(dynMode===3?3:(dynMode===2?2:1));
  }
  // El resaltado sigue a la PESTAÑA, no al modo activo: si estoy mirando la
  // lista de programas, el botón verde tiene que ser "Programas" aunque el modo
  // que está corriendo todavía sea día natural. Antes seguía al modo, así que
  // el botón que uno acababa de tocar no se encendía nunca.
  paintDynTab();
  paintChips();renderProgChips();
  // "Día natural" ya incluye el far-red de alba/ocaso en su propia curva y ya
  // arranca la fase de luz casi en cero, así que ofrecer aparte el
  // amanecer/atardecer y la rampa de encendido sería el mismo efecto dos veces
  // (decisión del usuario, 2026-08-17). Se ocultan y se explica por qué: un
  // hueco sin explicación se lee como una falla.
  // El brillo global NO se toca — en cualquier modo el usuario tiene que poder
  // regular la potencia final del equipo.
  {
    const esNatural=dynMode===1;
    $("natural-note").style.display=esNatural?"":"none";
    $("fr-block").style.display=esNatural?"none":"";
    $("onramp-block").style.display=esNatural?"none":"";
    $("onramp-body").style.display=
      (!esNatural&&$("onramp-en").classList.contains("on"))?"":"none";
    // El campo de minutos de amanecer/atardecer vive en la MISMA grilla que el
    // botón Guardar, así que no alcanzaba con ocultar el bloque del switch:
    // quedaba a la vista un ajuste que en día natural no hace absolutamente
    // nada, justo debajo del cartel que dice que no se configura aparte
    // (reportado desde la placa, 2026-08-17). Se oculta sólo la celda del campo
    // y el botón pasa a ocupar las dos columnas — Guardar TIENE que seguir
    // estando, porque guarda los horarios del fotoperíodo.
    $("ss-min-block").style.display=esNatural?"none":"";
    $("sch-save-cell").style.gridColumn=esNatural?"1/-1":"";
  }
  $("dyn-info").textContent=dynMode===0?"":(dynMode===1
    ?"Programa día natural (fijo, no editable). Tocá una etapa para verla."
    :dynMode===2
      ?"Tu espectro por tramos del día. Tocá una etapa y mové los canales."
    :dynMode===3?(cycMode===1
      ?"Programa relativo al encendido. El paso +0 h es obligatorio."
      :"Programa por hora de reloj. El espectro cambia en cada paso."):"");
  $("fw").textContent=st.fw;
  $("time").textContent=(st.time||"—")+(st.tq?" ("+st.tq+")":"");
  $("ip").textContent=(st.ssid?st.ssid+" · ":"")+(st.wifi||"");
  $("devid").textContent=st.id&&st.id!=="DEMO"?("#"+st.id):"";
  if(st.dim!=null){$("dim-sl").value=st.dim;$("dim-pc").textContent=Math.round(st.dim)+"%";}
  // El renglón de estado distingue DOS cosas que antes se confundían: que la
  // app tenga conexión con el equipo, y que el equipo tenga conexión con la
  // red de casa. Se puede estar perfectamente conectado a un equipo que hace
  // horas que no ve el router, y eso no es una falla.
  if(demo)$("status").textContent="modo demostración (sin equipo)";
  else if(!st.hw)$("status").textContent="⚠ Placa B no detectada (chequear I2C)";
  else{
    const net=st.net||{};
    $("status").textContent = st.ssid
      ? "equipo en "+st.ssid+(net.ntp?" · hora por internet":"")
      : (net.cred&&net.off ? "equipo en su red propia · sin WiFi de casa hace "+fmtDur(net.off)
                           : "equipo en su red propia"+(net.ap?" ("+net.ap+")":""));
  }
  pintarNube(st.nube);
  pintarUpd(st.upd);
  // La receta, no la salida: con brillo o de noche la salida nunca coincide
  // con ningun preset aunque la receta sea exactamente uno.
  checkPresetMatch(Array.isArray(st.schedule.day)?st.schedule.day.map(v=>+v):st.channels.map(c=>+c.pct));
  // Al final: el resumen lee cosas que este mismo paso acaba de calcular
  // (el proximo evento, entre otras).
  pintarResumen(st);
}
const m2t=m=>String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
const t2m=t=>{const[a,b]=t.split(":");return(+a)*60+(+b);};
// El temporizador se guarda y se cancela: sin eso, un aviso nuevo heredaba el
// temporizador del anterior y podía desaparecer casi al instante (UX-029).
let toastTmr=null;
function toast(msg){
  const t=$("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(toastTmr);
  toastTmr=setTimeout(()=>t.classList.remove("show"),1800);
}
// La configuración del fotoperíodo queda SIEMPRE visible y editable, incluso
// con el horario apagado. Antes se ocultaba, así que para preparar un horario
// había que ACTIVARLO primero — es decir, poner en marcha el fotoperíodo con
// valores viejos antes de poder cargar los buenos (UX-003). En un cultivo eso
// puede encender o apagar la luz en un momento equivocado. Ahora se prepara
// todo con calma y recién después se activa.
function toggleSchCfg(en){
  $("sch-cfg").style.display="";
  const m=$("sch-off-msg");
  if(m) m.style.display=en?"none":"";
}


// ---------- comandos ----------
// Devuelve true solo si la orden SALIO de verdad hacia el equipo.
//
// Antes se descartaba en silencio cuando el WebSocket estaba cerrado, y la
// interfaz seguía adelante pintando el cambio y mostrando "guardado". El
// usuario podía creer que apagó un canal, aplicó una receta o programó el
// fotoperíodo cuando la luminaria nunca recibió nada (UX-001). Para una lámpara
// de cultivo eso es lo peor que puede hacer una interfaz: mentir sobre el
// estado físico.
//
// Los comandos NO se encolan a propósito. Reenviar más tarde una orden de
// iluminación es peligroso: cuando la conexión vuelva, la situación puede ser
// otra y esa orden vieja llegaría fuera de contexto. Mejor avisar y que la
// persona decida de nuevo.
// ── Estado por operación ──
//  Antes toda respuesta era un cartel de 1,8 s que decía "Guardado" o
//  "Enviado". Con dos acciones seguidas no había forma de saber a cuál
//  correspondía, y "enviado" se lee como "guardado" sin serlo. Ahora cada
//  escritura lleva un número, el equipo lo devuelve en su respuesta, y el
//  estado se muestra en un renglón fijo en vez de un cartel que se va.
let opSeq=0;
const opsPend=new Map();
// ── Glosario de estados (UX-260908-14) ──
//  "Enviado", "guardado" y "aplicado" se venian usando como sinonimos y
//  describen tres momentos distintos: salio del telefono, llego al equipo, y
//  esta gobernando la salida. Estas son las UNICAS palabras que la app usa
//  para un cambio, y siempre van con el objeto adelante ("Fotoperiodo: …").
const OPS_TXT={enviando:"Enviando…",
               esperando:"Esperando al equipo…",
               ok:"Aplicado en el equipo",
               error:"Rechazado por el equipo",
               sin:"Sin conexión — no se envió"};
function pintarOps(){
  const host=$("ops"); if(!host)return;
  const vivas=[...opsPend.values()];
  if(!vivas.length){host.style.display="none";host.textContent="";return;}
  host.style.display="";
  // Nodos, no innerHTML: `msg` puede venir del equipo o de la nube.
  host.textContent="";
  vivas.forEach(o=>{
    const d=document.createElement("div");
    d.style.color=o.estado==="ok"?"var(--acc)"
                 :(o.estado==="enviando"||o.estado==="esperando")?"var(--tx)":"#ff9d95";
    const n=document.createElement("b"); n.textContent=o.nombre+": ";
    d.appendChild(n);
    d.appendChild(document.createTextNode(o.msg||OPS_TXT[o.estado]));
    host.appendChild(d);
  });
}
// ── Cuánto se espera el acuse ──
//  En la red local la respuesta vuelve por el mismo WebSocket en décimas de
//  segundo. Por internet no: el equipo BUSCA sus órdenes cada 5 s y la app
//  espera hasta 25 s (ver web/nube.js). Con un único número de 8 s, una orden
//  remota perfectamente válida se mostraba como «El equipo no respondió»
//  cuando todavía le quedaban 17 s de espera legítima (UX-260908-03).
//  El transporte fija el suyo: nube-ui.js lo sube al conectarse.
let OP_TIMEOUT_MS=8000;
window.opTimeout=(ms)=>{ OP_TIMEOUT_MS=Math.max(2000,ms|0); };
// A la mitad del plazo el renglón deja de decir "Enviando…" y pasa a
// "Esperando al equipo…". Es la diferencia entre una app trabada y una app
// que sabe que todavía es pronto para preocuparse.
function opNueva(cmd){
  const nombres={set_channel:"Canal",set_all:"Receta",set_dim:"Brillo global",
                 set_schedule:"Fotoperíodo",apply_program:"Programa",
                 save_program:"Guardar programa",delete_program:"Borrar programa",
                 set_time:"Hora",set_role:"Modo de control"};
  const id=++opSeq;
  const o={id,cmd,nombre:nombres[cmd]||cmd,estado:"enviando",msg:""};
  o.espera=setTimeout(()=>{
    const v=opsPend.get(id);
    if(v&&v.estado==="enviando"){ v.estado="esperando"; pintarOps(); }
  },Math.max(1500,OP_TIMEOUT_MS*0.35));
  o.timer=setTimeout(()=>{
    const v=opsPend.get(id);
    if(v&&(v.estado==="enviando"||v.estado==="esperando"))
      opCerrar(id,"error","El equipo no respondió");
  },OP_TIMEOUT_MS);
  opsPend.set(id,o);
  pintarOps();
  return id;
}
function opCerrar(id,estado,msg){
  const o=opsPend.get(id); if(!o)return;
  if(o.timer){clearTimeout(o.timer);o.timer=0;}
  if(o.espera){clearTimeout(o.espera);o.espera=0;}
  o.estado=estado; o.msg=msg||"";
  pintarOps();
  // Se deja ver el resultado y despues se retira. Los errores duran mas:
  // son los que hay que alcanzar a leer.
  setTimeout(()=>{opsPend.delete(id);pintarOps();}, estado==="ok"?2500:7000);
}
const CMD_ESCRIBE=new Set(["set_channel","set_all","set_dim","set_schedule",
                           "apply_program","save_program","delete_program",
                           "set_time","set_role","update_factory",
                           "check_update","do_update"]);

function send(o){
  // Las escrituras llevan numero; las lecturas no lo necesitan.
  if(CMD_ESCRIBE.has(o.cmd)&&!o.op) o.op=opNueva(o.cmd);
  if(demo){ if(o.op)opCerrar(o.op,"ok","Simulador"); demoHandle(o); return true; }
  if(authToken&&!o.token)o.token=authToken;
  if(ws&&ws.readyState===1){
    // Recordar la última orden de ESCRITURA por si el equipo pide
    // emparejamiento: se reenvía sola al aceptar el código (UX-002).
    if(o.cmd!=="auth"&&o.cmd!=="get_state"&&o.cmd!=="get_programs") lastWrite=o;
    ws.send(JSON.stringify(o));
    return true;
  }
  if(o.op) opCerrar(o.op,"sin");
  toast("Sin conexión con el equipo — la orden NO se envió");
  // Repintar con el último estado real conocido: si la UI ya se había
  // adelantado de forma optimista, esto la devuelve a la verdad.
  if(state) applyState(state);
  return false;
}
// El canal 5 es UVA. La confirmación cubría sólo los presets, así que subirlo
// A MANO con el slider llegaba al 100 % sin ningún aviso — el mismo accidente
// que la confirmación evita. Se pide una sola vez por sesión de arrastre: se
// recuerda que ya se confirmó mientras el valor siga por encima del umbral,
// para no interrumpir en cada paso del slider.
let uvaOk=false;
function uvaGate(i,v){
  if(i!==4) return true;
  if(v<=UVA_CONFIRM_PCT){ uvaOk=false; return true; }   // volvió a zona segura
  if(uvaOk) return true;
  uvaOk=confirm("Vas a encender el canal "+CH_NOMBRE[4]+" al "+Math.round(v)+" %.\n\n"
    +"Usá protección ocular. No mires la luminaria de cerca ni permanezcas "
    +"bajo ella mientras el UVA esté encendido.\n\n¿Continuar?");
  return uvaOk;
}
function sendChannel(i,fields){ // debounce por canal para no inundar el WS
  if(fields.pct!=null&&!uvaGate(i,fields.pct)){
    // Rechazado: devolver el control al último estado real del equipo.
    if(state) applyState(state);
    return;
  }
  clearTimeout(sendTimer[i]);
  sendTimer[i]=setTimeout(()=>send(Object.assign({cmd:"set_channel",id:i},fields)),120);
}
// Far-red y UVA van CON VALOR en las recetas (decisión del usuario 2026-08-10).
// El far-red no es un riesgo fotobiológico y es una capacidad central de la
// luminaria; el UVA sí lo es, y por eso se protege con la confirmación de más
// abajo, no apagando el canal. Este catálogo debe quedar igual al de la
// pantalla (src/DisplayUi.cpp) — están duplicados, ver MEJ-018.
const FACTORY_PRESETS=[
  {n:"Germinación",  p:[20, 60, 40,  0,  0]},
  // Ningún canal entre 1 y 9 %: es la banda muerta del driver (10 % mínimo,
  // ver CH_MIN_ON_PCT en config.h). Los 5 % de far red / UVA pasaron a 0 el
  // 2026-09-20. Misma tabla que FACTORY_PRESETS en src/DisplayUi.cpp.
  {n:"Clonación",    p:[30, 70, 30,  0,  0]},
  {n:"Vegetativo",   p:[60,100, 60,  0,  0]},
  {n:"Pre-Flora",    p:[70, 70, 80, 15, 10]},
  {n:"Floración",    p:[90, 40,100, 30, 15]},
  {n:"Maduración",   p:[100,20,100, 50,  0]},
  {n:"Día Solar",    p:[70, 80, 70, 10, 10]},
  {n:"Nublado",      p:[40, 90, 30,  0, 20]},
  {n:"Luz Suave",    p:[30, 30, 20,  0,  0]},
  // "UV Activo" retirado del catálogo (MEJ-013): no es una receta de cultivo
  // sino una prueba técnica, y estaba a un toque de los presets diarios.
  // "Full" se mantiene y sigue pidiendo confirmación por su UVA al 100 %.
  {n:"Full",         p:[100,100,100,100,100]},
  // "Apagado" salio de esta grilla (UX-260908-06). Tenia la misma forma, el
  // mismo tamaño y el mismo lugar que una receta de cultivo, y un roce
  // apagaba los cinco canales sin preguntar nada. Ahora vive en la zona de
  // accion destructiva de "Acciones rapidas", con confirmacion y con vuelta.
];
let activePreset=-1;
// El canal 5 es UVA (365+395 nm), no UVB, pero a potencia alta sigue siendo un
// riesgo fotobiológico para quien esté en la sala: la exposición se acumula y
// no se siente en el momento. Hasta ahora un solo toque en "UV Activo" o
// "Full" lo ponía al 100 % sin ninguna confirmación, y son botones que están
// al lado de los presets de uso diario. No se quita la capacidad — se quita el
// accidente. (Ver MEJ-013 en MEJORAS-PROPUESTAS-CODEX.md.)
const UVA_CONFIRM_PCT=50;
function applyPresetValues(name,p){
  const values=Array.from({length:NCH},(_,i)=>Math.max(0,Math.min(100,Number(p&&p[i])||0)));
  if(values[4]>UVA_CONFIRM_PCT &&
     !confirm("La receta \""+name+"\" enciende el canal "+CH_NOMBRE[4]+" al "+values[4]+" %.\n\n"
             +"No mires la luminaria de cerca ni permanezcas bajo ella mientras el UVA "
             +"esté encendido. ¿Aplicarla igual?")) return false;
  // Solo pintar y confirmar si la orden SALIO. Si no, send() ya avisó y
  // repintó con el último estado real (UX-001).
  if(!send({cmd:"set_all",pct:values})) return false;
  values.forEach((v,i)=>paintCh(i,v,v>0.5));
  // El acuse real lo da el renglón de operaciones ("Receta: Aplicado en el
  // equipo"). Este cartel decía «X enviado», que se lee como «ya está» cuando
  // lo único cierto es que salió del teléfono (UX-260908-14).
  toast(name+" — enviando al equipo");
  return true;
}
function preset(idx){
  const pr=FACTORY_PRESETS[idx];
  if(!applyPresetValues(pr.n,pr.p))return;
  activePreset=idx;paintPresetBtns();
}
function paintPresetBtns(){
  const pg=$("presets-grid");if(!pg)return;
  [...pg.children].forEach((b,i)=>b.classList.toggle("sel",i===activePreset));
}
{
  const pg=$("presets-grid");
  FACTORY_PRESETS.forEach((pr,i)=>{
    const b=document.createElement("button");
    b.className="btn";
    b.textContent=pr.n;b.onclick=()=>preset(i);
    pg.appendChild(b);
  });
}

// ------------------------------------------------------------
//  Apagar todo — accion destructiva, con vuelta (UX-260908-06)
// ------------------------------------------------------------
//  Apagar la luminaria en medio de un fotoperiodo no es un cambio de receta:
//  puede interrumpir un ciclo. Por eso pide confirmacion, dice exactamente
//  que va a hacer, y —lo que faltaba— GUARDA la receta que estaba rigiendo
//  para poder volver sin reconstruirla canal por canal.
//
//  La copia se guarda en el telefono, no en el equipo: si la persona apaga y
//  cierra la app, al volver el boton de restaurar sigue estando.
function recetaActual(){
  if(state&&Array.isArray(state.channels)&&state.channels.length===NCH)
    return state.channels.map(c=>Math.round(Number(c.pct)||0));
  return Array.from({length:NCH},(_,i)=>Math.round(Number($("sl"+i)&&$("sl"+i).value)||0));
}
function pintarRestaurar(){
  const b=$("restaurar-receta"); if(!b)return;
  const g=almacen.leer("gl_receta_previa");
  b.style.display=g?"":"none";
}
$("apagar-todo").onclick=()=>{
  const previa=recetaActual();
  const encendidos=previa.filter(v=>v>0.5).length;
  if(!confirm("Apagar los cinco canales ahora.\n\n"
      +(encendidos?"Hay "+encendidos+" canal"+(encendidos>1?"es":"")+" encendido"
        +(encendidos>1?"s":"")+". ":"")
      +"Si hay un fotoperíodo activo, esto interrumpe la fase de luz en curso.\n\n"
      +"La receta actual se guarda y podés volver a ella con un toque.")) return;
  if(!send({cmd:"set_all",pct:[0,0,0,0,0]})) return;
  // Sólo se guarda si la orden salió: si no salió, la receta "anterior" sigue
  // siendo la que rige y ofrecer restaurarla seria mentir sobre lo que paso.
  if(previa.some(v=>v>0.5)) almacen.guardar("gl_receta_previa",JSON.stringify(previa));
  pintarRestaurar();
  for(let i=0;i<NCH;i++) paintCh(i,0,false);
  activePreset=-1; paintPresetBtns();
};
$("restaurar-receta").onclick=()=>{
  let p=null;
  try{ p=JSON.parse(almacen.leer("gl_receta_previa")||"null"); }catch(_){ }
  if(!Array.isArray(p)||p.length!==NCH){ almacen.borrar("gl_receta_previa"); pintarRestaurar(); return; }
  if(!applyPresetValues("La receta anterior",p)) return;
  almacen.borrar("gl_receta_previa");
  pintarRestaurar();
};
pintarRestaurar();
$("sch-en").onclick=()=>{const en=!$("sch-en").classList.contains("on");pintarSw($("sch-en"),en);toggleSchCfg(en);paintCycMode();markSchDirty();};
// Los interruptores marcan BORRADOR. Antes llamaban a saveSchedule(), que lee
// el formulario COMPLETO: tocar "amanecer/atardecer" podia guardar de paso una
// hora, una duracion o un ancla que el usuario habia tipeado y todavia no
// habia decidido aplicar. Un control que guarda mas de lo que anuncia.
$("sch-fr").onclick=()=>{pintarSw($("sch-fr"),!$("sch-fr").classList.contains("on"));markSchDirty();};
$("onramp-en").onclick=()=>{
  const on=!$("onramp-en").classList.contains("on");
  pintarSw($("onramp-en"),on);
  $("onramp-body").style.display=on?"":"none";
  markSchDirty();
};
$("sch-save").onclick=()=>{saveSchedule($("sch-en").classList.contains("on"));};
// Descartar el borrador: vuelve a lo que el equipo tiene guardado. Sin esto,
// el unico camino para deshacer era recargar la pagina.
$("sch-cancel").onclick=()=>{
  if(!schDirty){toast("No hay cambios sin aplicar");return;}
  clearSchDirty();
  if(state) applyState(state);
  toast("Cambios descartados");
};

// ---------- borrador sin guardar ----------
// Se marca al primer cambio del usuario y se limpia cuando el equipo confirma
// el set_schedule. Mientras esté marcado, applyState() no pisa los campos.
let schDirty=false;
function markSchDirty(){
  if(schDirty)return;
  schDirty=true;
  $("sch-save").textContent="Guardar cambios";
  $("sch-save").classList.add("dirty");
  const c=$("sch-cancel"); if(c) c.style.display="";
}
function clearSchDirty(){
  schDirty=false;cycDraftDirty=false;
  $("sch-save").textContent="Guardar";
  $("sch-save").classList.remove("dirty");
  const c=$("sch-cancel"); if(c) c.style.display="none";
}
["sch-on","sch-off","sch-ramp","cyc-light","cyc-dark","cyc-anchor","onramp-min"]
  .forEach(id=>{const el=$(id);if(el)el.addEventListener("input",markSchDirty);});
["sch-on","sch-off","sch-ramp","cyc-light","cyc-dark"].forEach(id=>{const el=$(id);if(el)el.addEventListener("keydown",e=>{if(e.key==="Enter")$("sch-save").click();});});

// ---------- modo de ciclo ----------
// 0 = Horario 24 h (clásico, anclado al reloj) · 1 = Superciclo (día ≠ 24 h)
let cycMode=0,cycDraftDirty=false;
function paintCycMode(){
  // Con el fotoperíodo apagado ningún modo se pinta como elegido: a simple
  // vista se ve que no rige nada. Al encenderlo se marca el que quedó
  // guardado (2026-09-20, mismo criterio que la pantalla).
  const schOn=$("sch-en").classList.contains("on");
  $("cyc-daily").classList.toggle("sel",schOn&&cycMode===0);
  $("cyc-free").classList.toggle("sel",schOn&&cycMode===1);
  $("cfg-daily").style.display=cycMode===0?"":"none";
  $("cfg-free").style.display=cycMode===1?"":"none";
  // La línea de tiempo de 24 h no tiene sentido en superciclo: el ciclo no
  // encaja en un día, así que mostrarla ahí sería mentir.
  const tl=$("sch-tl-bg"); if(tl) tl.parentElement.style.display=cycMode===0?"":"none";
  // Las dos explicaciones a la vez, con la vigente destacada. Sólo mostrar la
  // del modo elegido obliga a tocar el otro botón —o sea, a cambiar el modo—
  // para enterarse de qué hace (UX-260908-02).
  const info=$("cyc-info"); info.textContent="";
  [["Día 24hs","enciende y apaga a las mismas horas todos los días.",0],
   ["Superciclo","las horas de luz y de oscuridad no se atan al reloj; cada ciclo arranca cuando termina el anterior.",1]]
  .forEach(([nombre,txt,modo])=>{
    const d=document.createElement("div");
    d.style.color=modo===cycMode?"var(--tx)":"var(--dim)";
    const b=document.createElement("b");
    b.textContent=(modo===cycMode?"▸ ":"　")+nombre+" — ";
    d.appendChild(b); d.appendChild(document.createTextNode(txt));
    info.appendChild(d);
  });
  const pe=$("pe-h"),pl=$("pe-h-label");
  if(pe&&pl){
    if(cycMode===1){
      pl.textContent="Desde el encendido (h)";
      // Vaciar ANTES de cambiar el tipo: el navegador valida el valor viejo
      // contra el tipo nuevo en el instante de la asignacion, y "08:00" en un
      // campo numerico deja un aviso en consola cada vez que se cambia de modo.
      if(pe.type!=="number"){pe.value="";pe.type="number";pe.value="0";}
      pe.min="0";pe.step="0.5";
      pe.max=String(Math.max(0.01,(+$("cyc-light").value||13)-0.01));
    }else{
      pl.textContent="Hora del paso";
      if(pe.type!=="time"){pe.value="";pe.type="time";pe.value="08:00";}
      pe.removeAttribute("min");pe.removeAttribute("max");pe.removeAttribute("step");
    }
  }
}
function chooseCycleMode(mode){
  if(cycMode===mode)return;
  cycMode=mode;cycDraftDirty=true;markSchDirty();
  if(dynMode===3){
    dynMode=0;activeProg="";
    pintarSw($("dyn-en"),false);
    $("dyn-body").style.display="none";
    toast("Programa desactivado: revisalo para el nuevo modo");
  }
  // Si nunca se eligió un arranque, proponer "ahora": es el caso más común
  // (empezar el ciclo ya) y evita mandar un anchor vacío.
  if(mode===1&&!$("cyc-anchor").value){
    const tz=state&&Number.isFinite(+state.tz)?+state.tz:-180;
    const d=new Date(Date.now()+tz*60000);
    $("cyc-anchor").value=d.toISOString().slice(0,16);
  }
  paintCycMode();
}
$("cyc-daily").onclick=()=>chooseCycleMode(0);
$("cyc-free").onclick=()=>chooseCycleMode(1);

function saveSchedule(en){
  // clamp() defensivo: los input[type=number] declaran min/max en el HTML,
  // pero eso es solo una sugerencia de UI — se puede tipear/pegar cualquier
  // valor (incluso vacio -> NaN) y el navegador lo deja salir igual.
  const clamp=(v,lo,hi,def)=>{v=+v;return Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):def;};
  // Far red del amanecer/atardecer: 5..15 min en pasos de 5 (config.h,
  // SUNSIM_*). El equipo recorta igual; acá se recorta antes para que el
  // formulario no prometa un 30 que va a volver como 15.
  const ramp=Math.round(clamp($("sch-ramp").value,5,15,10)/5)*5;
  // La rampa de encendido viaja en el mismo formulario aunque del lado del
  // equipo no viva dentro del horario (se guarda junto al brillo global).
  const onramp=$("onramp-en").classList.contains("on");
  const onrampmin=Math.round(clamp($("onramp-min").value,0,20,10));   // ON_RAMP_MAX_MIN
  const base={enabled:en,ramp,sunsim:$("sch-fr").classList.contains("on"),
              specmode:dynMode,stages:dynStages,cyclemode:cycMode,
              onramp,onrampmin};
  let sch;
  if(cycMode===1){
    if(en&&state&&!state.cal){
      // Antes esto sólo decía "sincronizá fecha y hora" y no había NINGÚN
      // botón para hacerlo: la app mandaba a hacer algo que ella misma no
      // ofrecía. Ahora lo sincroniza acá mismo y sólo pide repetir el guardado
      // (no se reintenta solo: la respuesta del equipo llega asincrónica y
      // reencadenarla a ciegas puede activar el ciclo con la fecha vieja).
      sendTime();
      toast("Sincronizando la fecha con este teléfono — tocá Guardar de nuevo");
      return;
    }
    // Duraciones en minutos; el firmware las valida contra 30 min .. 48 h.
    const lh=Math.round(clamp($("cyc-light").value,0.5,48,13)*2)/2;
    const dh=Math.round(clamp($("cyc-dark").value,0.5,48,14)*2)/2;
    // El anchor viaja como epoch de HORA DE PARED, igual que set_time: el
    // equipo guarda hora local, no UTC.
    let anchor=0;
    const av=$("cyc-anchor").value;
    if(av){const d=new Date(av); if(!isNaN(d.getTime())) anchor=Math.floor(d.getTime()/1000-d.getTimezoneOffset()*60);}
    if(!anchor){
      const tz=state&&Number.isFinite(+state.tz)?+state.tz:-180;
      anchor=Math.floor(Date.now()/1000+tz*60);
    }
    if(base.sunsim&&ramp>0&&ramp*2>=Math.round(dh*60)){
      toast("La ventana far red debe dejar oscuridad entre ambos pulsos");return;
    }
    sch=Object.assign({},base,{light:Math.round(lh*60),dark:Math.round(dh*60),anchor});
  }else{
    const on=t2m($("sch-on").value||"06:00");     // fallback si quedó vacío
    const off=t2m($("sch-off").value||"18:00");
    const light=(off-on+1440)%1440||1440,dark=1440-light;
    if(base.sunsim&&dark>0&&ramp>0&&ramp*2>=dark){
      toast("La ventana far red debe dejar oscuridad entre ambos pulsos");return;
    }
    sch=Object.assign({},base,{on,off});
  }
  // El "guardado" real lo confirma el equipo con command_result; acá sólo se
  // informa que salió. Si no salió, send() ya avisó (UX-001/UX-011).
  if(send({cmd:"set_schedule",schedule:sch})) toast("Enviando fotoperíodo…");
}

// ---------- espectro dinámico ----------
const NATURAL=[[35,25,25,0,0],[50,75,35,0,0],[60,100,45,0,0],[50,75,35,0,0],[35,25,25,0,0]];
const STAGE_NAMES=["🌅 Amanecer","☕ Mañana","☀️ Mediodía","🌤 Tarde","🌇 Atardecer"];
let dynMode=0,dynStages=NATURAL.map(e=>e.slice()),dynSel=2,uiTab=1;
// Último modo de espectro visto DEL EQUIPO. Sirve para distinguir "el equipo
// cambió de modo" (hay que mover la pestaña) de "llegó otro latido con el mismo
// modo" (no hay que tocar nada). -1 = todavía no llegó ningún estado.
let lastDynModeSeen=-1;
// ¿Los sliders están editando una etapa en vez de la receta fija? Sólo en modo
// Personalizado: en Día natural las etapas son fijas y sólo se miran.
function editandoEtapa(){ return dynMode===2 && uiTab===2; }

function paintChips(){
  const host=$("dyn-chips");host.innerHTML="";
  const editable=editandoEtapa();
  STAGE_NAMES.forEach((n,i)=>{
    const b=document.createElement("button");
    b.className="btn chip"+(i===dynSel?" sel":"");
    b.textContent=(editable?"✏️ ":"")+n;
    b.onclick=()=>{dynSel=i;paintChips();
      // Los sliders pasan a mostrar ESTA etapa. En día natural es sólo una
      // vista; en personalizado, lo que se mueva la edita.
      dynStages[i].forEach((v,c)=>paintCh(c,v,v>0.5));
      drawSpd();
      $("dyn-info").textContent=editable
        ?"Editando \""+STAGE_NAMES[i]+"\": mové los canales y tocá Guardar."
        :"Viendo \""+STAGE_NAMES[i]+"\" (programa fijo, no editable).";
    };
    host.appendChild(b);
  });
}
$("dyn-en").onclick=()=>{
  const en=!$("dyn-en").classList.contains("on");
  dynMode=en?(dynMode||1):0;
  if(en&&dynMode===1)dynStages=NATURAL.map(e=>e.slice());
  pintarSw($("dyn-en"),en);
  $("dyn-body").style.display=en?"":"none";
  markSchDirty();
};
// Las dos son PESTAÑAS. "Día natural" además aplica el modo en el momento;
// "Programas" sólo muestra la lista, y el modo se aplica al elegir uno.
// paintDynTab() repinta el resaltado ya mismo: esperar al próximo latido hacía
// que el botón recién tocado tardara segundos en encenderse.
function paintDynTab(){
  $("dyn-natural").classList.toggle("sel",uiTab===1);
  $("dyn-custom").classList.toggle("sel",uiTab===2);
  $("dyn-progs").classList.toggle("sel",uiTab===3);
  // Las etapas se muestran en las dos primeras pestañas: en día natural para
  // mirarlas, en personalizado para editarlas.
  $("dyn-chips").style.display=(uiTab===1||uiTab===2)?"flex":"none";
  $("prog-panel").style.display=uiTab===3?"block":"none";
}
$("dyn-natural").onclick=()=>{
  uiTab=1;dynMode=1;lastDynModeSeen=1;
  dynStages=NATURAL.map(e=>e.slice());
  paintDynTab();
  saveSchedule($("sch-en").classList.contains("on"));
};
// Espectro propio por tramos del día. El firmware ya lo soportaba (specMode 2,
// cinco etapas con su validación), pero hasta 2026-08-20 ninguna interfaz
// permitía crearlo: se podía elegir día natural (fijo) o un programa entero, y
// no había punto medio. Ver CL-046.
$("dyn-custom").onclick=()=>{
  uiTab=2;
  // Se arranca de lo que ya está sonando —el día natural, o la última mezcla
  // propia— y no de ceros: así el usuario retoca algo que funciona en vez de
  // armar un espectro desde la nada.
  if(dynMode!==2){
    if(!dynStages||!dynStages.length) dynStages=NATURAL.map(e=>e.slice());
    dynMode=2;
  }
  lastDynModeSeen=2;
  // cycDraftDirty, no sólo schDirty: el estado que llega cada 5 s reescribe
  // dynMode desde el equipo salvo que haya un borrador de modo sin guardar.
  // Sin esto, el modo volvía a "día natural" antes de que el usuario llegara a
  // tocar Guardar, y lo editado se mandaba con el specmode viejo.
  cycDraftDirty=true;
  paintDynTab();paintChips();
  dynStages[dynSel].forEach((v,c)=>paintCh(c,v,v>0.5));
  drawSpd();
  markSchDirty();
  $("dyn-info").textContent="Editando \""+STAGE_NAMES[dynSel]+"\": mové los canales y tocá Guardar.";
};
$("dyn-progs").onclick=()=>{
  uiTab=3;paintDynTab();
  send({cmd:"get_programs"});renderProgChips();
};

// ---------- programas por horario (biblioteca) ----------
// URL pública donde el FABRICANTE publica programas. Formato:
// {"version":1,"programas":[{"id":"veg18","n":"Vegetativo 18h","s":[{"h":360,"p":[60,100,45,0,0]},...]},...]}
// Catálogo remoto de programas. Vacío por defecto y a propósito: antes tenía un
// placeholder de GitHub que nunca se reemplazó, así que el botón fallaba contra
// un repo inexistente y no había forma de saber por qué. Si no hay ninguna
// configurada, el botón la pide y la recuerda; y para el caso normal está
// "Cargar archivo", que no depende de internet ni de que nadie publique nada.
const PROG_URL=almacen.leer("gl_prog_url")||"";
let progsLib={factory:[],custom:[]},activeProg="",peSteps=[],peId=null;
function progName(id){const p=progsLib.factory.concat(progsLib.custom).find(p=>p.id===id);return p?p.n:id}
function renderProgChips(){
  const host=$("prog-chips");host.innerHTML="";
  // APLICAR y EDITAR son dos acciones distintas, y ahora son dos botones.
  // Antes el mismo toque hacia las dos cosas: mirar un programa propio lo ponia
  // a gobernar la luminaria en el acto, y no habia forma de corregirle un paso
  // sin activarlo primero.
  const mk=(p,esCustom)=>{
    const grupo=document.createElement("span");
    grupo.style.display="inline-flex";
    grupo.style.alignItems="stretch";

    const b=document.createElement("button");
    b.className="btn chip"+(p.id===activeProg?" sel":"");
    b.textContent="📦 "+p.n;
    b.title="Aplicar "+p.n;
    if(esCustom){b.style.borderTopRightRadius="0";b.style.borderBottomRightRadius="0";}
    b.onclick=()=>{
      send({cmd:"apply_program",id:p.id});
      toast("Aplicando "+p.n+"…");
    };
    grupo.appendChild(b);

    if(esCustom){
      const e=document.createElement("button");
      e.className="btn chip";
      e.textContent="✏️";
      e.title="Editar "+p.n+" — no lo aplica";
      e.setAttribute("aria-label","Editar "+p.n);
      e.style.borderTopLeftRadius="0";
      e.style.borderBottomLeftRadius="0";
      e.style.borderLeft="0";
      e.onclick=()=>{
        peId=p.id;$("pe-name").value=p.n;
        peSteps=p.s.map(x=>({h:x.h,p:x.p.slice()}));
        setPeMix(peSteps.length?peSteps[0].p:[50,50,50,0,0]);
        renderPeSteps();$("pe-del").style.display="";
        $("prog-editor").style.display="block";
        toast("Editando "+p.n+" — todavía no se aplicó");
      };
      grupo.appendChild(e);
    }
    host.appendChild(grupo);
  };
  progsLib.factory.forEach(p=>mk(p,false));
  progsLib.custom.forEach(p=>mk(p,true));
  if(!progsLib.factory.length&&!progsLib.custom.length){
    const s=document.createElement("span");s.className="foot";s.textContent="Sin programas todavía — creá uno nuevo o actualizá.";host.appendChild(s);
  }
}
// ── Mezcla propia del editor ──
//  "＋ Paso con sliders" leia los sliders REALES de los canales, que son los
//  que gobiernan la lampara. Para escribir un programa de cinco pasos habia
//  que llevar la luminaria a cada mezcla, con el cultivo abajo, a la hora que
//  fuera. Y con un programa ya activo la app esconde esos sliders a proposito,
//  asi que ni siquiera se podian mover: el paso salia con valores invisibles.
//
//  Ahora el editor tiene su propia mezcla. Tocar la luminaria es una accion
//  aparte y explicita: "Previsualizar".
let peMix=[0,0,0,0,0];
function renderPeMix(){
  const host=$("pe-mix"); if(!host)return;
  host.innerHTML="";
  DEMO_STATE.channels.forEach((c,i)=>{
    const d=document.createElement("div");
    d.style.cssText="display:grid;grid-template-columns:58px 1fr 44px;gap:8px;align-items:center;padding:3px 0";
    const nm=document.createElement("label");
    nm.className="fl"; nm.style.margin="0"; nm.htmlFor="pe-sl"+i; nm.textContent=c.tag;
    const sl=document.createElement("input");
    sl.type="range"; sl.min=0; sl.max=100; sl.step=1; sl.value=peMix[i];
    sl.id="pe-sl"+i; sl.style.height="44px"; sl.style.accentColor="var("+COLORS[i]+")";
    sl.setAttribute("aria-label","Mezcla de "+c.name+" para este paso");
    const pc=document.createElement("div");
    pc.className="pct"; pc.textContent=peMix[i]+"%";
    sl.oninput=()=>{const v=bandaMuerta(+sl.value);sl.value=v;peMix[i]=v;pc.textContent=v+"%";};
    d.appendChild(nm);d.appendChild(sl);d.appendChild(pc);
    host.appendChild(d);
  });
}
function setPeMix(v){ peMix=v.slice(0,NCH).map(x=>Math.max(0,Math.min(100,Math.round(+x)||0)));
                      while(peMix.length<NCH)peMix.push(0); renderPeMix(); }

function renderPeSteps(){
  const host=$("pe-steps");host.innerHTML="";
  peSteps.sort((a,b)=>a.h-b.h).forEach((s,i)=>{
    const d=document.createElement("div");
    d.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--line);font-size:13px";
    const when=cycMode===1
      ? ("+"+Math.floor(s.h/60)+"h "+String(s.h%60).padStart(2,"0")+"min")
      : m2t(s.h);
    const info=document.createElement("button");
    info.className="btn chip"; info.style.flex="1"; info.style.textAlign="left";
    info.textContent="🕐 "+when+" → "+s.p.map(v=>Math.round(v)).join("/");
    info.title="Cargar esta mezcla en el editor";
    info.onclick=()=>{ setPeMix(s.p); $("pe-h").value=cycMode===1?String(s.h/60):m2t(s.h);
                       toast("Paso cargado en el editor"); };
    d.appendChild(info);
    const x=document.createElement("button");x.className="btn chip";x.textContent="✕";
    x.onclick=()=>{peSteps.splice(i,1);renderPeSteps()};
    d.appendChild(x);host.appendChild(d);
  });
}
$("prog-new").onclick=()=>{peId=null;peSteps=[];$("pe-name").value="";$("pe-del").style.display="none";
  setPeMix([50,50,50,0,0]);paintCycMode();renderPeSteps();$("prog-editor").style.display="block";};
$("pe-cancel").onclick=()=>$("prog-editor").style.display="none";
// Ver la mezcla en la luminaria es una acción aparte, pedida a propósito.
//
// Con el fotoperíodo ACTIVO no se puede previsualizar y hay que decirlo: la
// salida la decide el horario, así que mandar la mezcla no cambiaría la luz
// —sólo pisaría la receta fija del usuario en silencio—. Un botón que hace
// algo distinto de lo que promete es peor que un botón que se niega.
$("pe-preview").onclick=()=>{
  if(state&&state.schedule&&state.schedule.enabled){
    toast("Con el fotoperíodo activo la salida la decide el horario — no se puede previsualizar");
    return;
  }
  if(send({cmd:"set_all",pct:peMix.slice()}))
    toast("Mezcla aplicada a la luminaria — reemplaza la receta actual");
};
$("pe-add").onclick=()=>{
  const p=peMix.slice();   // la mezcla DEL EDITOR, no los sliders de la lampara
  let minute;
  if(cycMode===1){
    const hours=+$("pe-h").value;
    const limit=Math.round((+$("cyc-light").value||13)*60);
    minute=Math.round(hours*60);
    if(!Number.isFinite(hours)||minute<0||minute>=limit){
      toast("El paso debe estar dentro de las horas de luz");return;
    }
  }else minute=t2m($("pe-h").value||"08:00");
  const old=peSteps.findIndex(s=>s.h===minute);
  if(old>=0)peSteps[old]={h:minute,p};else peSteps.push({h:minute,p});
  renderPeSteps();
};
$("pe-save").onclick=()=>{
  const n=$("pe-name").value.trim();
  if(!n){toast("Poné un nombre al programa");return;}
  if(!peSteps.length){toast("Agregá al menos un paso");return;}
  if(peSteps.length>10){toast("Máximo 10 pasos por programa");return;}
  if(cycMode===1){
    const limit=Math.round((+$("cyc-light").value||13)*60);
    if(!peSteps.some(s=>s.h===0)){toast("El Superciclo necesita un paso en +0 h");return;}
    if(peSteps.some(s=>s.h<0||s.h>=limit)){
      toast("Hay pasos fuera de la fase de luz");return;
    }
  }
  if(!peId&&progsLib.custom.length>=8){toast("Máximo 8 programas propios — borrá alguno");return;}
  const id=peId||("u-"+n.toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,14)+"-"+Date.now().toString(36).slice(-4));
  send({cmd:"save_program",prog:{id,n,s:peSteps}});
  if(!demo)setTimeout(()=>send({cmd:"get_programs"}),250);
  $("prog-editor").style.display="none";
  toast("Programa \""+n+"\" guardado");
};
$("pe-del").onclick=()=>{
  if(!peId)return;
  send({cmd:"delete_program",id:peId});
  if(!demo)setTimeout(()=>send({cmd:"get_programs"}),250);
  $("prog-editor").style.display="none";
  // El acuse lo da el equipo: dice si el programa borrado era el que estaba
  // rigiendo (sigue hasta que se cambie de modo). Un toast optimista aca lo
  // pisaba con un "borrado" a secas. En demo no hay equipo: se dice igual.
  if(demo) toast("Programa borrado");
};
// Acepta las dos formas: {"programas":[...]} o un array pelado. Un archivo
// escrito a mano suele venir como array, y rechazarlo por eso sería quisquilloso
// sin ningún motivo.
function progsDe(j){
  const a=Array.isArray(j)?j:(j&&Array.isArray(j.programas)?j.programas:null);
  if(!a)throw new Error('formato inválido: falta la lista "programas"');
  if(!a.length)throw new Error("el archivo no tiene ningún programa");
  return a;
}
// Manda la biblioteca al equipo. NO canta victoria: el equipo valida cada
// programa y contesta con command_result, y ESE es el mensaje que vale. Antes
// el toast de éxito salía junto con el envío, así que si el firmware rechazaba
// el catálogo la app igual afirmaba que había salido bien (CL-042).
function enviarProgramas(progs,origen){
  send({cmd:"update_factory",progs});
  if(demo){
    toast(progs.length+" programas cargados ("+origen+")");
    return;
  }
  toast("Enviando "+progs.length+" programas al equipo…");
  setTimeout(()=>send({cmd:"get_programs"}),400);
}

$("prog-import").onclick=()=>{ $("prog-file").value=""; $("prog-file").click(); };
$("prog-file").onchange=async e=>{
  const f=e.target.files&&e.target.files[0];
  if(!f)return;
  try{
    const progs=progsDe(JSON.parse(await f.text()));
    enviarProgramas(progs,f.name);
  }catch(err){toast("No se pudo leer el archivo: "+err.message);}
};

$("prog-update").onclick=async()=>{
  // Sin catálogo configurado no hay a dónde ir a buscar. En vez de fallar
  // contra una URL inexistente, se pide una y se recuerda.
  let url=PROG_URL;
  if(!url){
    url=(prompt("Dirección del catálogo de programas (.json):","")||"").trim();
    if(!url)return;
    almacen.guardar("gl_prog_url",url);
  }
  toast("Buscando programas nuevos…");
  try{
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    enviarProgramas(progsDe(await r.json()),"internet");
  }catch(e){toast("No se pudo actualizar: "+e.message);}
};
$("wf-save").onclick=()=>{
  const ssid=$("wf-ssid").value.trim();
  if(!ssid){wfEstado("Escribí el nombre de la red.","err");toast("Ingresá el nombre de la red");return;}
  if(send({cmd:"provision_wifi",ssid,pass:$("wf-pass").value})){
    // El mismo renglón persistente que el escaneo: el equipo se REINICIA acá,
    // así que el WebSocket se corta y no va a llegar ninguna respuesta. Sin
    // este texto, la app se quedaba muda justo en el momento más confuso.
    wfEstado("Enviado a «"+ssid+"». El equipo se reinicia para conectarse; "
            +"volvé a abrir la app desde esa red. Si no aparece en un minuto, "
            +"la clave puede estar mal: conectate a la red propia del equipo y probá de nuevo.");
    toast("Enviado — el equipo se reinicia si lo aceptó…");
  }
};
// Sólo encender y apagar: la URL, la clave del proyecto y la clave propia del
// equipo las maneja el firmware (compiladas las dos primeras, generada la
// tercera). Pedirlas acá era una forma de equivocarse.
$("nu-activar").onclick=()=>send({cmd:"set_nube",on:true});
$("nu-apagar").onclick=()=>send({cmd:"set_nube",on:false});
$("upd-buscar").onclick=()=>{
  if(demo){toast("Primero conectate al equipo");return;}
  if(send({cmd:"check_update"})){ $("upd-buscar").disabled=true; $("upd-estado").textContent="Buscando…"; }
};
$("upd-hacer").onclick=()=>{
  if(demo){toast("Primero conectate al equipo");return;}
  const v=(state&&state.upd&&state.upd.disp)||"la versión nueva";
  if(!confirm("Actualizar el equipo a "+v+".\n\nSe descarga, se verifica y el equipo se reinicia solo al terminar: "
      +"la luz se corta unos 10 segundos durante el reinicio. La configuración se conserva.\n\n¿Actualizar ahora?")) return;
  send({cmd:"do_update"});
};
$("wf-forget").onclick=()=>{
  if(demo){toast("Primero conectate al equipo");return;}
  const red=$("wf-forget").dataset.ssid||"la red guardada";
  if(!confirm("Se borra \""+red+"\".\n\n"
             +"El equipo queda en su red propia y la luminaria sigue funcionando igual.\n"
             +"Para volver a controlarlo desde el celular vas a tener que conectarte a esa red "
             +"o cargarle una nueva."))return;
  send({cmd:"forget_wifi"});
};
// ── Estado del escaneo, escrito y persistente (UX-260908-11) ──
//  El resultado se daba con un toast, que dura tres segundos. Si el teléfono
//  se bloquea o la persona cambia de app —que es exactamente lo que uno hace
//  mientras espera un escaneo de 20 s— al volver no queda nada: ni si sigue
//  buscando, ni si no encontró redes, ni si falló. Este renglón se queda.
let wfScanTimer=0;
function wfEstado(txt,clase){
  const el=$("wf-scan-estado"); if(!el)return;
  el.textContent=txt||"";
  el.style.display=txt?"":"none";
  el.style.color=clase==="err"?"#ff9d95":clase==="ok"?"var(--acc)":"var(--dim)";
}
$("wf-scan").onclick=()=>{
  if(demo){toast("Primero conectate a la red LUXHorticultura del equipo");return;}
  $("wf-scan").textContent="🔄 Buscando...";
  $("wf-scan").disabled=true;
  $("wf-scan").setAttribute("aria-busy","true");
  wfEstado("Buscando redes… puede tardar hasta 20 segundos.");
  send({cmd:"scan_wifi"});
  // 20 s, no 10: con el reintento medido de scanPump (ver CL-040) una respuesta
  // buena puede tardar ~17 s. Rehabilitar antes invita a tocar de nuevo y a
  // encadenar otro ciclo de barridos.
  clearTimeout(wfScanTimer);
  wfScanTimer=setTimeout(()=>{
    $("wf-scan").textContent="🔍 Buscar redes";$("wf-scan").disabled=false;
    $("wf-scan").removeAttribute("aria-busy");
    // Sólo si nadie contestó: showNetworks limpia el temporizador.
    wfEstado("El equipo no contestó al escaneo. Probá de nuevo.","err");
  },20000);
};
// ok=false significa "no pude buscar", distinto de "no hay redes cerca". Antes
// el equipo no mandaba nada cuando el escaneo fallaba y el botón se quedaba en
// "Buscando..." para siempre, sin decir por qué.
function showNetworks(nets,ok){
  clearTimeout(wfScanTimer);
  $("wf-scan").textContent="🔍 Buscar redes";$("wf-scan").disabled=false;
  $("wf-scan").removeAttribute("aria-busy");
  const host=$("wf-nets");host.innerHTML="";
  if(ok===false){host.style.display="none";
    wfEstado("No se pudo escanear. Probá de nuevo en unos segundos.","err");
    toast("No se pudo buscar redes ahora — probá de nuevo en unos segundos");return;}
  if(!nets||!nets.length){host.style.display="none";
    wfEstado("No se encontraron redes cerca del equipo.","err");
    toast("No se encontraron redes");return;}
  wfEstado(nets.length+(nets.length===1?" red encontrada":" redes encontradas")
           +" — tocá una para completar el nombre.","ok");
  host.style.display="block";
  [...nets].sort((a,b)=>b.rssi-a.rssi).forEach(n=>{
    const d=document.createElement("div");
    d.style.cssText="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-size:14px";
    const sig=n.rssi>-60?"●●●":n.rssi>-75?"●●○":"●○○";
    // El SSID es texto NO confiable (lo emite cualquier router vecino) — nunca
    // insertarlo crudo via innerHTML, un SSID tipo "<img src=x onerror=...>"
    // ejecutaria JS en el navegador de quien esta configurando el WiFi.
    const nameSpan=document.createElement("span");
    nameSpan.textContent=n.ssid||"(oculta)";
    const sigSpan=document.createElement("span");
    sigSpan.style.cssText="color:var(--dim);font-size:12px";
    sigSpan.textContent=`${sig} ${n.rssi}dBm${n.open?" 🔓":""}`;
    d.appendChild(nameSpan); d.appendChild(sigSpan);
    d.onclick=()=>{$("wf-ssid").value=n.ssid||"";host.style.display="none";$("wf-pass").focus();};
    host.appendChild(d);
  });
}
$("dim-sl").addEventListener("input",()=>{
  const v=+$("dim-sl").value;
  $("dim-pc").textContent=v+"%";
  clearTimeout(sendTimer.dim);
  sendTimer.dim=setTimeout(()=>send({cmd:"set_dim",pct:v}),150);
});

// ---------- demo backend (sin equipo) ----------
// AUTOGENERADO por tools/generar_programas.py — NO editar a mano.
// Son los mismos seis que trae el equipo de fabrica; el script escribe
// este bloque y include/programas_fabrica.h a la vez.
// AUTOGENERADO por tools/generar_programas.py — NO editar a mano.
// Son los mismos seis que trae el equipo de fabrica; el script escribe
// este bloque y include/programas_fabrica.h a la vez.
let DEMO_FACTORY=[
 {id:"clones",n:"Clones y plántulas",s:[{h:360,p:[25,40,30,10,0]},{h:480,p:[30,50,33,11,10]},{h:720,p:[30,55,36,12,10]},{h:1200,p:[30,45,33,11,10]},{h:1380,p:[25,35,30,10,0]}]},
 {id:"veg18",n:"Vegetativo 18 h",s:[{h:360,p:[40,60,36,12,0]},{h:480,p:[55,85,51,17,12]},{h:720,p:[60,100,60,20,15]},{h:1080,p:[55,85,51,17,12]},{h:1320,p:[40,60,36,12,10]},{h:1410,p:[30,45,30,10,0]}]},
 {id:"vegsat",n:"Vegetativo sativa",s:[{h:360,p:[30,65,33,11,0]},{h:540,p:[40,95,42,14,15]},{h:720,p:[40,100,45,15,18]},{h:1080,p:[40,95,42,14,15]},{h:1380,p:[30,60,30,10,0]}]},
 {id:"flora12",n:"Floración 12 h",s:[{h:360,p:[55,45,60,20,0]},{h:450,p:[80,45,90,30,12]},{h:600,p:[90,40,99,33,18]},{h:840,p:[90,40,99,33,18]},{h:960,p:[80,40,90,30,12]},{h:1050,p:[60,40,60,20,0]}]},
 {id:"florasat",n:"Floración sativa",s:[{h:360,p:[50,55,54,18,0]},{h:480,p:[70,60,84,28,15]},{h:660,p:[80,55,93,31,20]},{h:900,p:[80,55,93,31,20]},{h:1050,p:[55,50,63,21,0]}]},
 {id:"madura",n:"Maduración",s:[{h:360,p:[60,30,69,23,0]},{h:480,p:[95,25,99,33,22]},{h:720,p:[100,20,99,33,28]},{h:960,p:[95,25,99,33,22]},{h:1050,p:[65,25,75,25,0]}]}
];
const demoCustom=()=>{try{return JSON.parse(almacen.leer("gl_cprogs")||"[]")}catch(e){return[]}};
function demoHandle(o){
  const st=state||DEMO_STATE;
  if(o.cmd==="set_channel"){const c=st.channels[o.id];if(o.pct!=null)c.pct=o.pct;if(o.on!=null)c.on=o.on;}
  if(o.cmd==="set_all")o.pct.forEach((v,i)=>{st.channels[i].pct=v;st.channels[i].on=v>0.5;});
  if(o.cmd==="set_schedule"){
    Object.assign(st.schedule,o.schedule);
    // La rampa de encendido viaja dentro de "schedule" pero el equipo la
    // publica en la raiz del estado: en demo hay que espejarla igual.
    if(o.schedule.onramp!=null)    st.onramp=o.schedule.onramp;
    if(o.schedule.onrampmin!=null) st.onrampmin=o.schedule.onrampmin;
    // En demo no hay command_result: sin esto el borrador quedaba marcado
    // para siempre y el equipo simulado nunca volvia a refrescar los campos.
    clearSchDirty();
  }
  if(o.cmd==="set_dim"){st.dim=o.pct;}
  // --- programas (demo: factory en memoria, custom persiste en localStorage) ---
  if(o.cmd==="get_programs"){progsLib={factory:DEMO_FACTORY,custom:demoCustom()};renderProgChips();return;}
  if(o.cmd==="apply_program"){st.schedule.specmode=3;st.schedule.progid=o.id;}
  if(o.cmd==="save_program"){const c=demoCustom().filter(p=>p.id!==o.prog.id);c.push(o.prog);almacen.guardar("gl_cprogs",JSON.stringify(c));progsLib.custom=c;renderProgChips();}
  if(o.cmd==="delete_program"){const c=demoCustom().filter(p=>p.id!==o.id);almacen.guardar("gl_cprogs",JSON.stringify(c));progsLib.custom=c;if(st.schedule.progid===o.id){st.schedule.progid="";st.schedule.specmode=1;}renderProgChips();}
  if(o.cmd==="update_factory"){DEMO_FACTORY=o.progs;progsLib.factory=o.progs;renderProgChips();}
  applyState(st);
}

// ---------- conexión ----------
function connect(){
  let tries=0, reconnTimer=null;
  function open(){
    if(reconnTimer){clearTimeout(reconnTimer);reconnTimer=null;}
    ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws");
    // set_time: manda epoch en HORA LOCAL (el RTC guarda hora local)
    ws.onopen=()=>{
      tries=0;
      // Si veniamos de modo demo (no se pudo conectar las primeras veces) y
      // ahora SI se pudo — salir de demo, el equipo ya esta disponible.
      if(demo){demo=false;document.body.classList.remove("demo-mode");}
      $("dot").classList.add("ok");
      // El estado inicial ya llega solo (el equipo lo empuja al conectar via
      // WS_EVT_CONNECT), no hace falta pedirlo con get_state.
      send({cmd:"get_programs"});
      // Vinimos del QR: emparejar ya, antes de que el usuario toque nada. Si
      // ya habia permiso guardado no hace falta, y el codigo se descarta.
      if(codigoDeQr){ if(!authToken) send({cmd:"auth",code:codigoDeQr}); codigoDeQr=""; }
      // Una conexión NO cambia por sí sola la fase del fotoperíodo: con la
      // fecha ya conocida, poner en hora sigue siendo una acción explícita del
      // usuario (botón del aviso de salud). La única excepción es el equipo que
      // no sabe la hora o no sabe la fecha — ahí no hay fase que respetar y
      // applyState() sincroniza solo. Se rearma por conexión.
      autoTimeSynced=false;
    };
    ws.onmessage=e=>{
      try{
        const d=JSON.parse(e.data);
        if(d.evt==="state")applyState(d);
        if(d.evt==="command_result"){
          if(d.cmd==="set_schedule"&&d.ok)clearSchDirty();
          // El resultado se ancla a la operación que lo pidió. Si el equipo no
          // devolvió el número (firmware viejo), se cae al cartel de antes.
          if(d.op) opCerrar(d.op, d.ok?"ok":"error", d.message||"");
          else toast(d.message||(d.ok?"Guardado":"No se pudo guardar"));
        }
        if(d.evt==="programs"){progsLib={factory:d.factory||[],custom:d.custom||[]};activeProg=d.active||"";renderProgChips();}
        if(d.evt==="auth"){
          if(d.ok){
            authToken=d.token; almacen.guardar("gl_token",authToken);
            // Reenviar lo que el usuario había pedido antes de que el equipo
            // le exigiera emparejarse, para que no tenga que repetirlo.
            if(pendingCmd){
              const c=pendingCmd; pendingCmd=null;
              c.token=authToken; send(c);
              toast("Equipo emparejado — orden reenviada");
            } else toast("Equipo emparejado");
          } else { pedirCodigo(d.msg||"Código incorrecto."); }
        }
        if(d.evt==="auth_required"){
          // El token guardado ya no sirve (se regeneró el código en el equipo)
          // o nunca hubo emparejamiento. Se pide de nuevo, una sola vez por
          // aviso para no encadenar prompts si hay comandos en vuelo.
          authToken=""; almacen.borrar("gl_token");
          // Guardar la orden rechazada para reenviarla tras emparejar.
          if(lastWrite){ pendingCmd=lastWrite; lastWrite=null; delete pendingCmd.token; }
          if(!window.__authPrompt){
            window.__authPrompt=true;
            setTimeout(()=>{window.__authPrompt=false;pedirCodigo(d.msg);},50);
          }
        }
        if(d.evt==="wifi_saved")toast("WiFi guardado");
        if(d.evt==="wifi_networks")showNetworks(d.networks||[],d.ok!==false);
      }catch(_){}
    };
    ws.onclose=(ev)=>{
      $("dot").classList.remove("ok");
      tries++;
      // Código 1013 (CL-048): el equipo desalojó ESTA sesión a propósito
      // porque ya tenía demasiadas abiertas a la vez — no es un corte de red
      // ni una falla. Sin distinguirlo, la única pista era "se desconectó",
      // que se lee como que el equipo falló. El motivo viaja en el propio
      // frame de cierre (event.reason), lo pone WebPortal.cpp del lado del
      // firmware.
      if(ev&&ev.code===1013){
        toast("Demasiadas sesiones abiertas a la vez — se cerró esta para hacer lugar. Reconectando…");
      }
      // A los 4 intentos fallidos sin haber recibido nunca un estado real,
      // avisar con el modo demo — pero sin dejar de reintentar en el fondo
      // (antes acá se cortaba el loop de reconexion para siempre: si el
      // equipo tardaba en terminar de arrancar, la app quedaba en "modo
      // demo" permanente aunque el equipo estuviera perfectamente
      // disponible unos segundos despues, sin mas opcion que recargar
      // a mano). ws.onopen ya saca de demo solo si esto revive.
      if(tries>3&&!state) enterDemo();
      const delay=Math.min(1500*tries,12000);  // 1.5 → 3 → 4.5 → max 12 s
      if(!demo) $("status").textContent="Reconectando (intento "+tries+")…";
      reconnTimer=setTimeout(open,delay);
    };
    ws.onerror=()=>ws.close();
  }
  if(location.protocol==="file:"){enterDemo();return;}
  open();
}
function enterDemo(){
  demo=true;document.body.classList.add("demo-mode");$("dot").classList.add("ok");
  applyState(JSON.parse(JSON.stringify(DEMO_STATE)));
  $("status").textContent="⚠ Modo demo — abrí esta página desde el equipo (192.168.4.1 o luxhort-XXXX.local)";
}
// ---------- presets de usuario (localStorage) ----------
const MY_KEY='gl_my_presets';
function loadMyPresets(){try{return JSON.parse(almacen.leer(MY_KEY)||'[]');}catch{return[];}}
function saveMyPreset(n,p){
  const all=loadMyPresets().filter(x=>x.n!==n);all.push({n,p});
  // Si el navegador no deja escribir, decirlo: un boton que no hace nada y
  // no explica por que es peor que un error.
  if(!almacen.guardar(MY_KEY,JSON.stringify(all)))
    toast("Este navegador no deja guardar presets");
  renderMyPresets();
}
function delMyPreset(n){
  almacen.guardar(MY_KEY,JSON.stringify(loadMyPresets().filter(x=>x.n!==n)));renderMyPresets();
}
function renderMyPresets(){
  const all=loadMyPresets();
  const card=$("my-presets-card");const grid=$("my-presets-grid");
  if(!all.length){card.style.display='none';return;}
  card.style.display='';grid.innerHTML='';
  all.forEach(pr=>{
    const wrap=document.createElement('div');wrap.style.cssText='display:flex;gap:4px;align-items:stretch';
    const b=document.createElement('button');b.className='btn';b.textContent=pr.n;b.style.flex='1';
    b.onclick=()=>{if(applyPresetValues(pr.n,pr.p)){activePreset=-1;paintPresetBtns();}};
    const x=document.createElement('button');x.className='btn off chip';x.textContent='✕';x.style.cssText='flex:none;padding:9px 10px;font-size:12px';
    x.onclick=(e)=>{e.stopPropagation();delMyPreset(pr.n);if(state)checkPresetMatch(state.channels.map(c=>+c.pct));};
    wrap.appendChild(b);wrap.appendChild(x);grid.appendChild(wrap);
  });
}
function checkPresetMatch(pcts){
  const all=[...FACTORY_PRESETS.map(pr=>pr.p),...loadMyPresets().map(pr=>pr.p)];
  const match=all.some(p=>p.every((v,i)=>Math.abs(v-(pcts[i]||0))<2));
  $("save-preset-bar").style.display=match?'none':'';
}
$("save-preset-btn").onclick=()=>{
  const n=$("save-preset-name").value.trim();
  if(!n){toast("Poné un nombre al preset");return;}
  const p=[];for(let i=0;i<NCH;i++)p.push(+$("sl"+i).value);
  saveMyPreset(n,p);$("save-preset-name").value='';$("save-preset-bar").style.display='none';
  toast("\""+n+"\" guardado");
};
renderMyPresets();

buildChannels();
// pintar valores por defecto YA (evita ver todo en 0 mientras conecta);
// el estado real del equipo los pisa apenas llega por WebSocket
DEMO_STATE.channels.forEach(c=>paintCh(c.id,c.pct,c.on));
// El arranque local (connect) no corre acá: la capa de nube decide
// qué equipo mirar y de dónde traer su estado. Ver nube-ui.js.
scheduleSpd();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});