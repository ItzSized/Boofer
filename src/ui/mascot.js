const sparkle = (x, y, delay) => `
  <g transform="translate(${x} ${y})">
    <path class="spark" style="animation-delay:${delay}ms"
      d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z" />
  </g>`;

const BODY = `M20 62 C20 32 38 14 60 14 C82 14 100 32 100 62 V106
         q-6.67 10 -13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.35 0 Z`;

// Effects (settings → Look → Effect): each item sits at (x, y) and plays its CSS animation
// with its own delay, so the loop never looks in step.
const STAR = "M0 -4.5 L1.1 -1.1 L4.5 0 L1.1 1.1 L0 4.5 L-1.1 1.1 L-4.5 0 L-1.1 -1.1 Z";
const HEART = "M0 3.2 C-4.2 0.2 -5.2 -2.8 -2.7 -4 C-1.3 -4.6 0 -3.6 0 -2.6 C0 -3.6 1.3 -4.6 2.7 -4 C5.2 -2.8 4.2 0.2 0 3.2 Z";
const fx = (items, draw) =>
  items.map(([x, y, delay, extra = ""]) => `
    <g transform="translate(${x} ${y})"><g style="animation-delay:${delay}ms" ${extra}>${draw}</g></g>`).join("");

const effects = () => `
  <g class="fx fx-etoiles">
    ${fx([[8, 40, 0], [112, 54, 700], [14, 106, 1300], [106, 112, 400], [98, 14, 1900], [22, 8, 1000]], `<path d="${STAR}" />`)}
  </g>
  <g class="fx fx-bulles">
    ${fx([[28, 122, 0], [50, 126, 1300], [76, 124, 600], [94, 122, 2000], [40, 128, 2700]], `<circle r="3.2" />`)}
  </g>
  <g class="fx fx-coeurs">
    ${fx([[14, 96, 0], [106, 90, 1400], [24, 60, 2600], [100, 50, 800]], `<path d="${HEART}" />`)}
  </g>
  <g class="fx fx-neige">
    ${fx([[10, -14, 0], [34, -14, 1800], [58, -14, 900], [82, -14, 2600], [104, -14, 400], [22, -14, 3300], [94, -14, 1500]], `<circle r="2" />`)}
  </g>`;

