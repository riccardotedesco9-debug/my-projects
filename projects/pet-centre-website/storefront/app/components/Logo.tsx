/**
 * Pet Centre brand mark — two gold paw prints, hand-drawn as crisp inline SVG
 * (scalable, exact brand gold via currentColor, transparent). Paired with the
 * "Pet Centre" wordmark (Fredoka) in the header/footer for the full lockup.
 */

function Paw({x, y, s}: {x: number; y: number; s: number}) {
  // A paw centred near (x,y), uniformly scaled: one main pad + four toe beans.
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="4" rx="7" ry="5.5" />
      <ellipse cx="-7" cy="-4" rx="2.6" ry="3.6" />
      <ellipse cx="-2.4" cy="-7.5" rx="2.8" ry="3.9" />
      <ellipse cx="2.6" cy="-7" rx="2.7" ry="3.8" />
      <ellipse cx="7" cy="-3" rx="2.4" ry="3.3" />
    </g>
  );
}

export function PawMark({className}: {className?: string}) {
  return (
    <svg
      className={className}
      viewBox="0 0 56 56"
      width="34"
      height="34"
      role="img"
      aria-label="Pet Centre"
      fill="currentColor"
    >
      <Paw x={18} y={33} s={1.15} />
      <Paw x={40} y={19} s={0.8} />
    </svg>
  );
}
