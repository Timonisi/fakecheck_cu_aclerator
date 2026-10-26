import { useEffect, useState } from "react";
import type { IngestProgress } from "../vk/ingest.ts";

type Props = {
  stage: "auth" | "community-auth" | IngestProgress["stage"];
  progress?: IngestProgress;
  startedAt: number;
};

const STAGES: Record<Props["stage"], { title: string; detail: string; step: number }> = {
  auth: {
    title: "Подключаемся к ВКонтакте",
    detail: "Запрашиваем доступ для чтения публикаций и участников.",
    step: -1,
  },
  "community-auth": {
    title: "Проверяем права сообщества",
    detail: "Готовим безопасный доступ к данным сообщества.",
    step: -1,
  },
  wall: {
    title: "Загружаем публикации",
    detail: "Получаем последние записи со стены сообщества.",
    step: 0,
  },
  reactions: {
    title: "Собираем реакции",
    detail: "Сверяем лайки, комментарии и репосты по каждой записи.",
    step: 1,
  },
  members: {
    title: "Загружаем участников",
    detail: "Собираем список, необходимый для расчёта модели.",
    step: 2,
  },
  protection: {
    title: "Проверяем исключения",
    detail: "Отмечаем руководителей и подписчиков VK Donut.",
    step: 2,
  },
  messages: {
    title: "Проверяем недавние обращения",
    detail: "Ищем личные сообщения, чтобы случайно не удалить активных участников.",
    step: 2,
  },
};

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.floor(seconds / 60)} мин ${String(seconds % 60).padStart(2, "0")} сек`;
}

export function SyncLoader({ stage, progress, startedAt }: Props) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  const current = STAGES[stage];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="sync-loader-backdrop" role="status" aria-live="polite" aria-atomic="true">
      <section className="sync-loader-card" aria-label="Синхронизация сообщества">
        <div className="sync-loader-art" aria-hidden="true">
          <span className="sync-loader-orbit sync-loader-orbit-outer" />
          <span className="sync-loader-orbit sync-loader-orbit-inner" />
          <span className="sync-loader-core">
            <span className="sync-loader-core-dot" />
          </span>
          <span className="sync-loader-spark sync-loader-spark-one" />
          <span className="sync-loader-spark sync-loader-spark-two" />
          <span className="sync-loader-spark sync-loader-spark-three" />
        </div>
        <div className="sync-loader-copy">
          <span className="sync-loader-eyebrow">СИНХРОНИЗАЦИЯ</span>
          <h2>{current.title}</h2>
          <p>{current.detail}</p>
          {stage === "reactions" && progress && progress.total > 0 ? (
            <p className="sync-loader-counter">
              Запись {progress.current} из {progress.total}
            </p>
          ) : null}
        </div>
        <div className="sync-loader-steps" aria-hidden="true">
          {["Публикации", "Реакции", "Участники"].map((label, index) => (
            <span
              className={`sync-loader-step${index === current.step ? " is-active" : ""}${index < current.step ? " is-done" : ""}`}
              key={label}
            >
              <i />
              {label}
            </span>
          ))}
        </div>
        <div className="sync-loader-footer">
          <span className="sync-loader-pulse" />
          <span>Обычно занимает до пары минут</span>
          <span className="sync-loader-time">{elapsedLabel(elapsed)}</span>
        </div>
      </section>
    </div>
  );
}
