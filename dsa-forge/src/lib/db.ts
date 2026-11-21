/**
 * Data access layer for the DSA module.
 * MVP: uses in-memory seed data.
 * Production: replace with database queries.
 */

import { PATTERNS, TOP_COMPANIES, TOP_PROBLEMS, PLATFORM_STATS } from "./data/seed";
import { TIMEFRAME_LABELS } from "./constants";
import type { Pattern, PatternQuestion, Company, Problem, UserProgress, Timeframe, Difficulty, ProgressStatus } from "./types";
import { slugify } from "./utils";
import { auth, db as firestoreDb, isFirebaseConfigured } from "./firebase";
import { doc, setDoc, collection, getDocs } from "firebase/firestore";
import {
  getPatternProblems,
  matchesPatternValue,
  resolveProblemId,
  resolveProblemPattern,
} from "./pattern-map";

export { PATTERNS, TOP_COMPANIES, TOP_PROBLEMS, PLATFORM_STATS, TIMEFRAME_LABELS };
export { getPatternProblems, matchesPatternValue, resolveProblemId, resolveProblemPattern };
export type { UserProgress, Pattern, Company, Problem, Timeframe, Difficulty };

// ─── Patterns ─────────────────────────────────────────────────────────────────

export function getAllPatterns(): Pattern[] {
  return PATTERNS;
}

export function getPatternBySlug(slug: string): Pattern | undefined {
  return PATTERNS.find((p) => p.slug === slug);
}

export function getPatternStats() {
  return {
    total: PATTERNS.length,
    totalQuestions: PATTERNS.reduce((a, p) => a + p.questionCount, 0),
    totalCurated: PATTERNS.reduce((a, p) => a + p.questions.length, 0),
  };
}

// ─── Companies ────────────────────────────────────────────────────────────────

export function getAllCompanies(): Company[] {
  return TOP_COMPANIES;
}

export function getCompanyBySlug(slug: string): Company | undefined {
  return TOP_COMPANIES.find((c) => c.normalizedName === slug || slugify(c.name) === slug);
}

export function searchCompanies(query: string): Company[] {
  const q = query.toLowerCase();
  return TOP_COMPANIES.filter(
    (c) => c.name.toLowerCase().includes(q) || c.normalizedName.includes(q)
  );
}

// ─── Problems ─────────────────────────────────────────────────────────────────

export function getAllProblems(): Problem[] {
  return TOP_PROBLEMS;
}

export function getProblemBySlug(slug: string): Problem | undefined {
  const problem = TOP_PROBLEMS.find((p) => p.slug === slug);
  if (!problem) return undefined;

  // Runtime fallback: If primaryPattern is missing or "Uncategorized", resolve dynamically
  if (!problem.primaryPattern || problem.primaryPattern.toLowerCase() === "uncategorized") {
    const resolved = resolveProblemPattern(problem);
    if (resolved) {
      return {
        ...problem,
        primaryPattern: resolved.name,
      };
    }
  }

  return problem;
}

export function getProblemsForPattern(patternName: string): PatternQuestion[] {
  const pattern = PATTERNS.find(
    (p) => p.name.toLowerCase() === patternName.toLowerCase() || p.slug === slugify(patternName)
  );
  return pattern?.questions ?? [];
}

export function filterProblems(opts: {
  difficulty?: Difficulty[];
  pattern?: string;
  companySlug?: string;
  timeframe?: Timeframe;
  search?: string;
  platform?: string;
}): Problem[] {
  let problems = [...TOP_PROBLEMS];

  if (opts.difficulty?.length) {
    problems = problems.filter((p) => opts.difficulty!.includes(p.difficulty));
  }
  if (opts.pattern) {
    problems = problems.filter((p) => matchesPatternValue(p, opts.pattern!));
  }
  if (opts.companySlug) {
    problems = problems.filter((p) =>
      p.companies.includes(opts.companySlug!)
    );
  }
  if (opts.timeframe) {
    problems = problems.filter((p) => p.timeframes.includes(opts.timeframe!));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    problems = problems.filter((p) => p.title.toLowerCase().includes(q));
  }
  if (opts.platform) {
    problems = problems.filter((p) => p.platform === opts.platform);
  }

  return problems;
}

// ─── Progress & Notes ─────────────────────────────────────────────────────────

const PROGRESS_KEY = "dsaforge_progress";
export const GUEST_NOTES_KEY = "dsaforge_guest_notes";
export const NOTES_UPDATED_EVENT = "dsaforge:notes-updated";

/** Fired whenever persisted progress changes so every store can re-render. */
export const PROGRESS_UPDATED_EVENT = "dsaforge:progress-updated";

