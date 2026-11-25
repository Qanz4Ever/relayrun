import React, { useCallback, useEffect, useState } from 'react';
import { Blueprint, BlueprintCategory, BlueprintStepInput } from '../shared/types';
import { createBlueprint, fetchBlueprints, launchRun } from './lib/api';
import {
  getRecentRuns,
  getStoredAlias,
  getStoredTheme,
  SavedRunRef,
  saveOperatorKeyForRun,
  setStoredAlias,
  setStoredTheme
} from './lib/localStore';
import { TopBar } from './components/TopBar';
import { BlueprintBuilderModal } from './components/BlueprintBuilderModal';
import { DeckHome } from './pages/DeckHome';
import { LiveRunRoom } from './pages/LiveRunRoom';

function parseRoute(pathname: string): { page: 'home' } | { page: 'run'; code: string } {
  const runMatch = pathname.match(/^\/run\/([A-Za-z0-9_-]+)/);
  if (runMatch) {
    return { page: 'run', code: runMatch[1].toUpperCase() };
  }
  return { page: 'home' };
}

export const App: React.FC = () => {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [alias, setAlias] = useState(() => getStoredAlias());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getStoredTheme());
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loadingBlueprints, setLoadingBlueprints] = useState(true);
  const [blueprintsError, setBlueprintsError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<SavedRunRef[]>(() => getRecentRuns());
  const [builderTarget, setBuilderTarget] = useState<{ open: boolean; forkFrom?: Blueprint | null }>({
    open: false
  });
  const [edgeColo, setEdgeColo] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
      setRecentRuns(getRecentRuns());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadDeck = useCallback(async () => {
    setLoadingBlueprints(true);
    try {
      const [bps, health] = await Promise.all([
        fetchBlueprints(),
        fetch('/api/health')
          .then((r) => r.json() as Promise<{ colo?: string }>)
          .catch(() => null)
      ]);
      setBlueprints(bps);
      if (health && typeof health.colo === 'string') {
        setEdgeColo(health.colo);
      }
      setBlueprintsError(null);
    } catch (err) {
      setBlueprintsError(err instanceof Error ? err.message : 'Failed to load blueprints');
    } finally {
      setLoadingBlueprints(false);
    }
  }, []);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(parseRoute(new URL(path, window.location.origin).pathname));
    setRecentRuns(getRecentRuns());
  };

  const handleAliasChange = (next: string) => {
    setAlias(next);
    setStoredAlias(next);
  };

  const handleLaunchBlueprint = async (bp: Blueprint, envLabel: string) => {
    const result = await launchRun({
      blueprint_id: bp.id,
      title: bp.title,
      environment_label: envLabel,
      actor_alias: alias
    });
    saveOperatorKeyForRun(
      result.run.run_code,
      result.run.title,
      result.run.environment_label,
      result.operatorKey
    );
    navigate(`/run/${result.run.run_code}?key=${result.operatorKey}`);
    loadDeck();
  };

  const handleSaveBlueprint = async (payload: {
    title: string;
    summary: string;
    category: BlueprintCategory;
    forked_from_id?: string | null;
    steps: BlueprintStepInput[];
  }) => {
    await createBlueprint(payload);
    setBuilderTarget({ open: false });
    await loadDeck();
  };

  return (
    <div className="min-h-screen cue-grid-bg">
      <TopBar
        alias={alias}
        onChangeAlias={handleAliasChange}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        onNavigateHome={() => navigate('/')}
        onJoinCode={(code) => navigate(`/run/${code}`)}
        edgeColo={edgeColo}
      />

      {route.page === 'home' ? (
        <DeckHome
          blueprints={blueprints}
          loading={loadingBlueprints}
          error={blueprintsError}
          recentRuns={recentRuns}
          onLaunchBlueprint={handleLaunchBlueprint}
          onOpenBuilder={(forkFrom) => setBuilderTarget({ open: true, forkFrom })}
          onOpenRun={(code) => navigate(`/run/${code}`)}
          edgeColo={edgeColo}
        />
      ) : (
        <LiveRunRoom
          runCode={route.code}
          alias={alias}
          onBackHome={() => navigate('/')}
        />
      )}

      {builderTarget.open && (
        <BlueprintBuilderModal
          initialBlueprint={builderTarget.forkFrom}
          onClose={() => setBuilderTarget({ open: false })}
          onSave={handleSaveBlueprint}
        />
      )}
    </div>
  );
};
