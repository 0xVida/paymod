export type Marker = "sage-diamond" | "hollow-circle" | "rust-square" | "sage-square";

type Props = {
  num: string;
  title: string;
  eyebrow: string;
  marker: Marker;
  titleId: string;
};

export default function SectionHeader({ num, title, eyebrow, marker, titleId }: Props) {
  return (
    <>
      <div className="section-rule" aria-hidden="true" />
      <div className="section-head">
        <div className="section-title-row">
          <span className={`marker-${marker}`} aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
        </div>
        <span className="section-eyebrow mono">{eyebrow}</span>
      </div>
    </>
  );
}