/** In-memory runtime cache for 0ms notes lookup across all views without storage delays. */
const notesCache: Record<string, string> = {};

export function setAllNotesCache(notes: Record<string, string>): void {
  for (const [k, v] of Object.entries(notes)) {
    notesCache[resolveProblemId(k)] = v;
  }
}

export function clearNotesCache(): void {
  for (const k of Object.keys(notesCache)) {
    delete notesCache[k];
  }
}

const STATUS_RANK: Record<ProgressStatus, number> = {
  todo: 0,
  attempted: 1,
  revise: 2,
  solved: 3,
};

export function isSolvedStatus(status?: string): boolean {
  return status === "solved" || status === "mastered";
}

/**
 * Rewrite legacy progress keys to the canonical dataset problem id.
 *
 * The pattern pages used to store progress under curated roadmap ids
 * ("tp-1", "sw-1") while the question pages used dataset ids ("167"), so the
 * same problem lived under two keys and the mastery breakdown never updated.
 */
function canonicalizeProgress(
  progress: Record<string, UserProgress>
): Record<string, UserProgress> {
  const out: Record<string, UserProgress> = {};

  for (const [key, entry] of Object.entries(progress)) {
    if (!entry || typeof entry !== "object") continue;

    const canonicalKey = resolveProblemId(key);
    const status = (entry.status ?? "todo") as ProgressStatus;
    const normalized: UserProgress = {
      problemId: canonicalKey,
      status,
      revisionCount: entry.revisionCount ?? 0,
      lastAttemptedAt: entry.lastAttemptedAt ?? new Date().toISOString(),
    };
    if (entry.notes !== undefined && entry.notes !== null) {
      normalized.notes = entry.notes;
    }
    if (entry.solvedAt !== undefined && entry.solvedAt !== null) {
      normalized.solvedAt = entry.solvedAt;
    }

    const existing = out[canonicalKey];
    if (!existing) {
      out[canonicalKey] = normalized;
      continue;
    }

    // Two keys collapsed into one — keep the strongest status and the latest data.
    const keepNew =
      STATUS_RANK[status] >= STATUS_RANK[existing.status ?? "todo"];
    const winner = keepNew ? normalized : existing;
    const loser = keepNew ? existing : normalized;

    const merged: UserProgress = {
      ...loser,
      ...winner,
      status:
        STATUS_RANK[status] > STATUS_RANK[existing.status ?? "todo"]
          ? status
          : existing.status ?? "todo",
      revisionCount: Math.max(
        existing.revisionCount ?? 0,
        normalized.revisionCount ?? 0
      ),
      lastAttemptedAt:
        winner.lastAttemptedAt && loser.lastAttemptedAt
          ? winner.lastAttemptedAt > loser.lastAttemptedAt
            ? winner.lastAttemptedAt
            : loser.lastAttemptedAt
          : winner.lastAttemptedAt ?? loser.lastAttemptedAt ?? new Date().toISOString(),
    };

    const mergedNotes = winner.notes ?? loser.notes;
    if (mergedNotes !== undefined && mergedNotes !== null) {
      merged.notes = mergedNotes;
    } else {
      delete merged.notes;
    }

    const mergedSolvedAt = winner.solvedAt ?? loser.solvedAt;
    if (mergedSolvedAt !== undefined && mergedSolvedAt !== null) {
      merged.solvedAt = mergedSolvedAt;
    } else {
      delete merged.solvedAt;
    }

    out[canonicalKey] = merged;
  }

  return out;
}

export function loadProgress(): Record<string, UserProgress> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, UserProgress>;
    const canonical = canonicalizeProgress(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(canonical)) {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(canonical));
    }
    return canonical;
  } catch {
    return {};
  }
}

export const getLocalProgress = loadProgress;

/**
 * Cached snapshot for `useSyncExternalStore`.
 * The reference must stay stable between reads, otherwise React re-renders forever.
 */
let progressCache: Record<string, UserProgress> | null = null;

export const EMPTY_PROGRESS: Record<string, UserProgress> = {};

export function getProgressSnapshot(): Record<string, UserProgress> {
  if (typeof window === "undefined") return EMPTY_PROGRESS;
  if (!progressCache) progressCache = loadProgress();
  return progressCache;
}

/** Drop the cached snapshot so the next read comes from storage. */
export function invalidateProgressCache(): void {
  progressCache = null;
}

