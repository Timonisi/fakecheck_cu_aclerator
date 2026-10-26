import type { ErSide } from "../scoring/simulate.ts";
import { formatPercent, formatSignedPercent } from "./format.ts";

const MODEL_CAPTION = "Прогноз основан на модели, а не на данных ВК";

type Props = {
  all: ErSide;
  commentsReposts: ErSide;
};

export function ErChart({ all, commentsReposts }: Props) {
  const max = Math.max(0.0001, all.before ?? 0, all.after ?? 0, commentsReposts.before ?? 0, commentsReposts.after ?? 0);
  const metrics = [
    { title: "Все реакции", side: all },
    { title: "Комментарии и репосты", side: commentsReposts },
  ];

  return (
    <figure className="er-chart">
      <div className="er-chart-metrics">
        {metrics.map(({ title, side }) => (
          <section className="er-chart-metric" key={title}>
            <div className="er-chart-heading">
              <h3>{title}</h3>
              <span className="er-chart-delta">{formatSignedPercent(side.delta)}</span>
            </div>
            <ErBar label="Сейчас" value={side.before} max={max} color="before" />
            <ErBar label="После" value={side.after} max={max} color="after" />
          </section>
        ))}
      </div>
      <figcaption className="er-chart-caption">{MODEL_CAPTION}</figcaption>
    </figure>
  );
}

function ErBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number | null;
  max: number;
  color: "before" | "after";
}) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="er-chart-row">
      <span className="er-chart-label">{label}</span>
      <span className="er-chart-track" aria-hidden="true">
        <span className={`er-chart-fill is-${color}`} style={{ width: `${width}%` }} />
      </span>
      <strong className="er-chart-value">{formatPercent(value)}</strong>
    </div>
  );
}

export const modelCaption = MODEL_CAPTION;
