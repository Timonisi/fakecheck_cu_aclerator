import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import bridge, { parseURLSearchParamsForGetLaunchParams } from "@vkontakte/vk-bridge";
import { useAdaptivity, useAppearance, useInsets } from "@vkontakte/vk-bridge-react";
import { useActiveVkuiLocation, useRouteNavigator, RouterProvider } from "@vkontakte/vk-mini-apps-router";
import {
  AdaptivityProvider,
  Alert,
  AppRoot,
  Banner,
  Button,
  ButtonGroup,
  ConfigProvider,
  Div,
  Epic,
  Footer,
  FormItem,
  getViewHeightByViewportHeight,
  getViewWidthByViewportWidth,
  Group,
  Header,
  Panel,
  PanelHeader,
  Placeholder,
  RichCell,
  ScreenSpinner,
  SimpleCell,
  Slider,
  Snackbar,
  Spacing,
  SplitCol,
  SplitLayout,
  Tabbar,
  TabbarItem,
  Tabs,
  TabsItem,
  View,
  ViewWidth,
} from "@vkontakte/vkui";
import { Icon28CheckCircleOutline, Icon28StatisticsOutline, Icon28UsersOutline } from "@vkontakte/icons";
import { runBacktest, type BacktestResult } from "../backtest/backtest.ts";
import type { ExperimentReport, ExperimentRow } from "../scoring/experiment.ts";
import { experimentReport, observedMetrics } from "../scoring/experiment.ts";
import { splitLists } from "../scoring/lists.ts";
import { scoringConfig } from "../scoring/scoring.config.ts";
import { scoreMembers } from "../scoring/score.ts";
import { removalBatch, simulateRemoval } from "../scoring/simulate.ts";
import type { MemberScore } from "../scoring/types.ts";
import { VkApi, ingestCommunity, removeMember } from "../vk/ingest.ts";
import type { IngestedCommunity, IngestProgress } from "../vk/ingest.ts";
import { ErChart, modelCaption } from "./ErChart.tsx";
import { formatNumber, formatPercent, formatSignedPercent, reachLabel } from "./format.ts";
import { SyncLoader } from "./SyncLoader.tsx";
import {
  launchedGroupId,
  listAdminCommunities,
  requestCommunityAccess,
  requestUserApiAccess,
  type AdminCommunity,
} from "./permissions.ts";
import { router, views } from "./routes.ts";
import { loadSnapshot, saveSnapshot } from "./snapshot.ts";

const PREVIEW = 200;

type ListTab = "harm" | "weight" | "accounts";

export function App() {
  const appearance = useAppearance();
  const insets = useInsets();
  const bridgeAdaptivity = useAdaptivity();
  const launch = parseURLSearchParamsForGetLaunchParams(window.location.search);
  const mobile = launch.vk_platform?.startsWith("mobile_") ?? false;
  const insideVk = bridge.isWebView();

  return (
    <ConfigProvider
      colorScheme={appearance ?? "light"}
      platform={mobile ? undefined : "vkcom"}
      isWebView={insideVk}
      hasCustomPanelHeaderAfter={insideVk}
    >
      <AdaptivityProvider {...adaptivityFromBridge(bridgeAdaptivity)}>
        <AppRoot mode="full" safeAreaInsets={insets ?? undefined}>
          <RouterProvider router={router} useBridge notFoundRedirectPath="/">
            <MiniApp />
          </RouterProvider>
        </AppRoot>
      </AdaptivityProvider>
    </ConfigProvider>
  );
}

function adaptivityFromBridge(state: { type: string | null; viewportWidth: number; viewportHeight: number }) {
  if (!state.type || state.viewportWidth <= 0) return {};
  const forcedMobile = state.type === "force_mobile" || state.type === "force_mobile_compact";
  return {
    viewWidth: forcedMobile ? ViewWidth.MOBILE : getViewWidthByViewportWidth(state.viewportWidth),
    viewHeight: getViewHeightByViewportHeight(state.viewportHeight),
    hasPointer: !forcedMobile,
  };
}

