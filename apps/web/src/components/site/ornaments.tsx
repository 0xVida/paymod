type OrnProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Hatch({ id, gap = 4 }: { id: string; gap?: number }) {
  return (
    <defs>
      <pattern
        id={id}
        width={gap}
        height={gap}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
      >
        <line x1="0" y1="0" x2="0" y2={gap} stroke="currentColor" strokeWidth="0.5" opacity="0.7" />
      </pattern>
    </defs>
  );
}

export function PlateStack({ className }: OrnProps) {
  const w = 150;
  const h = 74;
  const plane = (cx: number, cy: number, s = 1) =>
    `M${cx} ${cy - (h / 2) * s} L${cx + (w / 2) * s} ${cy} L${cx} ${cy + (h / 2) * s} L${cx - (w / 2) * s} ${cy} Z`;

  const layers = [
    { y: 66, label: "REQUEST", sub: "open resource" },
    { y: 176, label: "GATE", sub: "402 required" },
    { y: 286, label: "EVALUATE", sub: "authority" },
    { y: 396, label: "SETTLE", sub: "pay · retry" },
  ];

  return (
    <svg viewBox="0 0 380 470" className={className} aria-hidden="true">
      <Hatch id="hstk" gap={5} />
      <line
        x1="150"
        y1="40"
        x2="150"
        y2="440"
        {...stroke}
        strokeWidth={0.5}
        strokeDasharray="3 5"
      />
      {layers.map((l, i) => (
        <g key={l.label}>
          <path d={plane(150, l.y + 26, 1.12)} {...stroke} strokeWidth={0.5} opacity={0.5} />
          <path d={plane(150, l.y + 26, 1.12)} fill="url(#hstk)" stroke="none" opacity={0.35} />
          <path d={plane(150, l.y)} {...stroke} />
          <path
            d={`M${150 - w / 2} ${l.y} v16 l75 ${h / 2} l75 -${h / 2} v-16`}
            {...stroke}
            strokeWidth={0.7}
          />
          <line
            x1="150"
            y1={l.y + h / 2}
            x2="150"
            y2={l.y + h / 2 + 16}
            {...stroke}
            strokeWidth={0.6}
          />
          {i === 1 && <ellipse cx="150" cy={l.y} rx="42" ry="20" {...stroke} strokeWidth={0.6} />}
          {i === 2 && <circle cx="150" cy={l.y} r="4" {...stroke} strokeWidth={0.8} />}
          <line x1={225} y1={l.y + h / 4} x2={300} y2={l.y - 4} {...stroke} strokeWidth={0.5} />
          <circle cx={300} cy={l.y - 4} r="2" {...stroke} strokeWidth={0.7} />
          <text
            x={308}
            y={l.y - 6}
            fill="currentColor"
            fontSize="11"
            letterSpacing="2"
            fontFamily="var(--font-plex-mono), monospace"
          >
            {l.label}
          </text>
          <text
            x={308}
            y={l.y + 8}
            fill="currentColor"
            fontSize="8"
            opacity="0.65"
            fontFamily="var(--font-plex-mono), monospace"
          >
            {l.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function PlateAperture({ className }: OrnProps) {
  const rings = [64, 50, 36, 22];
  return (
    <svg viewBox="0 0 260 200" className={className} aria-hidden="true">
      <Hatch id="ha" gap={5} />
      <line x1="0" y1="100" x2="52" y2="100" {...stroke} strokeWidth={0.6} strokeDasharray="4 4" />
      <path d="M46 96 l8 4 l-8 4" {...stroke} strokeWidth={0.7} />
      {rings.map((r, i) => (
        <g key={r}>
          <path
            d={`M130 ${100 - r} a${r} ${r} 0 0 1 0 ${r * 2}`}
            {...stroke}
            strokeWidth={i === 0 ? 1 : 0.6}
          />
          <path
            d={`M130 ${100 + r} a${r} ${r} 0 0 1 0 ${-r * 2}`}
            {...stroke}
            strokeWidth={i === 0 ? 1 : 0.6}
            opacity={0.55}
            strokeDasharray={i % 2 ? "3 5" : undefined}
          />
        </g>
      ))}
      <circle cx="130" cy="100" r="8" {...stroke} />
      <circle cx="130" cy="100" r="8" fill="url(#ha)" stroke="none" />
      <path
        d="M130 100 L214 58 A94 94 0 0 0 214 142 Z"
        {...stroke}
        strokeWidth={0.5}
        opacity={0.5}
      />
      <line x1="200" y1="100" x2="260" y2="100" {...stroke} strokeWidth={0.6} />
      <path d="M252 95 l8 5 l-8 5" {...stroke} strokeWidth={0.7} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          x1={40 + i * 34}
          y1={176}
          x2={40 + i * 34}
          y2={i === 3 ? 164 : 170}
          {...stroke}
          strokeWidth={0.6}
        />
      ))}
      <line x1="20" y1="176" x2="240" y2="176" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}
