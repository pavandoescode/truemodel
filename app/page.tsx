'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { CustomSelect } from '@/components/CustomSelect';
import { DragDropModelMapper, CLAUDE_CODE_SLOTS, OPENCODE_SLOTS } from '@/components/DragDropModelMapper';
import { SaveTargetPicker } from '@/components/SaveTargetPicker';
import type { SaveTarget } from '@/components/SaveTargetPicker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { isHardDiscoveryFailure, listModels } from '@/lib/models';
import { testModel } from '@/lib/modelTest';
import { forEachModel } from '@/lib/runner';
import { aggregateVerdict, countTokens, tokenizerBaseline, verifyModelIdentity } from '@/lib/identity';
import { histogram, medianDistribution, sampleRandomNumbers, cohortDivergenceThreshold } from '@/lib/randomFingerprint';
import { cohortStyleThreshold, medianStyleVector, styleDivergence, styleFeatures, styleSignal } from '@/lib/stylometry';
import { classifyError } from '@/lib/errors';
import { pluralize, downloadFile } from '@/lib/format';
import { buildReceiptMarkdown, receiptFilename } from '@/lib/receipt';
import { defaultConfig, loadConfig, saveConfig } from '@/lib/simpleStorage';
import { presetForEndpoint } from '@/lib/providers/presets';
import {
  configFromProfile,
  deleteProfile,
  emptyMappings,
  findProfileByEndpoint,
  loadProfiles,
  profileHost,
  upsertProfile,
  type SavedProfile,
} from '@/lib/profiles';
import { LatencySpread, type LatencyPoint } from '@/components/LatencySpread';
import { Modal } from '@/components/Modal';
import { ConnectionPanel, type ConnState } from '@/components/ConnectionPanel';
import { ModelTable, type RowResult } from '@/components/ModelTable';
import { GettingStarted } from '@/components/GettingStarted';
import { TraceConsole } from '@/components/TraceConsole';
import { clearTraces, subscribeToTraces, type RequestTrace } from '@/lib/requestTrace';
import { getEffectiveEndpoint } from '@/lib/endpoint';
import { buildClaudeSettingsJson } from '@/lib/claudeSettings';
import type { ApiError, IdentityReport, ModelInfo, ModelTestResult, ProviderConfig } from '@/lib/types';
import styles from './page.module.css';
import {
  Zap,
  Plug,
  FolderOpen,
  Search,
  Play,
  Save,
  Copy,
  Check,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings,
  X,
  ListChecks,
  MoreVertical,
  Pencil,
  KeyRound,
  Fingerprint,
  Download,
  BookOpen,
} from 'lucide-react';
import { useSettings } from '@/context/SettingsContext';

const DEFAULT_PROMPT = 'Reply with exactly one short sentence confirming you work.';

