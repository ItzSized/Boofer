const sparkle = (x, y, delay) => `
  <g transform="translate(${x} ${y})">
    <path class="spark" style="animation-delay:${delay}ms"
      d="M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z" />
  </g>`;

const svg = (gradientId) => `
<svg viewBox="0 -14 120 156" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="${gradientId}" cx="38%" cy="28%" r="80%">
      <stop offset="0%" class="stop-top" />
      <stop offset="100%" class="stop-bottom" />
    </radialGradient>
  </defs>

  <ellipse class="shadow" cx="60" cy="134" rx="26" ry="4" />

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
    <ellipse class="arm arm-l" cx="21" cy="82" rx="6" ry="10" />
    <ellipse class="arm arm-r" cx="99" cy="82" rx="6" ry="10" />

    <path class="body" fill="url(#${gradientId})"
      d="M20 62 C20 32 38 14 60 14 C82 14 100 32 100 62 V106
         q-6.67 10 -13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.35 0 Z" />

    <g class="cheeks">
      <ellipse cx="37" cy="76" rx="6" ry="3.5" />
      <ellipse cx="83" cy="76" rx="6" ry="3.5" />
    </g>

    <g class="eyes-open">
      <ellipse cx="47" cy="62" rx="5.5" ry="7.5" />
      <ellipse cx="73" cy="62" rx="5.5" ry="7.5" />
      <circle class="shine" cx="47.8" cy="60" r="1.8" />
      <circle class="shine" cx="73.8" cy="60" r="1.8" />
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

    <path class="mouth mouth-smile" d="M55 76 Q60 81 65 76" />
    <ellipse class="mouth mouth-o" cx="60" cy="78" rx="3" ry="3.5" />
    <path class="mouth mouth-grin" d="M53 75 Q60 87 67 75 Z" />
    <path class="mouth mouth-frown" d="M55 80 Q60 75 65 80" />
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
