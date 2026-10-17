import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Game,
  mergeLibrary,
  parsePendingInstalls,
  pendingLifetime,
} from "./library";
import { demo, httpStatus, type Notify, serviceError } from "./services";

const demoGames: Game[] = [
  ["1245620", "ELDEN RING"],
  ["1091500", "Cyberpunk 2077"],
  ["1086940", "Baldur's Gate 3"],
  ["1145360", "Hades"],
  ["553850", "HELLDIVERS 2"],
  ["620", "Portal 2"],
  ["413150", "Stardew Valley"],
  ["1174180", "Red Dead Redemption 2"],
  ["1593500", "God of War"],
  ["814380", "Sekiro: Shadows Die Twice"],
  ["782330", "DOOM Eternal"],
  ["1030300", "Hollow Knight: Silksong"],
  // Owned but not installed: enough to scroll the Library grid several screens.
  ["292030", "The Witcher 3: Wild Hunt"],
  ["271590", "Grand Theft Auto V"],
  ["2050650", "Resident Evil 4"],
  ["1817070", "Marvel's Spider-Man Remastered"],
  ["2215430", "Ghost of Tsushima"],
  ["1888160", "ARMORED CORE VI"],
  ["990080", "Hogwarts Legacy"],
  ["2358720", "Black Myth: Wukong"],
  ["1623730", "Palworld"],
  ["105600", "Terraria"],
  ["504230", "Celeste"],
  ["367520", "Hollow Knight"],
  ["1794680", "Vampire Survivors"],
  ["632470", "Disco Elysium"],
  ["268910", "Cuphead"],
  ["1145350", "Hades II"],
  ["2379780", "Balatro"],
  ["1868140", "DAVE THE DIVER"],
  ["976730", "Halo: The Master Chief Collection"],
  ["1551360", "Forza Horizon 5"],
  ["2183900", "Warhammer 40,000: Space Marine 2"],
  ["1426210", "It Takes Two"],
  ["374320", "DARK SOULS III"],
  ["289070", "Sid Meier's Civilization VI"],
  ["427520", "Factorio"],
  ["892970", "Valheim"],
  ["1966720", "Lethal Company"],
  ["239140", "Dying Light"],
  ["1172470", "Apex Legends"],
  ["730", "Counter-Strike 2"],
].map(([id, title], index) => ({
  id: `steam:${id}`,
  title,
  source: "steam",
  launch: "",
  cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  // Enough installed games to fill Home's row past the screen edge.
  installed: index < 11,
}));
demoGames.push({
  id: `custom:${Date.UTC(2026, 9, 1)}`,
  title: "RetroArch",
  source: "custom",
  launch: "",
  cover: null,
  installed: true,
});
demoGames.push({
  id: "epic:demo-control",
  title: "Control",
  source: "epic",
  launch: "",
  cover:
    "https://cdn.cloudflare.steamstatic.com/steam/apps/870780/library_600x900.jpg",
  installed: true,
});

export type Provider = "steam" | "epic";
export const providers: Provider[] = ["steam", "epic"];
type Progress = { downloaded: number; total: number; installed: boolean };
const pendingInstallsKey = "pending-installs";
/** Everything under "library" is refreshed together. */
const keys = {
  all: ["library"] as const,
  installed: ["library", "installed"] as const,
  gog: ["library", "gog"] as const,
  owned: (provider: Provider) => ["library", provider] as const,
};

/** Owned games from the provider's saved session; null when it isn't connected. */
async function ownedLibrary(provider: Provider): Promise<Game[] | null> {
  if (demo) return demoGames.filter((game) => game.source === provider);
  if (!isTauri()) return null;
  try {
    return await invoke<Game[]>(`connect_${provider}_library`, {
      signIn: false,
    });
  } catch (error) {
    if (
      ["notConnected", `${provider}SessionExpired`].includes(
        serviceError(error),
      )
    )
      return null;
    throw error;
  }
}