function removalBlockReason(backtest: BacktestResult, warnings: string[]): string | null {
  const reasons: string[] = [];
  if (backtest.status !== "ok" || backtest.auc == null) {
    reasons.push("недостаточно данных для проверки качества модели");
  } else if (backtest.aucUnreliable) {
    reasons.push(`низкое качество прогноза (AUC ${formatNumber(backtest.auc, 2)})`);
  }
  if (warnings.some((warning) => warning.startsWith("donut:"))) {
    reasons.push("не удалось проверить подписчиков VK Donut");
  }
  if (
    warnings.some(
      (warning) =>
        warning.startsWith("messages:") ||
        warning.includes("Право сообщений не выдано"),
    )
  ) {
    reasons.push("не удалось проверить недавние сообщения сообществу");
  }
  return reasons.length > 0
    ? `Удаление отключено: ${reasons.join("; ")}. Исправьте доступ и обновите данные; пока используйте список только как ориентир.`
    : null;
}

function MiniApp() {
  const { view: activeView = views.forecast } = useActiveVkuiLocation();
  const routeNavigator = useRouteNavigator();
  const [listTab, setListTab] = useState<ListTab>("harm");
  const [data, setData] = useState<IngestedCommunity | null>(null);
  const [snapshot, setSnapshot] = useState<ExperimentRow | null>(null);
  const [n, setN] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [popout, setPopout] = useState<ReactNode>(null);
  const [syncing, setSyncing] = useState(false);
  const syncStartedAt = useRef(0);
  const [community, setCommunity] = useState<{ id: number; name: string } | null>(() => {
    const id = launchedGroupId();
    return id ? { id, name: "" } : null;
  });
  const [communities, setCommunities] = useState<AdminCommunity[] | null>(null);
  const [pending, setPending] = useState<"sync" | "remove" | null>(null);
  const busy = useRef(false);

  const scored = useMemo(() => {
    if (!data) return null;
    const now = Math.floor(Date.now() / 1000);
    const scores = scoreMembers({ posts: data.posts, events: data.events, members: data.members, now });
    return {
      scores,
      lists: splitLists(scores),
      backtest: runBacktest({
        posts: data.posts,
        events: data.events,
        members: data.members,
        exposureNow: now,
      }),
    };
  }, [data]);

  const simulation = useMemo(() => {
    if (!scored) return null;
    return simulateRemoval(scored.scores, scored.lists.harmReach, n);
  }, [scored, n]);

  const experiment = useMemo(() => {
    if (!snapshot) return null;
    return experimentReport(snapshot, data?.posts ?? [], data?.events ?? [], Math.floor(Date.now() / 1000));
  }, [snapshot, data]);

  const overview = scored
    ? {
        synced: true,
        harmCount: scored.lists.harmReach.length,
        deadWeightCount: scored.lists.deadWeight.length,
        deadAccountCount: scored.lists.deadAccounts.length,
        harmReach: scored.lists.harmReach.slice(0, PREVIEW),
        deadWeight: scored.lists.deadWeight.slice(0, PREVIEW),
        deadAccounts: scored.lists.deadAccounts.slice(0, PREVIEW),
        backtest: scored.backtest,
        removeBatchSize: scoringConfig.removeBatchSize,
      }
    : null;

  useEffect(() => {
    let cancelled = false;
    loadSnapshot()
      .then((row) => {
        if (!cancelled && row) setSnapshot(row);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const harmCount = overview?.harmCount ?? 0;
  useEffect(() => {
    setN((current) => Math.min(current, harmCount));
  }, [harmCount]);

  async function knownGroup(action: "sync" | "remove"): Promise<number | null> {
    if (community) return community.id;
    const list = await listAdminCommunities();
    if (list.length === 0) throw new Error("Нет сообществ, где вы администратор.");
    setCommunities(list);
    setPending(action);
    return null;
  }

  async function chooseCommunity(next: AdminCommunity) {
    const action = pending ?? "sync";
    setCommunity({ id: next.id, name: next.name });
    setCommunities(null);
    setPending(null);
    if (action === "remove") await confirmRemove(next.id);
    else await sync(next.id);
  }

  async function sync(explicitGroupId?: number) {
    setSyncing(true);
    setError(null);
    try {
      const id = explicitGroupId ?? (await knownGroup("sync"));
      if (id == null) return;
      syncStartedAt.current = Date.now();
      setPopout(<SyncLoader stage="auth" startedAt={syncStartedAt.current} />);
      const userAccess = await requestUserApiAccess();
      setPopout(<SyncLoader stage="community-auth" startedAt={syncStartedAt.current} />);
      const access = await requestCommunityAccess(id);
      setCommunity((current) => current ?? { id, name: "" });
      const userApi = new VkApi(userAccess.accessToken);
      const communityApi = new VkApi(access.accessToken);
      const ingested = await ingestCommunity(
        (method, params) => userApi.call(method, params),
        access.groupId,
        (method, params) => communityApi.call(method, params),
        (progress) => {
          setPopout(
            <SyncLoader stage={progress.stage} progress={progress} startedAt={syncStartedAt.current} />,
          );
        },
      );
      setData(ingested);
      setWarnings([...access.warnings, ...ingested.warnings]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSyncing(false);
      setPopout(null);
    }
  }

  async function confirmRemove(explicitGroupId?: number) {
    setError(null);
    try {
      const blockReason = overview ? removalBlockReason(overview.backtest, warnings) : null;
      if (blockReason) throw new Error(blockReason);
      if (!data || !scored) throw new Error("Сначала обновите данные сообщества.");
      const id = explicitGroupId ?? (await knownGroup("remove"));
      if (id == null) {
        busy.current = false;
        setPopout(null);
        return;
      }
      const access = await requestCommunityAccess(id);
      setPopout(<ScreenSpinner />);
      if (access.warnings.length > 0) setWarnings(access.warnings);
      const batch = removalBatch(scored.lists.harmReach, n, scoringConfig.removeBatchSize);
      const api = new VkApi(access.accessToken);
      const removed: number[] = [];
      const failed: Array<{ userId: number; error: string }> = [];
      for (const score of batch) {
        try {
          await removeMember((method, params) => api.call(method, params), access.groupId, score.userId);
          removed.push(score.userId);
        } catch (reason) {
          failed.push({ userId: score.userId, error: reason instanceof Error ? reason.message : String(reason) });
        }
      }
      if (removed.length > 0) {
        const metrics = observedMetrics(data.posts, data.events);
        const row: ExperimentRow = {
          id: 1,
          createdAt: Math.floor(Date.now() / 1000),
          removedIds: removed,
          postIds: metrics.postIds,
          erAll: metrics.erAll,
          erCommentsReposts: metrics.erCommentsReposts,
          avgReach: metrics.avgReach,
          reachSource: metrics.reachSource,
          nRemoved: removed.length,
        };
        const gone = new Set(removed);
        setData({ ...data, members: data.members.filter((member) => !gone.has(member.userId)) });
        await saveSnapshot(row);
        setSnapshot(row);
      }
      busy.current = false;
      const failedNote = failed.length > 0 ? `, не удалилось ${failed.length}` : "";
      const message =
        removed.length > 0
          ? `Удалено ${removed.length}${failedNote}. Снимок сохранён, сравнение — через 14 дней.`
          : `Не удалилось ${failed.length}.`;
      setPopout(
        <Snackbar onClosed={() => setPopout(null)} offsetY={16}>
          {message}
        </Snackbar>,
      );
    } catch (reason) {
      busy.current = false;
      setError(reason instanceof Error ? reason.message : String(reason));
      setPopout(null);
    }
  }

  function askRemove() {
    if (!overview) return;
    const batch = Math.min(n, overview.removeBatchSize);
    busy.current = false;
    setPopout(
      <Alert
        title="Удалить участников"
        description={`Из сообщества будет удалено ${batch} человек. За один раз не больше ${overview.removeBatchSize}.`}
        actionsLayout="horizontal"
        onClose={() => undefined}
        onClosed={() => {
          if (!busy.current) setPopout(null);
        }}
        actions={[
          { title: "Отмена", mode: "cancel" },
          {
            title: "Удалить",
            mode: "destructive",
            action: () => {
              busy.current = true;
              void confirmRemove();
            },
          },
        ]}
      />,
    );
  }

  const aucUnreliable = overview?.backtest.aucUnreliable ?? false;
  const removeBlockedReason = overview ? removalBlockReason(overview.backtest, warnings) : null;
  const batch = overview ? Math.min(n, overview.removeBatchSize) : 0;

  return (
          <SplitLayout popout={popout} style={{ height: "100%" }}>
            <SplitCol width="100%" maxWidth={720} stretchedOnMobile autoSpaced>
              <Epic
                activeStory={activeView}
                tabbar={
                  <Tabbar>
                    <TabbarItem
                      selected={activeView === views.forecast}
                      label="Прогноз"
                      onClick={() => void routeNavigator.push("/")}
                    >
                      <Icon28StatisticsOutline />
                    </TabbarItem>
                    <TabbarItem
                      selected={activeView === views.lists}
                      label="Списки"
                      onClick={() => void routeNavigator.push(`/${views.lists}`)}
                    >
                      <Icon28UsersOutline />
                    </TabbarItem>
                    <TabbarItem
                      selected={activeView === views.result}
                      label="Результат"
                      onClick={() => void routeNavigator.push(`/${views.result}`)}
                    >
                      <Icon28CheckCircleOutline />
                    </TabbarItem>
                  </Tabbar>
                }
              >
                <View id={views.forecast} activePanel={views.forecast}>
                  <Panel id={views.forecast}>
                    <PanelHeader>Прогноз</PanelHeader>
                    <SyncBlock
                      syncing={syncing}
                      error={error}
                      communityName={community?.name ?? ""}
                      communities={communities}
                      onPick={(next) => void chooseCommunity(next)}
                      onSync={() => void sync()}
                    />
                    {warnings.length > 0 ? (
                      <Banner mode="tint" title="Синхронизация с предупреждениями" subtitle={warnings.join(" ")} />
                    ) : null}
                    <Banner mode="tint" title={modelCaption} subtitle="Реальный эффект виден только на экране «Результат»." />
                    {aucUnreliable ? (
                      <Banner
                        mode="tint"
                        title="Скоринг ненадёжен для этого сообщества"
                        subtitle={`AUC ${formatNumber(overview?.backtest.auc, 2)} ниже 0.60: модель почти не отличает тех, кто будет реагировать, от тех, кто промолчит.`}
                      />
                    ) : null}
                    {!overview?.synced ? (
                      <Placeholder title="Нет данных">Нажмите «Обновить данные», чтобы забрать стену и участников.</Placeholder>
                    ) : (
                      <Group header={<Header>Сколько удалить</Header>}>
                        <FormItem
                          top={`Участников в пуле вреда: ${overview.harmCount}. На графике ${n}, кнопка удалит ${batch}.`}
                          topMultiline
                        >
                          <Slider
                            min={0}
                            max={Math.max(overview.harmCount, 0)}
                            step={1}
                            value={n}
                            disabled={overview.harmCount === 0}
                            withTooltip
                            getAriaLabel={() => "Сколько удалить"}
                            getAriaValueText={(value) => String(value)}
                            onChange={(value) => setN(value)}
                          />
                        </FormItem>
                        <Div>
                          {simulation ? (
                            <ErChart all={simulation.all} commentsReposts={simulation.commentsReposts} />
                          ) : (
                            <Placeholder>Считаем прогноз</Placeholder>
                          )}
                        </Div>
                        <Div>
                          <ButtonGroup stretched>
                            <Button
                              size="l"
                              appearance="negative"
                              stretched
                              disabled={batch === 0 || removeBlockedReason != null}
                              onClick={askRemove}
                            >
                              {`Удалить ${batch}`}
                            </Button>
                          </ButtonGroup>
                        </Div>
                        {removeBlockedReason ? (
                          <Banner mode="tint" title="Удаление недоступно" subtitle={removeBlockedReason} />
                        ) : null}
                        <Footer>Порция не больше {overview.removeBatchSize}. Защищённые в пул не входят.</Footer>
                      </Group>
                    )}
                  </Panel>
                </View>
                <View id={views.lists} activePanel={views.lists}>
                  <Panel id={views.lists}>
                    <PanelHeader>Списки</PanelHeader>
                    <SyncBlock
                      syncing={syncing}
                      error={error}
                      communityName={community?.name ?? ""}
                      communities={communities}
                      onPick={(next) => void chooseCommunity(next)}
                      onSync={() => void sync()}
                    />
                    <Tabs>
                      <TabsItem selected={listTab === "harm"} onClick={() => setListTab("harm")}>
                        {`Вредят охвату${overview ? ` ${overview.harmCount}` : ""}`}
                      </TabsItem>
                      <TabsItem selected={listTab === "weight"} onClick={() => setListTab("weight")}>
                        {`Мёртвый вес${overview ? ` ${overview.deadWeightCount}` : ""}`}
                      </TabsItem>
                      <TabsItem selected={listTab === "accounts"} onClick={() => setListTab("accounts")}>
                        {`Мёртвые аккаунты${overview ? ` ${overview.deadAccountCount}` : ""}`}
                      </TabsItem>
                    </Tabs>
                    {listTab === "harm" ? (
                      <MemberList
                        title="Видят посты и почти не реагируют"
                        note="exposure не ниже 0.5. Сортировка по вреду. Симуляция и удаление берут верх этого списка."
                        members={overview?.harmReach ?? []}
                        total={overview?.harmCount ?? 0}
                      />
                    ) : null}
                    {listTab === "weight" ? (
                      <MemberList
                        title="На охват не влияют"
                        note="exposure ниже 0.2 и нет реакций в окне. Базу чистят отдельно, в этот эксперимент они не входят."
                        members={overview?.deadWeight ?? []}
                        total={overview?.deadWeightCount ?? 0}
                      />
                    ) : null}
                    {listTab === "accounts" ? (
                      <MemberList
                        title="ВК снимает их сам"
                        note="Удалённые и заблокированные аккаунты. Кнопки удаления нет."
                        members={overview?.deadAccounts ?? []}
                        total={overview?.deadAccountCount ?? 0}
                      />
                    ) : null}
                  </Panel>
                </View>
                <View id={views.result} activePanel={views.result}>
                  <Panel id={views.result}>
                    <PanelHeader>Результат</PanelHeader>
                    <SyncBlock
                      syncing={syncing}
                      error={error}
                      communityName={community?.name ?? ""}
                      communities={communities}
                      onPick={(next) => void chooseCommunity(next)}
                      onSync={() => void sync()}
                    />
                    <Result experiment={experiment} />
                  </Panel>
                </View>
              </Epic>
            </SplitCol>
          </SplitLayout>
  );
}

function SyncBlock({
  syncing,
  error,
  communityName,
  communities,
  onPick,
  onSync,
}: {
  syncing: boolean;
  error: string | null;
  communityName: string;
  communities: AdminCommunity[] | null;
  onPick: (community: AdminCommunity) => void;
  onSync: () => void;
}) {
  return (
    <Group>
      <Div>
        <Button size="m" mode="secondary" loading={syncing} onClick={onSync}>
          Обновить данные
        </Button>
      </Div>
      {error ? <Banner mode="tint" title="Не получилось" subtitle={error} /> : null}
      {communities ? (
        <>
          <Header>Где вы администратор</Header>
          {communities.map((item) => (
            <SimpleCell
              key={item.id}
              subtitle={item.membersCount == null ? undefined : `${item.membersCount.toLocaleString("ru-RU")} участников`}
              onClick={() => onPick(item)}
            >
              {item.name}
            </SimpleCell>
          ))}
        </>
      ) : null}
      <Footer>
        {communities
          ? "Выберите сообщество. ВКонтакте спросит права управления и сообщений."
          : communityName
            ? `Сообщество «${communityName}». Расчёт в мини-приложении, снимок хранится в ВКонтакте.`
            : "Если открыть не из сообщества, покажем те, где вы администратор, и запросим права."}
      </Footer>
    </Group>
  );
}

function MemberList({
  title,
  note,
  members,
  total,
}: {
  title: string;
  note: string;
  members: MemberScore[];
  total: number;
}) {
  return (
    <Group header={<Header>{title}</Header>}>
      <Footer>{note}</Footer>
      {members.length === 0 ? <Placeholder title="Пусто" /> : null}
      {members.map((member) => {
        const name = `${member.firstName} ${member.lastName}`.trim() || `id${member.userId}`;
        const status =
          member.deactivated === "deleted" ? "удалён" : member.deactivated === "banned" ? "заблокирован" : undefined;
        return (
          <RichCell
            key={member.userId}
            overTitle={`id${member.userId}`}
            subtitle={`вред ${formatNumber(member.harm)} · показ ${formatNumber(member.exposure)} · реакция ${formatPercent(member.reaction)}`}
            extraSubtitle={`вклад ${formatNumber(member.value)}`}
            after={status}
            multiline
          >
            {name}
          </RichCell>
        );
      })}
      {total > members.length ? <Footer>{`Показаны первые ${members.length} из ${total}`}</Footer> : null}
    </Group>
  );
}

function Result({ experiment }: { experiment: ExperimentReport | null }) {
  if (!experiment) {
    return (
      <Placeholder title="Снимка ещё нет">
        Перед удалением сохранится ER, средний охват и список удалённых. Сравнение появится через 14 дней.
      </Placeholder>
    );
  }
  if (!experiment.ready) {
    return (
      <Group header={<Header>Рано сравнивать</Header>}>
        <Banner
          mode="tint"
          title="Это единственный способ узнать реальный эффект"
          subtitle={`Осталось ${experiment.daysLeft} дн. До этого дня эффект неизвестен.`}
        />
        <SnapshotCells experiment={experiment.experiment} />
      </Group>
    );
  }
  return (
    <Group header={<Header>Наблюдаемый эффект</Header>}>
      <Banner
        mode="tint"
        title="Это единственный способ узнать реальный эффект"
        subtitle="Сравниваются реакции и охват постов, не модельный прогноз."
      />
      {experiment.postsAfter === 0 ? (
        <Placeholder title="Нет постов после удаления">Обновите данные, когда в сообществе выйдут новые посты.</Placeholder>
      ) : (
        <>
          <SimpleCell indicator={formatPercent(experiment.before.erAll)} subtitle="до">
            ER, все реакции
          </SimpleCell>
          <SimpleCell indicator={formatPercent(experiment.after.erAll)} subtitle="после">
            ER, все реакции
          </SimpleCell>
          <SimpleCell indicator={formatSignedPercent(experiment.deltaErAll)} subtitle="разница">
            ER, все реакции
          </SimpleCell>
          <Spacing />
          <SimpleCell indicator={formatPercent(experiment.before.erCommentsReposts)} subtitle="до">
            ER, комментарии и репосты
          </SimpleCell>
          <SimpleCell indicator={formatPercent(experiment.after.erCommentsReposts)} subtitle="после">
            ER, комментарии и репосты
          </SimpleCell>
          <SimpleCell indicator={formatSignedPercent(experiment.deltaErCommentsReposts)} subtitle="разница">
            ER, комментарии и репосты
          </SimpleCell>
          <Spacing />
          <SimpleCell
            indicator={formatNumber(experiment.before.avgReach, 0)}
            subtitle={`до, ${reachLabel(experiment.before.reachSource)}`}
          >
            Средний охват
          </SimpleCell>
          <SimpleCell
            indicator={formatNumber(experiment.after.avgReach, 0)}
            subtitle={`после, ${reachLabel(experiment.after.reachSource)}`}
          >
            Средний охват
          </SimpleCell>
          <SimpleCell indicator={formatNumber(experiment.deltaAvgReach, 0)} subtitle="разница">
            Средний охват
          </SimpleCell>
        </>
      )}
      <SnapshotCells experiment={experiment.experiment} />
    </Group>
  );
}

function SnapshotCells({ experiment }: { experiment: ExperimentRow }) {
  return (
    <>
      <SimpleCell indicator={String(experiment.nRemoved)}>Удалено в снимке</SimpleCell>
      <SimpleCell indicator={formatPercent(experiment.erAll)} subtitle={reachLabel(experiment.reachSource)}>
        ER до удаления, все реакции
      </SimpleCell>
      <SimpleCell indicator={formatNumber(experiment.avgReach, 0)}>Средний охват до удаления</SimpleCell>
    </>
  );
}