export function saveProgress(progress: Record<string, UserProgress>, skipCloudSync = false): void {
  if (typeof window === "undefined") return;
  const canonical = canonicalizeProgress(progress);
  progressCache = canonical;

  // Protect browser localStorage from 5MB quota exhaustion:
  // If user is logged in, strip heavy formatted notes from localStorage so it stays lightweight (~90 bytes per problem).
  // Heavy notes are securely stored in Firestore under users/{uid}/notes.
  const isUserLoggedIn = Boolean(auth?.currentUser);
  if (isUserLoggedIn) {
    const lean: Record<string, UserProgress> = {};
    for (const [k, v] of Object.entries(canonical)) {
      const { notes: _, ...rest } = v;
      lean[k] = rest;
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(lean));
  } else {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(canonical));
  }

  // Notify every mounted progress store so counts update without a reload.
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));

  if (!skipCloudSync && typeof window !== "undefined" && auth?.currentUser && firestoreDb && isFirebaseConfigured) {
    try {
      const userDocRef = doc(firestoreDb, "users", auth.currentUser.uid);
      // Strip all undefined properties recursively so Firestore never throws
      const cleanProgress = JSON.parse(JSON.stringify(canonical));
      setDoc(
        userDocRef,
        {
          progress: cleanProgress,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch((err) => console.warn("[Firestore] Progress sync error:", err));
    } catch (err) {
      console.warn("[Firestore] Progress sync exception caught:", err);
    }
  }
}

export function resetProgress(skipCloudSync = false): void {
  if (typeof window === "undefined") return;
  progressCache = {};
  clearNotesCache();
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(GUEST_NOTES_KEY);
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));

  if (!skipCloudSync && typeof window !== "undefined" && auth?.currentUser && firestoreDb && isFirebaseConfigured) {
    try {
      const userDocRef = doc(firestoreDb, "users", auth.currentUser.uid);
      setDoc(
        userDocRef,
        {
          progress: {},
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch((err) => console.warn("[Firestore] Progress reset error:", err));
    } catch (err) {
      console.warn("[Firestore] Progress reset exception caught:", err);
    }
  }
}

/**
 * Gets notes for a problem with 0ms in-memory cache, falling back to guest localStorage or local progress.
 */
export function getProblemNotes(problemId: string): string {
  const canonicalId = resolveProblemId(problemId);
  if (notesCache[canonicalId] !== undefined) {
    return notesCache[canonicalId];
  }

  if (typeof window === "undefined") return "";

  // 1. Check guest notes store
  try {
    const rawGuest = localStorage.getItem(GUEST_NOTES_KEY);
    if (rawGuest) {
      const guestNotes = JSON.parse(rawGuest);
      if (guestNotes[canonicalId] !== undefined) {
        notesCache[canonicalId] = guestNotes[canonicalId];
        return guestNotes[canonicalId];
      }
    }
  } catch {}

  // 2. Check local progress entry
  try {
    const local = loadProgress();
    if (local[canonicalId]?.notes) {
      notesCache[canonicalId] = local[canonicalId].notes!;
      return local[canonicalId].notes!;
    }
  } catch {}

  return "";
}

/**
 * Saves notes for a problem:
 * - If user is logged in: saves directly to Cloud Firestore (users/{uid}/notes/{problemId}) and in-memory cache, keeping localStorage lean.
 * - If user is guest: saves locally in localStorage (dsaforge_guest_notes) until they sign in.
 */
export async function saveProblemNotes(problemId: string, notes: string): Promise<void> {
  const canonicalId = resolveProblemId(problemId);
  notesCache[canonicalId] = notes;

  if (progressCache && progressCache[canonicalId]) {
    progressCache[canonicalId].notes = notes;
  }

  if (typeof window === "undefined") return;

  const currentUser = auth?.currentUser;
  if (currentUser && firestoreDb && isFirebaseConfigured) {
    // 1. Authenticated user: Save note to Firestore cloud subcollection
    try {
      const noteDocRef = doc(firestoreDb, "users", currentUser.uid, "notes", canonicalId);
      await setDoc(
        noteDocRef,
        {
          problemId: canonicalId,
          content: notes,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Strip from localStorage to keep client storage lean and prevent 5MB quota exhaustion
      const local = loadProgress();
      if (local[canonicalId]?.notes) {
        delete local[canonicalId].notes;
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(local));
      }
    } catch (err) {
      console.warn("[Firestore] Failed to save note to cloud:", err);
    }
  } else {
    // 2. Guest user: Save locally in browser storage
    try {
      const rawGuest = localStorage.getItem(GUEST_NOTES_KEY);
      const guestNotes = rawGuest ? JSON.parse(rawGuest) : {};
      guestNotes[canonicalId] = notes;
      localStorage.setItem(GUEST_NOTES_KEY, JSON.stringify(guestNotes));

      const local = loadProgress();
      if (local[canonicalId]) {
        local[canonicalId].notes = notes;
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(local));
      }
    } catch (err) {
      console.warn("[Storage] Failed to save guest note:", err);
    }
  }

  window.dispatchEvent(
    new CustomEvent(NOTES_UPDATED_EVENT, { detail: { problemId: canonicalId, notes } })
  );
  window.dispatchEvent(new Event(PROGRESS_UPDATED_EVENT));
}

/**
 * Loads all notes for a user from Firestore cloud and seeds the 0ms in-memory cache.
 */
export async function loadUserNotesFromCloud(uid: string): Promise<Record<string, string>> {
  if (!firestoreDb || !isFirebaseConfigured) return {};
  try {
    const notesColl = collection(firestoreDb, "users", uid, "notes");
    const snap = await getDocs(notesColl);
    const notesMap: Record<string, string> = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data?.content !== undefined) {
        notesMap[docSnap.id] = data.content;
      }
    });

    setAllNotesCache(notesMap);
    return notesMap;
  } catch (err) {
    console.warn("[Firestore] Error loading user notes:", err);
    return {};
  }
}