export default function Page(): ReactElement {
  const { settings, isClaudeActive } = useSettings();
  const [config, setConfig] = useState<ProviderConfig>(() => defaultConfig('anthropic'));
  const [persistKey, setPersistKey] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [conn, setConn] = useState<ConnState>('idle');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [connError, setConnError] = useState<ApiError | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [running, setRunning] = useState(false);
  const [concurrent, setConcurrent] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Identity verification: fingerprints each model to catch a provider that
  // advertises one model and serves another.
  const [identities, setIdentities] = useState<Record<string, IdentityReport>>({});
  const [identityRunning, setIdentityRunning] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState(false);
  // Opt-in: the random-number distributional fingerprint costs ~40 extra
  // requests per model, so it is off by default.
  const [deepFingerprint, setDeepFingerprint] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'passed' | 'failed' | 'suspect'>('all');
  const [modelTab, setModelTab] = useState<'text' | 'img' | 'all'>('text');

  // Modal & Save State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProvidersModalOpen, setIsProvidersModalOpen] = useState(false);
  const [mappings, setMappings] = useState({ opus: '', sonnet: '', haiku: '', fable: '' });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [cliTestStatus, setCliTestStatus] = useState<{status: 'idle' | 'running' | 'success' | 'error', output?: string}>({status: 'idle'});
  const [saveEndpoint, setSaveEndpoint] = useState('');
  const [saveApiKey, setSaveApiKey] = useState('');
  const [remark, setRemark] = useState('');
  const [saveTarget, setSaveTarget] = useState<SaveTarget>('claude-code');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'latency' | 'status'>('name');
  const [copied, setCopied] = useState(false);
  // Transient confirmation banner (e.g. after copying config to clipboard).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Saved provider profiles
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [appliedProfileId, setAppliedProfileId] = useState<string | null>(null);
  const [profileFormOpen, setProfileFormOpen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [openMoreMenuId, setOpenMoreMenuId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileRemark, setProfileRemark] = useState('');
  const [profileIncludeKey, setProfileIncludeKey] = useState(true);
  const [profileNotice, setProfileNotice] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Hydrate stored config
  useEffect(() => {
    const stored = loadConfig();
    setConfig(stored);
    setPersistKey(stored.apiKey.length > 0);
    setProfiles(loadProfiles());
    setMounted(true);
  }, []);

  // Persist config changes
  useEffect(() => {
    if (!mounted) return;
    saveConfig(config, persistKey);
  }, [config, persistKey, mounted]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // A saved key in Settings takes over the sidebar, so the panel below must
  // actually point at it — otherwise the saved key is cosmetic. The preset and
  // auth style are derived from the saved endpoint, never assumed: forcing
  // x-api-key here would break every Bearer-style reseller someone saves.
  useEffect(() => {
    if (!mounted || !isClaudeActive || !settings.claudeConfig) return;
    const cc = settings.claudeConfig;
    const preset = presetForEndpoint(cc.endpoint);
    const presetId = preset.id;
    const authStyle = preset.authStyle;
    setConfig((c) =>
      c.presetId === presetId && c.endpoint === cc.endpoint && c.apiKey === cc.apiKey && c.authStyle === authStyle
        ? c
        : { ...c, presetId, endpoint: cc.endpoint, apiKey: cc.apiKey, authStyle },
    );
    setConn('idle');
    setModels([]);
    setChecked({});
    setResults({});
    setConnError(null);
    setDetected(null);
    setProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isClaudeActive, settings.claudeConfig?.endpoint, settings.claudeConfig?.apiKey]);

  const patch = useCallback((patch: Partial<ProviderConfig>) => {
    if (isClaudeActive) return; // locked to the Settings-managed Claude config
    setConfig((c) => ({ ...c, ...patch }));
  }, [isClaudeActive]);

  // Compute effective config containing normalized endpoint
  const getEffectiveConfig = useCallback(() => {
    const effectiveEndpoint = getEffectiveEndpoint(config.endpoint, config.appendV1 ?? true);
    return { ...config, endpoint: effectiveEndpoint };
  }, [config]);

  const connect = useCallback(async () => {
    setConn('connecting');
    setConnError(null);
    setModels([]);
    setChecked({});
    setResults({});
    setDetected(null);
    const controller = new AbortController();
    const wireConfig = getEffectiveConfig();
    const listing = await listModels(wireConfig, { signal: controller.signal });
    const { models: found, response, isFallback } = listing;

    // A fallback lineup is only useful when discovery failed for a benign
    // reason (no /v1/models). A rejected key or a dead host would produce four
    // rows that are all guaranteed to fail — a false "Connected" reading.
    if (isHardDiscoveryFailure(listing)) {
      setConn('failed');
      setConnError(
        response.error ??
          classifyError({ status: response.status || null, message: response.statusText || 'Discovery failed.', provider: config.presetId }),
      );
      return;
    }

    if (found.length > 0) {
      setModels(found);
      setConn('connected');
      if (isFallback) {
        setDetected('No model list — probing a standard lineup');
      } else {
        const hdr = response.headers;
        if (Object.keys(hdr).some((k) => k.includes('openrouter'))) setDetected('OpenRouter');
        else if (Object.keys(hdr).some((k) => k.includes('litellm'))) setDetected('LiteLLM');
        else if (wireConfig.endpoint.includes('anthropic')) setDetected('Anthropic');
        else setDetected(null);
      }
    } else {
      setConn('failed');
      setConnError(
        response.error
          ? response.error
          : classifyError({ status: response.status || null, message: response.statusText || 'No models returned.', provider: config.presetId }),
      );
    }
  }, [config, getEffectiveConfig]);

  const disconnect = useCallback(() => {
    setConn('idle');
    setModels([]);
    setChecked({});
    setResults({});
    setConnError(null);
    setDetected(null);
    setProgress(null);
  }, []);

  // Tested models available for mapping (MUST ONLY SHOW MODELS THAT HAVE BEEN TESTED AND PASSED)
  const testedModelsForMapping = useMemo(() => {
    return models.filter((m) => results[m.id]?.status === 'pass' || results[m.id]?.status === 'partial');
  }, [models, results]);

  // How many passing models the profile form will capture: when editing an
  // existing profile we keep the models it was saved with, otherwise we take
  // whatever passed in the current session.
  const profileModelCount = useMemo(() => {
    if (!editingProfileId) return testedModelsForMapping.length;
    return profiles.find((p) => p.id === editingProfileId)?.testedModels.length ?? 0;
  }, [editingProfileId, profiles, testedModelsForMapping]);

  /* ---------------- Saved provider profiles ---------------- */

  // Connecting is deferred to an effect so `connect` closes over the freshly
  // applied config rather than the config it was created with.
  const [pendingConnect, setPendingConnect] = useState(false);
  // Model IDs to re-check once discovery finishes for an applied profile.
  const pendingCheckRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!pendingConnect) return;
    setPendingConnect(false);
    void connect();
  }, [pendingConnect, connect]);

  // Re-select the models this profile was saved with, once they are discovered.
  useEffect(() => {
    const wanted = pendingCheckRef.current;
    if (!wanted || models.length === 0) return;
    pendingCheckRef.current = null;
    const available = new Set(models.map((m) => m.id));
    const next: Record<string, boolean> = {};
    for (const id of wanted) if (available.has(id)) next[id] = true;
    if (Object.keys(next).length > 0) setChecked(next);
    const missing = wanted.filter((id) => !available.has(id));
    if (missing.length > 0) {
      setProfileNotice(
        `${missing.length} saved model${missing.length > 1 ? 's are' : ' is'} no longer offered by this endpoint: ${missing.join(', ')}`,
      );
    }
  }, [models]);

  const applyProfile = useCallback((profile: SavedProfile) => {
    setProfileNotice('');
    setSaveStatus('');
    disconnect();
    setConfig(configFromProfile(profile));
    setPersistKey(profile.apiKey.length > 0);
    setMappings({ ...emptyMappings(), ...profile.mappings });
    setAppliedProfileId(profile.id);
    if (!profile.apiKey) {
      setProfileNotice(`"${profile.name}" was saved without its API key — enter the key, then Connect.`);
      return;
    }
    pendingCheckRef.current = profile.testedModels;
    setPendingConnect(true);
  }, [disconnect]);

  const openProfileForm = useCallback((profileId?: string | React.MouseEvent<HTMLButtonElement>) => {
    let target;
    if (typeof profileId === 'string') {
      target = profiles.find((p) => p.id === profileId);
      setEditingProfileId(profileId);
    } else {
      const match = findProfileByEndpoint(profiles, config.endpoint);
      const current = appliedProfileId ? profiles.find((p) => p.id === appliedProfileId) : undefined;
      target = current ?? match;
      setEditingProfileId(target?.id ?? null);
    }
    const domainFallback = (() => {
      try { return new URL(config.endpoint.trim()).host; } catch { return ''; }
    })();
    setProfileName(target?.name ?? domainFallback);
    setProfileRemark(target?.remark ?? '');
    setProfileIncludeKey(target ? target.apiKey.length > 0 : true);
    setProfileNotice('');
    setProfileFormOpen(true);
  }, [profiles, config.endpoint, appliedProfileId]);

  const submitProfile = useCallback(() => {
    const name = profileName.trim();
    if (!name) {
      setProfileNotice('Give the profile a name first.');
      return;
    }
    if (!config.endpoint.trim()) {
      setProfileNotice('An endpoint is required.');
      return;
    }
    // Overwrite the profile with the same name or endpoint instead of
    // accumulating near-duplicates.
    let existing;
    let configToSave = config;
    let mappingsToSave = mappings;
    let modelsToSave = testedModelsForMapping.map((m) => m.id);

    if (editingProfileId) {
      existing = profiles.find((p) => p.id === editingProfileId);
      if (existing) {
        configToSave = configFromProfile(existing);
        mappingsToSave = existing.mappings;
        modelsToSave = existing.testedModels;
      }
    } else {
      const byName = profiles.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      existing = byName ?? findProfileByEndpoint(profiles, config.endpoint);
    }

    const { profiles: next, profile } = upsertProfile({
      id: existing?.id,
      name,
      remark: profileRemark,
      config: configToSave,
      testedModels: modelsToSave.length > 0 ? modelsToSave : (existing?.testedModels ?? []),
      mappings: mappingsToSave,
      includeKey: profileIncludeKey,
    });
    setProfiles(next);
    if (!editingProfileId) {
      setAppliedProfileId(profile.id);
    }
    setProfileFormOpen(false);
    setEditingProfileId(null);
    setProfileNotice(
      `${existing ? 'Updated' : 'Saved'} "${profile.name}" · ${profile.testedModels.length} tested model${profile.testedModels.length === 1 ? '' : 's'}` +
      (profileIncludeKey ? '' : ' · key not stored'),
    );
  }, [profileName, profileRemark, profileIncludeKey, config, profiles, mappings, testedModelsForMapping, editingProfileId]);

  const removeProfile = useCallback((id: string) => {
    setProfiles(deleteProfile(id));
    setPendingDeleteId(null);
    setAppliedProfileId((current) => (current === id ? null : current));
  }, []);

  const selectedCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);
  const testedCount = useMemo(
    () => Object.values(results).filter((r) => r.status === 'pass' || r.status === 'partial' || r.status === 'fail').length,
    [results],
  );
  const passedCount = useMemo(
    () => Object.values(results).filter((r) => r.status === 'pass' || r.status === 'partial').length,
    [results],
  );
  const failedCount = useMemo(
    () => Object.values(results).filter((r) => r.status === 'fail').length,
    [results],
  );

  /** Every successful reading, for the latency spread. */
  const latencyPoints = useMemo<LatencyPoint[]>(
    () =>
      Object.entries(results)
        .filter(([, r]) => (r.status === 'pass' || r.status === 'partial') && r.latencyMs)
        .map(([id, r]) => ({ id, latencyMs: r.latencyMs as number })),
    [results],
  );

  const runTests = useCallback(async () => {
    if (running || selectedCount === 0) return;
    const chosen = models.filter((m) => checked[m.id]);
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress({ done: 0, total: chosen.length });
    setResults((prev) => {
      const next = { ...prev };
      for (const m of chosen) next[m.id] = { status: 'pending' };
      return next;
    });

    const activeConfig = getEffectiveConfig();

    await forEachModel(chosen, concurrent, controller.signal, async (model) => {
      setResults((prev) => ({ ...prev, [model.id]: { status: 'running' } }));
      const result: ModelTestResult = await testModel({
        config: activeConfig,
        model: model.id,
        kind: 'basic',
        prompt,
        maxTokens: 64,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        // Cancelled mid-flight. "Not tested" is the honest state — leaving the
        // row on "Testing" would strand a spinner after Stop, and writing a
        // fail would report the user's own cancellation as the model's failure.
        setResults((prev) => ({ ...prev, [model.id]: { status: 'pending' } }));
        return;
      }
      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
      const rs = result.status === 'skip' ? 'fail' : result.status === 'pending' ? 'fail' : result.status;
      setResults((prev) => ({
        ...prev,
        [model.id]: {
          status: rs,
          latencyMs: result.latencyMs,
          tokensPerSec: result.tokensPerSec,
          text: result.text,
          error: result.error,
        },
      }));
    });
    setRunning(false);
    abortRef.current = null;
  }, [getEffectiveConfig, models, checked, prompt, running, selectedCount, concurrent]);

  /**
   * Fingerprint each selected model.
   *
   * Sequential by default: the probe fires roughly nine requests per model, so
   * firing every model at once trips provider rate limits, and a 429 mid-probe
   * reads as a failed signal rather than as the throttle it is. The concurrency
   * toggle opts into that risk for endpoints that can take it — it is the same
   * switch the plain test run uses, and it changes nothing about what is
   * measured: each model's three runs still go out in order inside its own
   * probe, so run-to-run consistency stays a property of one model's own
   * sequence rather than of the fleet.
   */
  const runIdentityChecks = useCallback(async () => {
    if (verifying || running || selectedCount === 0) return;
    const chosen = models.filter((m) => checked[m.id]);
    const controller = new AbortController();
    abortRef.current = controller;
    setVerifying(true);
    // Cleared, not pre-filled: a row is marked "Probing" by its own task when
    // that task actually starts (see both passes below). Flagging the whole
    // cohort up front would spin nine rows while a sequential run has exactly
    // one request in flight — a false reading of the tool's own work.
    setIdentityRunning({});

    const activeConfig = getEffectiveConfig();

    // Pass one: collect token counts so the cohort can calibrate itself. These
    // calls are free and unmetered, so this costs nothing but a little latency,
    // and it is what lets the tokenizer signal work without a baked-in
    // constant. Only meaningful with two or more models selected.
    setProgress({ done: 0, total: chosen.length * 2 });
    const counts: number[] = [];
    await forEachModel(chosen, concurrent, controller.signal, async (model) => {
      // Same rule as pass two: the row spins while its own request is out and
      // stops when it lands, so the table never claims more work is in flight
      // than there is. Sequentially the flag walks down the list; concurrently
      // every row lights at once.
      setIdentityRunning((prev) => ({ ...prev, [model.id]: true }));
      const outcome = await countTokens({
        config: activeConfig,
        model: model.id,
        signal: controller.signal,
      });
      setIdentityRunning((prev) => ({ ...prev, [model.id]: false }));
      if (controller.signal.aborted) return;
      // Order does not matter here — the baseline is the cohort's median — so
      // concurrent pushes are safe.
      if (outcome.count !== null) counts.push(outcome.count);
      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
    });
    // A barrier either way: the baseline is that median, so it cannot be
    // computed until every count is in.
    const baseline = chosen.length > 1 ? tokenizerBaseline(counts) : null;

    // Optional pass: the random-number distributional fingerprint. Sample every
    // model once, then take the cohort median as the baseline each model is
    // scored against — a model whose distribution diverges from its siblings is
    // being served differently, whatever the provider calls it. Sampled here so
    // the same draws feed both the baseline and each model's score.
    const fingerprints: Record<string, { distribution: number[]; attempted: number; parsed: number }> = {};
    let fingerprintBaseline: number[] | null = null;
    if (deepFingerprint) {
      await forEachModel(chosen, concurrent, controller.signal, async (model) => {
        setIdentityRunning((prev) => ({ ...prev, [model.id]: true }));
        const sampled = await sampleRandomNumbers({
          config: activeConfig,
          signal: controller.signal,
          model: model.id,
          n: 40,
        });
        setIdentityRunning((prev) => ({ ...prev, [model.id]: false }));
        if (controller.signal.aborted) return;
        fingerprints[model.id] = {
          distribution: histogram(sampled.samples),
          attempted: sampled.attempted,
          parsed: sampled.parsed,
        };
      });
      // Only meaningful with a cohort to compare within.
      fingerprintBaseline =
        chosen.length > 1
          ? medianDistribution(Object.values(fingerprints).map((f) => f.distribution))
          : null;
    }
    // Learn the cutoff from how much the cohort's own members scatter, rather
    // than a fixed constant a small sample would trip — see cohortDivergenceThreshold.
    const fingerprintThreshold =
      fingerprintBaseline !== null
        ? cohortDivergenceThreshold(
            Object.values(fingerprints).map((f) => f.distribution),
            fingerprintBaseline,
          )
        : null;

    // Pass two: the actual probes, scored against that baseline.
    const localReports: IdentityReport[] = [];
    await forEachModel(chosen, concurrent, controller.signal, async (model) => {
      // Marked here rather than up front so "Probing" means this model's probe
      // is in flight right now. Sequentially that is one row at a time;
      // concurrently it is all of them, which is what the toggle asked for.
      setIdentityRunning((prev) => ({ ...prev, [model.id]: true }));
      const report = await verifyModelIdentity({
        config: activeConfig,
        model: model.id,
        signal: controller.signal,
        tokenizerBaseline: baseline,
        attribute: true,
        fingerprintDistribution: fingerprints[model.id] ?? null,
        fingerprintBaseline,
        fingerprintThreshold,
      });
      setIdentityRunning((prev) => ({ ...prev, [model.id]: false }));
      if (controller.signal.aborted) return;
      localReports.push(report);
      setIdentities((prev) => ({ ...prev, [model.id]: report }));
      setProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : null));
    });

    // Stylometry post-pass: writing-style fingerprints from text the runs
    // already produced, so it costs zero extra requests. Cohort-relative like
    // the tokenizer and random-number signals — each model's style vector is
    // scored against the median of its siblings on this same endpoint, and
    // the "too different" bar is learned from the cohort's own spread. Where
    // it fires, the verdict is re-aggregated with the new signal included.
    if (localReports.length > 1 && !controller.signal.aborted) {
      const measured = localReports
        .map((report) => {
          const text = report.runs
            .filter((r) => !r.error && r.text.trim() !== '')
            .map((r) => r.text)
            .join('\n');
          return { report, vector: styleFeatures(text), chars: text.length };
        })
        .filter((m): m is { report: IdentityReport; vector: number[]; chars: number } => m.vector !== null);

      const styleBaseline = measured.length > 1 ? medianStyleVector(measured.map((m) => m.vector)) : null;
      const styleThreshold =
        styleBaseline !== null ? cohortStyleThreshold(measured.map((m) => m.vector), styleBaseline) : null;

      if (styleBaseline !== null && styleThreshold !== null) {
        for (const { report, vector, chars } of measured) {
          const divergence = styleDivergence(vector, styleBaseline);
          report.stylometry = { divergence, threshold: styleThreshold, chars, baselineSource: 'cohort-median' };
          report.signals.push(styleSignal(report.stylometry));
          const { verdict, confidence } = aggregateVerdict(report.signals, {
            vendor: report.attribution?.vendorMismatch,
            family: report.attribution?.familyMismatch,
          });
          report.verdict = verdict;
          report.confidence = confidence;
        }
        setIdentities((prev) => {
          const next = { ...prev };
          for (const { report } of measured) next[report.modelId] = report;
          return next;
        });
      }
    }

    setIdentityRunning({});
    setVerifying(false);
    abortRef.current = null;
  }, [getEffectiveConfig, models, checked, verifying, running, selectedCount, concurrent, deepFingerprint]);

  /** Verdict tallies for the summary strip. */
  const identitySummary = useMemo(() => {
    const reports = Object.values(identities);
    return {
      total: reports.length,
      matches: reports.filter((r) => r.verdict === 'matches-advertised' || r.verdict === 'likely-advertised').length,
      // Right vendor, wrong tier. Counted on its own — folding it into either
      // bucket would hide exactly the case the check exists to catch.
      wrongTier: reports.filter((r) => r.verdict === 'wrong-tier').length,
      mismatched: reports.filter(
        (r) => r.verdict === 'different-vendor' || r.verdict === 'likely-mismatch' || r.verdict === 'mismatch',
      ).length,
      unclear: reports.filter((r) => r.verdict === 'ambiguous' || r.verdict === 'error').length,
    };
  }, [identities]);

  // Serialize the current identity run into a shareable, key-free Markdown
  // receipt and trigger a download. Only the endpoint host is recorded.
  const exportReceipt = useCallback(() => {
    const reports = Object.values(identities);
    if (reports.length === 0) return;
    const endpoint = getEffectiveConfig().endpoint;
    const input = { endpoint, reports, at: Date.now() };
    downloadFile(receiptFilename(input), buildReceiptMarkdown(input), 'text/markdown');
  }, [identities, getEffectiveConfig]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setVerifying(false);
    setIdentityRunning({});
  }, []);

  /* Request trace: the apiClient records every provider call's two hops as
     they happen; the console below renders the live tail. Subscribe once —
     the store is module-level, so it survives re-renders and shared nothing
     else. */
  const [traces, setTraces] = useState<readonly RequestTrace[]>([]);
  useEffect(() => subscribeToTraces(setTraces), []);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveStatus('');
    setCliTestStatus({status: 'idle'});

    try {
      const activeConfig = getEffectiveConfig();
      const apiRoute = saveTarget === 'opencode' ? '/api/save-opencode' : '/api/save-settings';
      const targetLabel = saveTarget === 'opencode' ? '~/.opencode/config.json' : '~/.claude/settings.json';
      const toolLabel = saveTarget === 'opencode' ? 'OpenCode' : 'Claude Code';
      const res = await fetch(apiRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { ...activeConfig, apiKey: activeConfig.apiKey, endpoint: getEffectiveEndpoint(activeConfig.endpoint, activeConfig.appendV1 ?? true) },
          mappings,
          remark: remark.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
        setSaveStatus(
          `Saved to ${targetLabel} — restart ${toolLabel} (new terminal session) to apply.` +
          (warnings.length ? ` Note: ${warnings.join(' ')}` : ''),
        );
      } else {
        const err = await res.json();
        setSaveStatus('Error: ' + (err.error || 'Failed to save configuration'));
      }
    } catch (e: any) {
      setSaveStatus('Network error: ' + (e?.message || 'Could not reach the server to save settings.'));
    }
    setSaving(false);
  }, [getEffectiveConfig, mappings, remark, saveTarget]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const copyToClipboard = useCallback(async (text: string, label = 'Copied to clipboard') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      showToast(label);
    } catch {
      showToast('Clipboard unavailable — select and copy manually');
    }
  }, [showToast]);

  // The exact ~/.claude/settings.json a user can paste by hand — real endpoint,
  // real key, real model mappings. Mirrors what /api/save-settings writes, so
  // "copy" and "save" produce the same result. This is what makes the tool work
  // when hosted (e.g. on Vercel), where the app cannot write local files.
  const claudeSettingsJson = useMemo(() => {
    const endpoint = saveEndpoint || config.endpoint;
    const apiKey = saveApiKey || config.apiKey;
    const filtered = Object.fromEntries(
      Object.entries(mappings).filter(([, v]) => v),
    ) as Partial<Record<'opus' | 'sonnet' | 'haiku' | 'fable', string>>;
    return buildClaudeSettingsJson({
      endpoint,
      apiKey,
      authStyle: config.authStyle,
      mappings: filtered,
    });
  }, [saveEndpoint, saveApiKey, config.endpoint, config.apiKey, config.authStyle, mappings]);

  /** Verdicts that mean the model served was not the one advertised. */
  const SUSPECT_VERDICTS = useMemo(
    () => new Set(['wrong-tier', 'different-vendor', 'likely-mismatch', 'mismatch']),
    [],
  );

  const suspectCount = useMemo(
    () => Object.values(identities).filter((r) => SUSPECT_VERDICTS.has(r.verdict)).length,
    [identities, SUSPECT_VERDICTS],
  );

  // Filtered models list
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const matchesSearch = searchQuery === '' || m.id.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      const res = results[m.id];
      if (filterStatus === 'passed') return res?.status === 'pass' || res?.status === 'partial';
      if (filterStatus === 'failed') return res?.status === 'fail';
      // The headline question: which of these is not what it says it is.
      if (filterStatus === 'suspect') {
        const verdict = identities[m.id]?.verdict;
        return verdict !== undefined && SUSPECT_VERDICTS.has(verdict);
      }
      return true;
    });
  }, [models, searchQuery, filterStatus, results, identities, SUSPECT_VERDICTS]);

  const sortedModels = useMemo(() => {
    const list = [...filteredModels];
    if (sortBy === 'latency') {
      list.sort((a, b) => {
        const ra = results[a.id];
        const rb = results[b.id];
        return (ra?.latencyMs ?? Infinity) - (rb?.latencyMs ?? Infinity);
      });
    } else if (sortBy === 'status') {
      const order: Record<string, number> = { pass: 0, partial: 1, fail: 2, running: 3, pending: 4 };
      list.sort((a, b) => {
        const sa = order[results[a.id]?.status ?? 'pending'] ?? 4;
        const sb = order[results[b.id]?.status ?? 'pending'] ?? 4;
        return sa - sb;
      });
    }
    return list;
  }, [filteredModels, sortBy, results]);

  /** Detect image-generation models by keywords in their ID. */
  const isImageModel = useCallback((id: string): boolean => {
    const lower = id.toLowerCase();
    const IMAGE_KEYWORDS = [
      'image', 'img', 'dall-e', 'dalle', 'stable-diffusion', 'sdxl', 'sd3',
      'flux', 'midjourney', 'kandinsky', 'playground', 'ideogram', 'recraft',
      'vision-gen', 'imagen', 'pixart', 'cogview', 'wanx', 'gpt-image',
    ];
    return IMAGE_KEYWORDS.some((kw) => lower.includes(kw));
  }, []);

  const tabbedModels = useMemo(() => {
    if (modelTab === 'all') return sortedModels;
    if (modelTab === 'img') return sortedModels.filter((m) => isImageModel(m.id));
    return sortedModels.filter((m) => !isImageModel(m.id)); // 'text'
  }, [sortedModels, modelTab, isImageModel]);

  const imgModelCount = useMemo(() => sortedModels.filter((m) => isImageModel(m.id)).length, [sortedModels, isImageModel]);
  const textModelCount = useMemo(() => sortedModels.length - imgModelCount, [sortedModels, imgModelCount]);

  const avgLatency = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const m of models) {
      const r = results[m.id];
      if (r && (r.status === 'pass' || r.status === 'partial') && r.latencyMs) {
        total += r.latencyMs;
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : null;
  }, [models, results]);

  const topThroughput = useMemo(() => {
    let best = 0;
    for (const m of models) {
      const r = results[m.id];
      if (r && (r.status === 'pass' || r.status === 'partial') && r.tokensPerSec) {
        if (r.tokensPerSec > best) best = r.tokensPerSec;
      }
    }
    return best > 0 ? Number(best.toFixed(1)) : null;
  }, [models, results]);



  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (conn === 'connected' && selectedCount > 0 && !running) void runTests();
      else if (conn !== 'connected' && conn !== 'connecting') void connect();
    }
  }

  const toggleModel = useCallback((id: string, next: boolean) => {
    setChecked((prev) => ({ ...prev, [id]: next }));
  }, []);

  return (
    <div className={styles.shell} onKeyDown={onKeyDown}>
      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          <Check size={15} aria-hidden="true" /> {toast}
        </div>
      )}
      <main className={styles.main} data-stage={conn === 'connected' ? 'readings' : 'setup'}>
        {/* Sidebar Controls */}
        <div className={`${styles.sidebar}${!sidebarOpen ? ` ${styles.sidebarCollapsed}` : ''}`}>
          <div className={styles.appHeader}>
            <div className={styles.headerTop}>
              <h1 className={styles.title}>
                <Zap size={15} aria-hidden="true" /> truemodel.tech
              </h1>
              <div className={styles.headerNav}>
                <a
                  href="https://github.com/pavandoescode/truemodel"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.sidebarToggle}
                  aria-label="View source on GitHub"
                  title="View source on GitHub"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
                  </svg>
                </a>
                <button
                  type="button"
                  className={styles.sidebarToggle}
                  onClick={() => setSidebarOpen(v => !v)}
                  aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                >
                  {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
              </div>
            </div>
            <p className={styles.subtitle}>
              Find out which model an endpoint really serves, benchmark it, and write a working
              config for Claude Code CLI at <code className="mono">~/.claude/settings.json</code>.
            </p>
            {/* Closes the card: the method is the thing people ask about first, and
                the header survives sidebar collapse, so this link stays reachable. */}
            <Link href="/how-it-works" className={styles.headerLink}>
              <BookOpen size={13} aria-hidden="true" /> How it works — the method, and its limits
              <ChevronRight size={13} aria-hidden="true" />
            </Link>
          </div>

          {/* Saved key status — configure it on the Settings page. */}
          <div className={styles.providerToggle}>
            <div className={styles.providerToggleHeader}>
              <span className={styles.providerToggleLabel}>Saved API Key</span>
              <Link href="/settings" className={styles.providerToggleLink}>
                <Settings size={13} /> Configure
              </Link>
            </div>
            <span className={styles.providerToggleHint}>
              {isClaudeActive
                ? `Using ${settings.claudeConfig?.model || 'the endpoint’s own model list'} from Settings · endpoint and key are locked below`
                : 'No saved key — enter an endpoint and key below, or save one in Settings'}
            </span>
          </div>

          <ConnectionPanel
            config={config}
            onPatch={patch}
            isClaudeActive={isClaudeActive}
            conn={conn}
            detected={detected}
            connError={connError}
            showKey={showKey}
            onShowKey={setShowKey}
            persistKey={persistKey}
            onPersistKey={setPersistKey}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
            profileCount={profiles.length}
            onManageProviders={() => setIsProvidersModalOpen(true)}
          />
        </div>

        {/* Main Content Dashboard */}
        <div className={styles.content}>
          <section className="card anim-slide-up glass-panel">
            <div className="card-head row-between">
              <div className={styles.headActions}>
                <h2 className="card-title">
                  <ListChecks size={15} aria-hidden="true" /> Model testing
                </h2>
              </div>
              <div className={styles.headActions}>
                {conn === 'connected' && models.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setSaveStatus('');
                      setCliTestStatus({status: 'idle'});
                      // DO NOT snapshot endpoint/apiKey here — use live values from the form
                      setRemark('');
                      // Sync modal preview fields with current config
                      setSaveEndpoint(config.endpoint);
                      setSaveApiKey(config.apiKey);
                      // Smart pre-fill from tested models if mappings not set
                      setMappings((current) => {
                        const updated = { ...current };
                        for (const alias of ['sonnet', 'haiku', 'opus', 'fable'] as const) {
                          if (!updated[alias]) {
                            const match = testedModelsForMapping.find((m) =>
                              m.id.toLowerCase().includes(alias),
                            );
                            if (match) updated[alias] = match.id;
                          }
                        }
                        return updated;
                      });
                      setIsModalOpen(true);
                    }}
                  >
                    <Save size={15} aria-hidden="true" /> Save to Claude Code settings
                  </button>
                )}
              </div>
            </div>

            <div className={styles.body}>
              {conn === 'connecting' ? (
                <ul className={styles.modelList}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <li key={i} className={styles.skeletonCard} />
                  ))}
                </ul>
              ) : conn === 'connected' ? (
                <>
                  {/* Dashboard Metrics */}
                  <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>Total Models</span>
                      <span className={styles.metricValue}>{models.length}</span>
                      <div className={styles.statBar}>
                        <div
                          className={styles.statBarFill}
                          style={{ width: `${testedCount ? Math.round((passedCount / testedCount) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>Passed Tests</span>
                      <span className={`${styles.metricValue} ${styles.statPass}`}>{passedCount}</span>
                      <span className="hint">{testedCount - passedCount} Failed</span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>Avg Latency</span>
                      <span className={styles.metricValue}>{avgLatency ? `${avgLatency} ms` : '--'}</span>
                      <span className="hint">Lower is better</span>
                    </div>
                    <div className={styles.metricCard}>
                      <span className={styles.metricLabel}>Top Throughput</span>
                      <span className={styles.metricValue}>{topThroughput ? `${topThroughput} t/s` : '--'}</span>
                      <span className="hint">Tokens per second</span>
                    </div>
                  </div>

                  {/* Search and Filters */}
                  <div className={styles.searchFilterRow}>
                    <div className={styles.searchGroup}>
                      <Search size={15} className={styles.searchIcon} aria-hidden="true" />
                      <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Search models by name or vendor ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          className={styles.clearSearch}
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className={styles.filterGroup}>
                      <CustomSelect
                        className={styles.filterSelect}
                        value={filterStatus}
                        onChange={(val) => setFilterStatus(val as any)}
                        options={[
                          { value: 'all', label: `All Models (${models.length})` },
                          { value: 'passed', label: `Passed (${passedCount})` },
                          { value: 'failed', label: `Failed (${testedCount - passedCount})` },
                          { value: 'suspect', label: `Not as advertised (${suspectCount})` }
                        ]}
                      />
                      <CustomSelect
                        className={styles.sortSelect}
                        value={sortBy}
                        onChange={(val) => setSortBy(val as any)}
                        aria-label="Sort models"
                        options={[
                          { value: 'name', label: 'Sort: Name' },
                          { value: 'latency', label: 'Sort: Latency' },
                          { value: 'status', label: 'Sort: Status' }
                        ]}
                      />
                      <div className={styles.filterActions}>
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => setChecked(Object.fromEntries(filteredModels.map((m) => [m.id, true])))}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="btn-text"
                          onClick={() => {
                            const passedMap: Record<string, boolean> = {};
                            models.forEach((m) => {
                              if (results[m.id]?.status === 'pass' || results[m.id]?.status === 'partial') {
                                passedMap[m.id] = true;
                              }
                            });
                            setChecked(passedMap);
                          }}
                        >
                          Passed
                        </button>
                        <button type="button" className="btn-text" onClick={() => setChecked({})}>
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Prompt & Run Controls */}
                  <div className={styles.field}>
                    <div className={styles.promptHead}>
                      <label className="label" htmlFor="prompt">Prompt (sent to every selected model)</label>
                      {/* One preset, to put the reachability prompt back after the
                          box has been edited. Identity is not asked for here — that
                          is what Identify models does, with checks a prompt cannot
                          fake. */}
                      <div className={styles.presets} role="group" aria-label="Prompt preset">
                        <button
                          type="button"
                          className={`btn btn-ghost btn-sm ${styles.preset}`}
                          aria-pressed={prompt === DEFAULT_PROMPT}
                          onClick={() => setPrompt(DEFAULT_PROMPT)}
                        >
                          Reachability
                        </button>
                      </div>
                    </div>
                    <textarea
                      id="prompt"
                      className={`textarea ${styles.prompt}`}
                      value={prompt}
                      rows={2}
                      spellCheck={false}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                    <div className={styles.testBar}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={running || verifying || selectedCount === 0 || prompt.trim() === ''}
                        onClick={() => void runTests()}
                      >
                        {running ? <span className="spinner" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                        {running ? 'Testing…' : `Test ${selectedCount} selected`}
                      </button>
                      {/* Separate from Test: this sends a fixed probe three times
                          per model and ignores the prompt box entirely. */}
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={running || verifying || selectedCount === 0}
                        onClick={() => void runIdentityChecks()}
                        title="Work out which model each id actually serves: fixed puzzles, a tokenizer probe, the endpoint's own model name, its enforced output ceiling, and a dated-knowledge probe"
                      >
                        {verifying ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          <Fingerprint size={15} aria-hidden="true" />
                        )}
                        {verifying ? 'Identifying…' : 'Identify models'}
                      </button>
                      {/* Applies to both runners above, so it is worded for both.
                          Identify fires roughly nine requests per model, which is
                          where a rate limit gets hit first — hence the warning. */}
                      <label
                        className={`row hint ${styles.concurrentToggle}`}
                        title="Send all selected models at once instead of one after another. Faster, but an endpoint with a low rate limit will start returning 429s — which read as failures, not as throttling."
                      >
                        <input
                          type="checkbox"
                          checked={concurrent}
                          onChange={(e) => setConcurrent(e.target.checked)}
                          disabled={running || verifying}
                        />
                        Run concurrently
                      </label>
                      <label
                        className={`row hint ${styles.concurrentToggle}`}
                        title="Fire ~40 extra single-token requests per model to build its 'random number' distribution and compare it against the cohort. Catches a substitution the model can't hide behind a system prompt — but it is slow and adds request volume."
                      >
                        <input
                          type="checkbox"
                          checked={deepFingerprint}
                          onChange={(e) => setDeepFingerprint(e.target.checked)}
                          disabled={running || verifying}
                        />
                        Deep fingerprint (slower)
                      </label>
                      {(running || verifying) && (
                        <button type="button" className="btn btn-danger" onClick={stop}>
                          Stop
                        </button>
                      )}
                      {progress && (
                        <span className="hint" role="status">
                          {progress.done} of {progress.total} tested · {testedCount} completed
                        </span>
                      )}
                      <span className={`subtle ${styles.shortcutHint}`}>
                        <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span>
                      </span>
                    </div>
                  </div>

                  {progress && (
                    <div className="progress" role="status" aria-live="polite">
                      <div
                        className="progress-bar"
                        style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                      />
                    </div>
                  )}

                  {/* Signature element — appears once there are readings to plot. */}
                  {latencyPoints.length > 1 && (
                    <div className={styles.spreadSlot}>
                      <LatencySpread points={latencyPoints} />
                    </div>
                  )}

                  {/* Model Type Tabs */}
                  <div className={styles.modelTabs} role="tablist" aria-label="Model type">
                    <button
                      type="button"
                      role="tab"
                      className={`${styles.modelTab} ${modelTab === 'text' ? styles.modelTabActive : ''}`}
                      aria-selected={modelTab === 'text'}
                      onClick={() => setModelTab('text')}
                      onDoubleClick={() => {
                        const map: Record<string, boolean> = {};
                        sortedModels.filter((m) => !isImageModel(m.id)).forEach((m) => { map[m.id] = true; });
                        setChecked(map);
                      }}
                      title="Double-click to select all text models"
                    >
                      Text <span className={styles.modelTabCount}>{textModelCount}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`${styles.modelTab} ${modelTab === 'img' ? styles.modelTabActive : ''}`}
                      aria-selected={modelTab === 'img'}
                      onClick={() => setModelTab('img')}
                      onDoubleClick={() => {
                        const map: Record<string, boolean> = {};
                        sortedModels.filter((m) => isImageModel(m.id)).forEach((m) => { map[m.id] = true; });
                        setChecked(map);
                      }}
                      title="Double-click to select all image models"
                    >
                      Image <span className={styles.modelTabCount}>{imgModelCount}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      className={`${styles.modelTab} ${modelTab === 'all' ? styles.modelTabActive : ''}`}
                      aria-selected={modelTab === 'all'}
                      onClick={() => setModelTab('all')}
                      onDoubleClick={() => {
                        const map: Record<string, boolean> = {};
                        sortedModels.forEach((m) => { map[m.id] = true; });
                        setChecked(map);
                      }}
                      title="Double-click to select all models"
                    >
                      All <span className={styles.modelTabCount}>{sortedModels.length}</span>
                    </button>
                  </div>

                  {/* Verdict tallies: with 50 rows on screen, "which of these
                      are not what they claim" has to be answerable at a glance. */}
                  {identitySummary.total > 0 && (
                    <div className={styles.identitySummary} role="status" aria-live="polite">
                      <span className={styles.identityStat} data-tone="pass">
                        {identitySummary.matches} as advertised
                      </span>
                      {/* Only shown when non-zero: a standing "0 wrong tier" adds
                          noise to the common case where nothing is wrong. */}
                      {identitySummary.wrongTier > 0 && (
                        <span className={styles.identityStat} data-tone="fail">
                          {identitySummary.wrongTier} wrong tier
                        </span>
                      )}
                      <span className={styles.identityStat} data-tone="fail">
                        {identitySummary.mismatched} not as advertised
                      </span>
                      <span className={styles.identityStat} data-tone="partial">
                        {identitySummary.unclear} inconclusive
                      </span>
                      <span className="subtle">
                        of {identitySummary.total} {pluralize(identitySummary.total, 'model')} verified
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={exportReceipt}
                        title="Download a shareable evidence receipt (API key never included)"
                      >
                        <Download size={14} aria-hidden="true" /> Download evidence
                      </button>
                    </div>
                  )}

                  <ModelTable
                    models={tabbedModels}
                    results={results}
                    identities={identities}
                    identityRunning={identityRunning}
                    showIdentity={identitySummary.total > 0 || verifying}
                    checked={checked}
                    disabled={running || verifying}
                    onToggle={toggleModel}
                  />
                  {models.length > 0 && filteredModels.length === 0 && (
                    <div className={styles.emptyStateWrap}>
                      <Search size={28} className={styles.emptyIcon} aria-hidden="true" />
                      <h3 className={styles.emptyTitle}>No models match this filter</h3>
                      <p className={styles.emptySub}>
                        {models.length} {pluralize(models.length, 'model')} discovered. Clear the search or widen the filter to see them.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <GettingStarted />
              )}
            </div>
          </section>

          {/* Where every request actually went, live: browser → this app's
              route → the provider URL the route resolved, and what each hop
              cost. Appears with the first provider call of the session. */}
          <TraceConsole traces={traces} onClear={clearTraces} />

          <footer className={styles.footer}>
            <span className="subtle">
              Keys are proxied server-side and never saved unless explicitly requested. Generated configs strictly preserve your local settings.
            </span>
          </footer>
        </div>
      </main>

      {/* Providers Modal */}
      <Modal
        open={isProvidersModalOpen}
        onClose={() => setIsProvidersModalOpen(false)}
        width={800}
        labelledBy="providers-modal-title"
        title={
          <>
            <FolderOpen size={15} aria-hidden="true" /> Saved providers
            {profiles.length > 0 && <span className="badge">{profiles.length}</span>}
          </>
        }
        footer={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={openProfileForm}
            disabled={config.endpoint.trim() === ''}
            title="Save the current endpoint, key, remark and tested models as a profile"
          >
            <Plus size={15} aria-hidden="true" /> Save current
          </button>
        }
      >
        <div className={styles.profileBody}>
                {profileFormOpen && (
                  <form className={`${styles.profileForm} anim-fade`} onSubmit={(e) => { e.preventDefault(); submitProfile(); }}>
                    <div className={styles.field}>
                      <label className="label" htmlFor="profile-name">Profile name</label>
                      <input
                        id="profile-name"
                        className="input"
                        value={profileName}
                        spellCheck={false}
                        placeholder="e.g. FreeModel gateway"
                        onChange={(e) => setProfileName(e.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className="label" htmlFor="profile-remark">Remark <span className="hint">(optional)</span></label>
                      <textarea
                        id="profile-remark"
                        className="textarea"
                        rows={2}
                        value={profileRemark}
                        spellCheck={false}
                        placeholder="Free tier, ~20 req/min, expires Sep"
                        onChange={(e) => setProfileRemark(e.target.value)}
                      />
                    </div>
                    <label className={styles.persist}>
                      <input
                        type="checkbox"
                        checked={profileIncludeKey}
                        onChange={(e) => setProfileIncludeKey(e.target.checked)}
                      />
                      <span>Store the API key in this browser</span>
                    </label>
                    <span className="hint">
                      Will capture {profileModelCount} passing {pluralize(profileModelCount, 'model')} for one-click re-testing.
                    </span>
                    <div className={styles.profileFormActions}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setProfileFormOpen(false); setEditingProfileId(null); }}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary btn-sm">
                        <Save size={15} aria-hidden="true" /> Save profile
                      </button>
                    </div>
                  </form>
                )}

                {profileNotice && (
                  <div className={`${styles.profileNotice} anim-fade`} role="status">{profileNotice}</div>
                )}

                {profiles.length === 0 && !profileFormOpen ? (
                  <span className="hint">
                    No saved providers yet. Connect an endpoint, test some models, then “Save current” to reuse it in one click.
                  </span>
                ) : (
                  <ul className={styles.profileList}>
                    {profiles.map((p) => (
                      <li
                        key={p.id}
                        className={`${styles.profileItem}${appliedProfileId === p.id ? ` ${styles.profileItemActive}` : ''}`}
                      >
                        <div className={styles.profileMain}>
                          <div className={styles.profileTitleRow}>
                            <span className={styles.profileName}>{p.name}</span>
                            {appliedProfileId === p.id && <span className="badge badge-info">active</span>}
                          </div>
                          <span className={`hint mono ${styles.profileHost}`}>{profileHost(p)}</span>
                          {p.remark && <span className={styles.profileRemark}>{p.remark}</span>}
                          <div className={styles.profileMeta}>
                            <span className="badge badge-pass">{p.testedModels.length} tested</span>
                            {p.apiKey ? (
                              <span className="badge"><KeyRound size={12} aria-hidden="true" /> key saved</span>
                            ) : (
                              <span className="badge badge-fail">no key</span>
                            )}
                            {Object.values(p.mappings).some(Boolean) && (
                              <span className="badge">
                                {Object.entries(p.mappings).filter(([, v]) => v).map(([k]) => k).join('/')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={styles.profileActions}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => applyProfile(p)}
                            disabled={conn === 'connecting'}
                            title="Load into the dashboard and connect"
                          >
                            Apply
                          </button>
                          {pendingDeleteId === p.id ? (
                            <div className={styles.profileConfirm}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeProfile(p.id)}>
                                Delete?
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-icon"
                                onClick={() => setPendingDeleteId(null)}
                                aria-label={`Keep ${p.name}`}
                              >
                                <X size={14} aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <div className={styles.moreWrap}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm btn-icon"
                                onClick={() => setOpenMoreMenuId(openMoreMenuId === p.id ? null : p.id)}
                                aria-label={`More options for ${p.name}`}
                                aria-expanded={openMoreMenuId === p.id}
                                title="More options"
                              >
                                <MoreVertical size={15} aria-hidden="true" />
                              </button>

                              {openMoreMenuId === p.id && (
                                <div className={styles.dropdownMenu}>
                                  <button
                                    type="button"
                                    className={`btn btn-ghost btn-sm ${styles.menuItem}`}
                                    onClick={() => { openProfileForm(p.id); setOpenMoreMenuId(null); }}
                                  >
                                    <Pencil size={14} aria-hidden="true" /> Edit provider
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn btn-ghost btn-sm ${styles.menuItem} ${styles.menuItemDanger}`}
                                    onClick={() => { setPendingDeleteId(p.id); setOpenMoreMenuId(null); }}
                                  >
                                    <Trash2 size={14} aria-hidden="true" /> Delete provider
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      </Modal>

      {/* Model Mapping Modal (Save to ~/.claude/settings.json) */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        width={1200}
        labelledBy="save-config-title"
        title={
          <>
            <Save size={15} aria-hidden="true" /> Save configuration
          </>
        }
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            {/* Lives outside the <form>, so it submits by id. */}
            <button type="submit" form="save-config-form" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : <Save size={15} aria-hidden="true" />}
              {saving ? 'Saving…' : `Save to ${saveTarget === 'opencode' ? 'OpenCode' : 'Claude Code'}`}
            </button>
          </>
        }
      >
        <form id="save-config-form" onSubmit={(e) => { e.preventDefault(); void saveSettings(); }}>
              {/* Save Target Picker */}
              <SaveTargetPicker value={saveTarget} onChange={setSaveTarget} />

              <p className={styles.modalSub}>
                Drag tested models onto alias slots below. Each mapped alias resolves to the real model ID in your config.
                <br />
                <strong>Note:</strong> Only models that passed testing are available. Blank aliases are left unmapped.
              </p>

              <DragDropModelMapper
                models={testedModelsForMapping.map((m) => ({
                  id: m.id,
                  latencyMs: results[m.id]?.latencyMs,
                  tokensPerSec: results[m.id]?.tokensPerSec,
                }))}
                slots={saveTarget === 'opencode' ? OPENCODE_SLOTS : CLAUDE_CODE_SLOTS}
                mappings={mappings}
                onChange={(m) => setMappings(m as typeof mappings)}
              />

              {testedModelsForMapping.length === 0 && (
                <div className={styles.errorBox}>
                  <strong>No Tested Models Yet!</strong>
                  <span>Please run test checks on models first to select working models for mapping.</span>
                </div>
              )}

              <div className={`${styles.jsonPreview} ${styles.jsonPreviewWrap}`}>
                <span className="label">
                  {saveTarget === 'opencode'
                    ? 'Config Payload Preview:'
                    : 'Paste this into ~/.claude/settings.json:'}
                </span>
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm ${styles.copyBtn}`}
                  onClick={() =>
                    copyToClipboard(
                      saveTarget === 'opencode'
                        ? JSON.stringify(
                            {
                              endpoint: getEffectiveEndpoint(saveEndpoint || config.endpoint, config.appendV1 ?? true),
                              apiKey: saveApiKey ? `${saveApiKey.slice(0, 8)}…` : '(session key)',
                              mappings: Object.fromEntries(Object.entries(mappings).filter(([, v]) => v)),
                              remark: remark.trim() || undefined,
                            },
                            null,
                            2,
                          )
                        : claudeSettingsJson,
                      saveTarget === 'opencode'
                        ? 'Copied config payload'
                        : 'Copied settings.json — paste into ~/.claude/settings.json',
                    )
                  }
                  aria-label={copied ? 'Copied' : 'Copy to clipboard'}
                >
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{' '}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <pre className={styles.codePreview}>
                  {saveTarget === 'opencode'
                    ? JSON.stringify(
                        {
                          endpoint: getEffectiveEndpoint(saveEndpoint || config.endpoint, config.appendV1 ?? true),
                          apiKey: saveApiKey ? `${saveApiKey.slice(0, 8)}…` : '(session key)',
                          mappings: Object.fromEntries(Object.entries(mappings).filter(([, v]) => v)),
                          remark: remark.trim() || undefined,
                        },
                        null,
                        2,
                      )
                    : claudeSettingsJson}
                </pre>
                {saveTarget !== 'opencode' && (
                  <p className={styles.modalSub} style={{ marginTop: 8 }}>
                    Contains your real API key. Open <code className="mono">~/.claude/settings.json</code>,
                    paste, save, then restart Claude Code. Merge the <code className="mono">env</code> keys
                    if the file already has content.
                  </p>
                )}
              </div>

              {saveStatus && (
                <div className={styles.saveStatus}>
                  <span className={saveStatus.includes('Error') || saveStatus.includes('Network') ? styles.failText : styles.successText}>
                    {saveStatus}
                  </span>
                  {!saveStatus.includes('Error') && !saveStatus.includes('Network') && (
                    <div className={styles.saveStatusAction}>
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={async () => {
                          setCliTestStatus({status: 'running'});
                          try {
                            const res = await fetch('/api/test-cli', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ target: saveTarget })
                            });
                            const data = await res.json();
                            setCliTestStatus({
                              status: data.success ? 'success' : 'error',
                              output: data.output || data.error
                            });
                          } catch(e: any) {
                            setCliTestStatus({status: 'error', output: e.message});
                          }
                        }}
                        disabled={cliTestStatus.status === 'running'}
                      >
                        {cliTestStatus.status === 'running' ? <span className="spinner" /> : <Plug size={14} aria-hidden="true" />}
                        {cliTestStatus.status === 'running' ? ' Testing CLI…' : ` Test ${saveTarget === 'opencode' ? 'OpenCode' : 'Claude Code'} CLI`}
                      </button>
                      
                      {cliTestStatus.status !== 'idle' && cliTestStatus.status !== 'running' && (
                        <div className={styles.cliOutput}>
                          <pre className={styles.codePreview} data-tone={cliTestStatus.status === 'error' ? 'error' : 'ok'}>
                            <code>{cliTestStatus.output || 'No output.'}</code>
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
        </form>
      </Modal>
    </div>
  );
}