const svg = (gradientId) => `
<svg viewBox="0 -14 120 156" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${gradientId}" cx="38%" cy="28%" r="80%">
      <stop offset="0%" class="stop-top" />
      <stop offset="100%" class="stop-bottom" />
    </radialGradient>
    <clipPath id="${gradientId}-clip"><path d="${BODY}" /></clipPath>
  </defs>

  <ellipse class="shadow" cx="60" cy="134" rx="26" ry="4" />
  ${effects()}

  <g class="think-dots">
    <circle cx="46" cy="-2" r="3.5" />
    <circle cx="60" cy="-6" r="3.5" />
    <circle cx="74" cy="-2" r="3.5" />
  </g>

  <g class="zzz">
    <text x="92" y="16">z</text>
    <text x="100" y="4">z</text>
    <text x="109" y="-8">Z</text>
  </g>

  <g class="alert">
    <circle cx="102" cy="4" r="10" />
    <rect x="100.5" y="-2.5" width="3" height="8" rx="1.5" />
    <circle cx="102" cy="9" r="1.7" />
  </g>

  <g class="sparkles">
    ${sparkle(12, 28, 0)}${sparkle(108, 34, 90)}${sparkle(8, 92, 160)}${sparkle(112, 88, 60)}
  </g>

  <g class="ghost">
    <!-- Orbit ring (effect), back half: behind the body. -->
    <path class="fx fx-orbite orbit-back" d="M8 80 A52 12 0 0 1 112 80" />

    <ellipse class="arm arm-l" cx="21" cy="82" rx="6" ry="10" />
    <ellipse class="arm arm-r" cx="99" cy="82" rx="6" ry="10" />

    <!-- Accessories that grow out of the head: drawn behind the body so it hides their base. -->
    <g class="acc acc-oreilles">
      <path class="ear" d="M27 36 L28 4 L51 16 Z" />
      <path class="ear" d="M93 36 L92 4 L69 16 Z" />
      <path class="inner" d="M31 27 L31.5 11 L44 18 Z" />
      <path class="inner" d="M89 27 L88.5 11 L76 18 Z" />
    </g>
    <g class="acc acc-cornes">
      <path d="M33 31 Q22 15 29 1 Q35 15 47 21 Z" />
      <path d="M87 31 Q98 15 91 1 Q85 15 73 21 Z" />
    </g>

    <path class="body" fill="url(#${gradientId})" d="${BODY}" />

    <!-- "Galaxy" skin: stars inside the body. -->
    <g class="skin-stars" clip-path="url(#${gradientId}-clip)">
      <circle cx="32" cy="40" r="1.3" /><circle cx="70" cy="30" r="1" /><circle cx="88" cy="48" r="1.4" />
      <circle cx="28" cy="92" r="1.1" /><circle cx="58" cy="100" r="1.5" /><circle cx="90" cy="96" r="1" />
      <circle cx="50" cy="24" r="0.9" /><circle cx="94" cy="72" r="1.1" /><circle cx="24" cy="66" r="0.9" />
      <path transform="translate(80 36)" d="${STAR}" /><path transform="translate(40 104) scale(0.8)" d="${STAR}" />
    </g>

    <ellipse class="halo" cx="60" cy="1" rx="22" ry="5" />
    <path class="sweat" d="M95 38 q5 8 0 11 q-5 -3 0 -11 z" />

    <g class="cheeks">
      <ellipse cx="36" cy="75" rx="7" ry="4.2" />
      <ellipse cx="84" cy="75" rx="7" ry="4.2" />
    </g>

    <g class="eyes-open">
      <ellipse cx="46" cy="61" rx="7.4" ry="8.2" />
      <ellipse cx="74" cy="61" rx="7.4" ry="8.2" />
      <circle class="shine" cx="48" cy="58" r="2.8" />
      <circle class="shine" cx="76" cy="58" r="2.8" />
    </g>
    <g class="eyes-happy">
      <path d="M41 64 Q47 55 53 64" />
      <path d="M67 64 Q73 55 79 64" />
    </g>
    <g class="eyes-squeeze">
      <path d="M42 57 L52 62 L42 67" />
      <path d="M78 57 L68 62 L78 67" />
    </g>
    <g class="eyes-sleep">
      <path d="M41 62 Q47 67 53 62" />
      <path d="M67 62 Q73 67 79 62" />
    </g>

    <!-- Accessories (settings → Apparence), only one is displayed. -->
    <g class="acc acc-noeud">
      <path d="M80 24 L69 17 L69 31 Z" />
      <path d="M80 24 L91 17 L91 31 Z" />
      <circle cx="80" cy="24" r="3.2" />
    </g>
    <g class="acc acc-chapeau">
      <ellipse class="hat" cx="60" cy="18" rx="23" ry="4" />
      <rect class="hat" x="46" y="-6" width="28" height="24" rx="3" />
      <rect class="band" x="46" y="10" width="28" height="4" />
    </g>
    <g class="acc acc-sorciere">
      <ellipse class="brim" cx="60" cy="17" rx="27" ry="4.5" />
      <path class="cone" d="M43 16 L58 -12 Q63 -16 66 -9 L77 16 Z" />
      <rect class="band" x="44" y="10" width="32" height="4" />
    </g>
    <g class="acc acc-bonnet">
      <path class="cap" d="M38 20 Q44 -6 66 -4 Q80 -2 88 10 L80 14 Q72 6 62 8 Q76 12 82 20 Z" />
      <rect class="fur" x="36" y="15" width="48" height="7" rx="3.5" />
      <circle class="fur" cx="89" cy="11" r="4.5" />
    </g>
    <g class="acc acc-couronne">
      <polygon points="44,19 45,3 52.5,11 60,0 67.5,11 75,3 76,19" />
      <circle cx="60" cy="13" r="2.2" />
    </g>
    <g class="acc acc-casque">
      <path d="M22 60 C22 18 98 18 98 60" />
      <rect x="14" y="52" width="11" height="20" rx="4.5" />
      <rect x="95" y="52" width="11" height="20" rx="4.5" />
    </g>
    <g class="acc acc-pousse">
      <path class="stem" d="M60 15 C60 9 60 5 61 1" />
      <path class="leaf" d="M61 3 C68 -4 77 0 74 5 C70 9 64 8 61 3 Z" />
      <path class="leaf" d="M60 7 C53 1 45 4 48 8 C51 11 57 10 60 7 Z" />
    </g>
    <g class="acc acc-lunettes">
      <circle cx="47" cy="62" r="9.5" />
      <circle cx="73" cy="62" r="9.5" />
      <path d="M56.5 60 Q60 57 63.5 60" />
    </g>
    <g class="acc acc-fete">
      <ellipse class="brim" cx="60" cy="18" rx="14" ry="2.6" />
      <polygon class="cone" points="46,18 74,18 62,-16" />
      <polygon class="stripe" points="51.3,6.7 70,6.7 68.6,2.7 53.2,2.7" />
      <polygon class="stripe" points="57.2,-5.8 65.6,-5.8 64.4,-9.2 58.8,-9.2" />
      <circle class="pom" cx="62" cy="-17" r="4" />
    </g>
    <g class="acc acc-licorne">
      <polygon class="horn" points="55,17 65,17 61,-14" />
      <path class="twist" d="M56 10 L64.5 8 M57.5 3 L63.5 1 M59 -4 L62.5 -5" />
    </g>
    <g class="acc acc-casquette">
      <path class="visor" d="M84 25 Q104 23 107 30 Q96 33 82 30 Z" />
      <path class="dome" d="M31 28 C31 4 89 4 89 28 Z" />
      <circle class="button" cx="60" cy="10.5" r="2.2" />
    </g>
    <g class="acc acc-fleur">
      <circle cx="84" cy="19" r="4.4" /><circle cx="88.8" cy="22.5" r="4.4" /><circle cx="86.9" cy="28" r="4.4" />
      <circle cx="81.1" cy="28" r="4.4" /><circle cx="79.2" cy="22.5" r="4.4" />
      <circle class="heart" cx="84" cy="24" r="3" />
    </g>
    <g class="acc acc-echarpe">
      <path class="tail" d="M70 97 L79 96 L81 119 L72 120 Z" />
      <path class="band" d="M19.5 86 Q60 100 100.5 86 L100.5 95 Q60 109 19.5 95 Z" />
      <path class="stripes" d="M72 108 L80 107.5 M72.6 114 L80.6 113.5" />
    </g>

    <path class="mouth mouth-smile" d="M55 76 Q60 81 65 76" />
    <ellipse class="mouth mouth-o" cx="60" cy="78" rx="3" ry="3.5" />
    <path class="mouth mouth-grin" d="M53 75 Q60 87 67 75 Z" />
    <path class="mouth mouth-frown" d="M55 80 Q60 75 65 80" />

    <!-- "Stop!" (dangerous command): frowning, arms crossed. -->
    <g class="brows">
      <path d="M40 49 L53 54" />
      <path d="M80 49 L67 54" />
    </g>
    <g class="arms-crossed">
      <ellipse cx="60" cy="93" rx="6.5" ry="20" transform="rotate(62 60 93)" />
      <ellipse cx="60" cy="93" rx="6.5" ry="20" transform="rotate(-62 60 93)" />
    </g>

    <!-- Orbit ring (effect), front half, and the little moon that goes round. -->
    <path class="fx fx-orbite orbit-front" d="M8 80 A52 12 0 0 0 112 80" />
    <g class="fx fx-orbite orbit-x"><g class="orbit-y"><circle cx="60" cy="80" r="3.4" /></g></g>
  </g>

  <g class="stop-sign">
    <polygon points="97,-9 105,-9 111,-3 111,5 105,11 97,11 91,5 91,-3" />
    <text x="101" y="3.6" text-anchor="middle">STOP</text>
  </g>
</svg>`;

/** Renders the ghost and drives it purely through `data-state` + CSS classes. */
export function createMascot(el) {
  el.innerHTML = svg(`body-grad-${crypto.randomUUID()}`);

  const flash = (cls, ms) => {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
    clearTimeout(el[`_${cls}`]);
    el[`_${cls}`] = setTimeout(() => el.classList.remove(cls), ms);
  };

  return {
    setState(state, color) {
      el.dataset.state = state;
      if (color) el.style.setProperty("--agent", color);
    },
    celebrate: () => flash("celebrate", 1200),
    flash,
  };
}
