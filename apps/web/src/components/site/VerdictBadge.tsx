import { verdictColor } from "@/lib/verdict";

type Props = {
  verdict: string;
  muted?: boolean;
};

export default function VerdictBadge({ verdict, muted = false }: Props) {
  return (
    <span
      className="verdict-badge typewriter"
      style={{ color: muted ? "var(--line-55)" : verdictColor(verdict) }}
    >
      {verdict.replace(/_/g, " ")}
    </span>
  );
}
