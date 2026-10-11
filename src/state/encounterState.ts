import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEncounter, setEncounterState } from "../api/encounters";
import { createAutosaver, type SaveStatus } from "../lib/autosave";
import { newSeed } from "../lib/dice/rng";
import type { Outcome } from "../lib/encounters/engine";
import { newEncounterState, parseEncounterState, type EncounterState } from "../lib/encounters/state";
import { mainRules, type ProjectRules } from "../lib/rulesets/projectRules";
import { bumpDataVersion } from "./dataVersion";
import { useProjectRules } from "./projectRules";

export interface EncounterHandle {
  /** Null while loading, or when the saved state can't be read (see `problem`). */
  state: EncounterState | null;
  /** The ruleset rules the encounter's statuses and initiative come from (the project's main ruleset), or null. */
  rules: ProjectRules | null;
  /** Why the saved state can't be used, if so. */
  problem: string | null;
  /** The last change that was refused, as a sentence (cleared by the next change that works). */
  message: string | null;
  status: SaveStatus;
  /** Makes a change with one of the engine's functions; a refusal shows up as `message`. */
  apply: (change: (state: EncounterState) => Outcome) => boolean;
  /** Throws the saved state away and starts a new, empty encounter (for a state that can't be read). */
  startOver: () => void;
  /** The state as of the latest change, even before React has shown it (for acting on it right away). */
  latest: () => EncounterState | null;
}

/**
 * An encounter's state, loaded, changed one engine step at a time and saved after a short pause. Every change goes
 * through `apply`, so the rules in `lib/encounters/engine.ts` are the only way the state moves; the screen holds no
 * encounter logic of its own.
 */
export function useEncounter(itemId: string, projectId: string): EncounterHandle {
  const { rules: allRules, loading: rulesLoading } = useProjectRules(projectId);
  const rules = mainRules(allRules);
  const [state, setState] = useState<EncounterState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const stateRef = useRef<EncounterState | null>(null);
  const [loaded, setLoaded] = useState<{ record: string | null } | null>(null);

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (text) => {
          await setEncounterState(itemId, text);
          bumpDataVersion();
        },
        delayMs: 300,
        onStatus: setStatus,
      }),
    [itemId],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;

  // Load once.
  useEffect(() => {
    let active = true;
    getEncounter(itemId)
      .then((record) => active && setLoaded({ record: record ? record.stateJson : null }))
      .catch((e) => {
        if (active) {
          setProblem(String(e));
          setLoaded({ record: "" });
        }
      });
    return () => {
      active = false;
      void saverRef.current.flush();
    };
  }, [itemId]);

  // Turn what was loaded into a state. A new encounter takes its initiative rules from the project's ruleset, so it waits for the rules.
  useEffect(() => {
    if (loaded === null || stateRef.current !== null || problem !== null) return;
    if (loaded.record === "") return;
    if (loaded.record === null) {
      if (rulesLoading) return;
      const init = rules?.ruleset.encounter.initiative;
      const fresh = newEncounterState(newSeed(), init ? { initiativeType: init.type, order: init.order, formula: init.formula } : {});
      stateRef.current = fresh;
      setState(fresh);
      return;
    }
    const read = parseEncounterState(loaded.record);
    if (read.ok) {
      stateRef.current = read.state;
      setState(read.state);
    } else {
      setProblem(read.error);
    }
  }, [loaded, rules, rulesLoading, problem]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const apply = useCallback((change: (s: EncounterState) => Outcome): boolean => {
    const current = stateRef.current;
    if (!current) return false;
    const outcome = change(current);
    if (!outcome.ok) {
      setMessage(outcome.message);
      return false;
    }
    stateRef.current = outcome.state;
    setState(outcome.state);
    setMessage(null);
    saverRef.current.change(JSON.stringify(outcome.state));
    return true;
  }, []);

  const startOver = useCallback(() => {
    const fresh = newEncounterState(newSeed());
    stateRef.current = fresh;
    setProblem(null);
    setState(fresh);
    saverRef.current.change(JSON.stringify(fresh));
  }, []);

  const latest = useCallback(() => stateRef.current, []);
  return { state, rules, problem, message, status, apply, startOver, latest };
}