/**
 * Migrates any local guest notes into Firestore cloud whenever a user logs in.
 */
export async function migrateGuestNotesToCloud(uid: string): Promise<void> {
  if (typeof window === "undefined" || !firestoreDb || !isFirebaseConfigured) return;
  try {
    const rawGuest = localStorage.getItem(GUEST_NOTES_KEY);
    const guestNotes: Record<string, string> = rawGuest ? JSON.parse(rawGuest) : {};

    // Also check legacy progress for any notes
    const local = loadProgress();
    for (const [k, v] of Object.entries(local)) {
      if (v.notes && !guestNotes[k]) {
        guestNotes[k] = v.notes;
      }
    }

    const keys = Object.keys(guestNotes);
    if (keys.length === 0) return;

    for (const problemId of keys) {
      const content = guestNotes[problemId];
      if (content) {
        const canonicalId = resolveProblemId(problemId);
        const noteDocRef = doc(firestoreDb, "users", uid, "notes", canonicalId);
        await setDoc(
          noteDocRef,
          {
            problemId: canonicalId,
            content,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        notesCache[canonicalId] = content;
      }
    }

    // Clear guest notes key from browser storage
    localStorage.removeItem(GUEST_NOTES_KEY);

    // Strip notes from local progress to keep localStorage clean
    let modified = false;
    for (const k of Object.keys(local)) {
      if (local[k].notes) {
        delete local[k].notes;
        modified = true;
      }
    }
    if (modified) {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(local));
    }
  } catch (err) {
    console.warn("[Firestore] Failed to migrate guest notes to cloud:", err);
  }
}

export function updateProblemStatus(
  problemId: string,
  status: UserProgress["status"],
  notes?: string
): UserProgress {
  const all = loadProgress();
  const canonicalId = resolveProblemId(problemId);
  const existing = all[canonicalId];

  const updated: UserProgress = {
    problemId: canonicalId,
    status,
    revisionCount: existing?.revisionCount ?? 0,
    lastAttemptedAt: new Date().toISOString(),
  };

  if (notes !== undefined) {
    saveProblemNotes(canonicalId, notes).catch(() => {});
  }

  const currentNote = notes !== undefined ? notes : getProblemNotes(canonicalId);
  if (currentNote && !auth?.currentUser) {
    updated.notes = currentNote;
  }

  const resolvedSolvedAt =
    status === "solved"
      ? existing?.solvedAt ?? new Date().toISOString()
      : existing?.solvedAt;
  if (resolvedSolvedAt !== undefined && resolvedSolvedAt !== null) {
    updated.solvedAt = resolvedSolvedAt;
  }

  if (status === "revise") {
    updated.revisionCount = (existing?.revisionCount ?? 0) + 1;
  }

  all[canonicalId] = updated;
  saveProgress(all);
  return updated;
}

export function getProgressStats(progress: Record<string, UserProgress>) {
  const statuses = Object.values(progress);
  return {
    solved: statuses.filter((s) => isSolvedStatus(s.status)).length,
    attempted: statuses.filter((s) => s.status === "attempted").length,
    revise: statuses.filter((s) => s.status === "revise").length,
    todo: statuses.filter((s) => s.status === "todo").length,
  };
}

/* ─── Solved problem helpers ──────────────────────────────────────────────── */

/** Every problem the user has marked solved, in dataset order. */
export function getSolvedProblems(
  progress: Record<string, UserProgress>
): Problem[] {
  return TOP_PROBLEMS.filter((p) => isSolvedStatus(progress[p.id]?.status));
}

/** Solved problems for one difficulty ("Easy" | "Medium" | "Hard"). */
export function getSolvedProblemsByDifficulty(
  progress: Record<string, UserProgress>,
  difficulty: Difficulty
): Problem[] {
  return getSolvedProblems(progress).filter((p) => p.difficulty === difficulty);
}

export interface PatternMastery {
  pattern: Pattern;
  solved: number;
  total: number;
  pct: number;
}

/** Per-pattern solved/total, used by the mastery breakdown on the progress page. */
export function getPatternMastery(
  progress: Record<string, UserProgress>
): PatternMastery[] {
  return [...PATTERNS]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((pattern) => {
      const problems = getPatternProblems(pattern);
      const solved = problems.filter((p) =>
        isSolvedStatus(progress[p.id]?.status)
      ).length;
      const pct = problems.length ? Math.round((solved / problems.length) * 100) : 0;
      return { pattern, solved, total: problems.length, pct };
    });
}

// ─── Platform Stats ───────────────────────────────────────────────────────────

export function getPlatformStats() {
  return PLATFORM_STATS;
}

// ─── Company Helpers ─────────────────────────────────────────────────────────

export function getCompanyProblems(companyIdOrSlug: string) {
  const company = TOP_COMPANIES.find(c => c.id === companyIdOrSlug || c.normalizedName === companyIdOrSlug || slugify(c.name) === companyIdOrSlug);
  const companySlug = company?.normalizedName || companyIdOrSlug;

  return TOP_PROBLEMS.filter(p => p.companies.includes(companySlug) || p.companies.some(c => c.toLowerCase().includes(companySlug.toLowerCase())))
    .map(p => ({
      problem: p,
      companyData: {
        companyId: company?.id || companySlug,
        companyName: company?.name || companySlug,
        timeframe: p.timeframes[0] || ("30d" as Timeframe),
        frequencyWeight: p.frequency
      }
    }));
}

// ─── Roadmap ──────────────────────────────────────────────────────────────────

export function getRoadmapProblems(timeframe: Timeframe, targetCompanies?: string[]) {
  let problems = TOP_PROBLEMS.filter((p) => p.timeframes.includes(timeframe));
  if (targetCompanies?.length) {
    problems = problems.filter((p) =>
      p.companies.some((c) => targetCompanies.includes(c))
    );
  }
  return problems.sort((a, b) => b.priorityScore - a.priorityScore);
}

export function generateRoadmap({ targetDays, targetCompanyTier }: { targetDays: number; targetCompanyTier?: string }) {
  const phases = [
    {
      phase: 1,
      days: `1 - ${Math.round(targetDays * 0.3)}`,
      title: "Core Foundation & High-Frequency Patterns",
      patterns: ["two-pointers", "sliding-window", "hash-map-set"],
      problemCount: Math.round(TOP_PROBLEMS.length * 0.3),
    },
    {
      phase: 2,
      days: `${Math.round(targetDays * 0.3) + 1} - ${Math.round(targetDays * 0.7)}`,
      title: "Advanced Data Structures & Traversal",
      patterns: ["binary-tree-traversal", "graph-bfs-dfs", "binary-search"],
      problemCount: Math.round(TOP_PROBLEMS.length * 0.4),
    },
    {
      phase: 3,
      days: `${Math.round(targetDays * 0.7) + 1} - ${targetDays}`,
      title: "Dynamic Programming & Optimization Sprint",
      patterns: ["dynamic-programming", "monotonic-stack", "heap-priority-queue"],
      problemCount: Math.round(TOP_PROBLEMS.length * 0.3),
    },
  ];

  return phases;
}

// ─── Smart Next ────────────────────────────────────────────────────────────────

export function getSmartNext(
  progress: Record<string, UserProgress>,
  targetCompanies: string[],
  timeframe: Timeframe
): Problem | null {
  const unsolved = TOP_PROBLEMS.filter(
    (p) => !progress[p.id] || progress[p.id].status === "todo"
  );

  const scored = unsolved.map((p) => ({
    problem: p,
    score:
      p.priorityScore +
      (p.companies.filter((c) => targetCompanies.includes(c)).length * 0.1) +
      (p.timeframes.includes(timeframe) ? 0.2 : 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.problem ?? TOP_PROBLEMS[0] ?? null;
}

export function getSmartNextProblem(): Problem | null {
  return getSmartNext(loadProgress(), [], "30d");
}


