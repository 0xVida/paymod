import { CARDS } from "@/lib/data";
import SectionHeader from "./SectionHeader";

export default function Surfaces() {
  return (
    <section id="surfaces" className="section" aria-labelledby="surfaces-title">
      <SectionHeader
        num="02"
        title="Connect agents four ways"
        eyebrow="Surfaces"
        marker="sage-diamond"
        titleId="surfaces-title"
      />

      <div className="surface-grid">
        {CARDS.map((card, i) => (
          <article
            key={card.tag}
            className="surface-cell"
            data-br={i % 2 === 0}
            data-bb={i < 2}
          >
            <div className="surface-cell-head">
              <span className="surface-tag mono">{card.tag}</span>
              <span className="surface-idx mono">{`0${i + 1}`}</span>
            </div>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <span className="snippet mono">{card.snippet}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