/** One store account: owned games, sign-in on the store's own page and sign-out. */
function useAccount(provider: Provider, onStatus: Notify) {
  const queryClient = useQueryClient();
  const owned = useQuery({
    queryKey: keys.owned(provider),
    queryFn: () => ownedLibrary(provider),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connect = useMutation({
    mutationFn: () =>
      invoke<Game[]>(`connect_${provider}_library`, { signIn: true }),
    onSuccess: (games) => {
      // Also clears any error from the startup restore attempt.
      queryClient.setQueryData(keys.owned(provider), games);
      onStatus(
        games.length
          ? `${provider}LibraryConnected`
          : `${provider}NoOwnedGames`,
        { count: String(games.length) },
      );
    },
    onError: (error) => {
      const status = httpStatus(error);
      if (status) onStatus("serviceStatus", { status });
      else onStatus(serviceError(error));
    },
  });
  const disconnect = useMutation({
    mutationFn: () => invoke(`disconnect_${provider}_library`),
    onSuccess: () => {
      queryClient.setQueryData(keys.owned(provider), null);
      onStatus(`${provider}LibraryDisconnected`);
    },
    onError: (error) => onStatus(serviceError(error)),
  });
  return {
    owned: owned.data ?? null,
    connected: owned.data != null,
    error: owned.error ? serviceError(owned.error) : null,
    busy: connect.isPending || disconnect.isPending || owned.isPending,
    connect: () => connect.mutate(),
    disconnect: () => disconnect.mutate(),
  };
}

/**
 * Installed games plus owned Steam and Epic games, with store sign-in and the polling
 * that confirms installs started in the launchers.
 */
export function useLibrary(onStatus: Notify) {
  const queryClient = useQueryClient();
  const [pendingInstalls, setPendingInstalls] = useState(() =>
    parsePendingInstalls(localStorage.getItem(pendingInstallsKey)),
  );
  useEffect(() => {
    localStorage.setItem(pendingInstallsKey, JSON.stringify(pendingInstalls));
  }, [pendingInstalls]);
  const pending = pendingInstalls.length > 0;
  const installed = useQuery({
    queryKey: keys.installed,
    queryFn: () =>
      demo
        ? demoGames.filter((game) => game.installed)
        : isTauri()
          ? invoke<Game[]>("scan_library")
          : [],
    // Rescanned on demand, and every few seconds while a launcher installs.
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: pending ? 4000 : false,
    refetchOnWindowFocus: pending,
  });
  const steam = useAccount("steam", onStatus);
  const epic = useAccount("epic", onStatus);
  const gog = useQuery({
    queryKey: keys.gog,
    queryFn: () => invoke<Game[]>("gog_owned_library"),
    enabled: isTauri() && !demo,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Steam's manifest reports each download; Sofa comes back in front once one has started.
  const pendingKey = pendingInstalls.map((entry) => entry.id).join(",");
  const progress = useQuery({
    queryKey: ["install_progress", pendingKey],
    queryFn: () =>
      invoke<Record<string, Progress>>("install_progress", {
        ids: pendingKey.split(","),
      }),
    enabled: pendingKey !== "" && isTauri() && !demo,
    refetchInterval: 2000,
  });
  const focused = useRef(new Set<string>());
  useEffect(() => {
    for (const id of focused.current) {
      if (!pendingInstalls.some((entry) => entry.id === id))
        focused.current.delete(id);
    }
  }, [pendingInstalls]);
  useEffect(() => {
    const started = Object.keys(progress.data ?? {}).filter(
      (id) => !focused.current.has(id),
    );
    if (!started.length) return;
    for (const id of started) focused.current.add(id);
    void invoke("focus_main").catch(() => undefined);
  }, [progress.data]);
  const finished = Object.values(progress.data ?? {}).some((p) => p.installed);
  useEffect(() => {
    if (finished)
      void queryClient.invalidateQueries({ queryKey: keys.installed });
  }, [finished, queryClient]);

  // Each scan settles pending launcher work; never claim it before the scan shows it.
  const scanned = installed.data;
  useEffect(() => {
    if (!scanned) return;
    const now = Date.now();
    const done = pendingInstalls.filter((entry) =>
      scanned.some((g) => g.id === entry.id),
    );
    if (
      done.length ||
      pendingInstalls.some((entry) => now - entry.started >= pendingLifetime)
    ) {
      setPendingInstalls((entries) =>
        entries.filter(
          (entry) =>
            now - entry.started < pendingLifetime &&
            !done.some((item) => item.id === entry.id),
        ),
      );
      if (done.length) onStatus("installComplete");
    }
  }, [scanned, pendingInstalls, onStatus]);

  const games = useMemo(
    () =>
      mergeLibrary(installed.data ?? [], [
        ...(steam.owned ?? []),
        ...(epic.owned ?? []),
        ...(gog.data ?? []),
      ]),
    [installed.data, steam.owned, epic.owned, gog.data],
  );
  return {
    games,
    accounts: { steam, epic },
    /** The first scan hasn't answered yet; later rescans keep the games on screen. */
    loading: installed.isPending,
    /** Any scan in flight, for the refresh button. */
    refreshing: installed.isFetching,
    /** The first scan of installed games has finished. */
    scanned: installed.isSuccess,
    scanError: installed.error ? serviceError(installed.error) : ("" as const),
    refresh: () => queryClient.invalidateQueries({ queryKey: keys.all }),
    downloads: pendingInstalls.flatMap(({ id }) => {
      const p = progress.data?.[id];
      const game = games.find((g) => g.id === id);
      return game
        ? [
            {
              game,
              downloaded: p?.total ? p.downloaded : undefined,
              total: p?.total || undefined,
              percent: p?.total
                ? Math.min(100, Math.round((p.downloaded / p.total) * 100))
                : undefined,
            },
          ]
        : [];
    }),
    watchInstall: (id: string) =>
      setPendingInstalls((entries) =>
        entries.some((entry) => entry.id === id)
          ? entries
          : [...entries, { id, started: Date.now() }],
      ),
    stopWatchingInstall: (id: string) =>
      setPendingInstalls((entries) =>
        entries.filter((entry) => entry.id !== id),
      ),
  };
}
