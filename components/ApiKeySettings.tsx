'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSettings } from '@/context/SettingsContext';
import {
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Power,
  RotateCcw,
  KeyRound,
} from 'lucide-react';
import styles from './ApiKeySettings.module.css';

/**
 * Quick picks only. The empty id means "ask the endpoint what it serves", which
 * is the right default for a tool pointed at resellers whose catalogues we
 * cannot know in advance.
 */
const AVAILABLE_MODELS = [
  { id: '', name: 'Auto-detect', tier: 'recommended' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'fast' },
  { id: 'gpt-5', name: 'GPT-5', tier: 'openai' },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', tier: 'google' },
];

const ENDPOINT_PRESETS = [
  { id: 'anthropic', label: 'Anthropic', value: 'https://api.anthropic.com' },
  { id: 'openrouter', label: 'OpenRouter', value: 'https://openrouter.ai/api' },
  { id: 'custom', label: 'Custom', value: '' },
];

export function ApiKeySettings() {
  const {
    settings,
    isLoading,
    isClaudeActive,
    saveClaudeConfig,
    validateClaudeKey,
    disconnectClaude,
    updateSettings,
    resetAll,
  } = useSettings();

  const stored = settings.claudeConfig;

  const [localKey, setLocalKey] = useState(stored?.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [endpointPreset, setEndpointPreset] = useState('anthropic');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [model, setModel] = useState(stored?.model ?? AVAILABLE_MODELS[0].id);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Sync local form when stored config changes (e.g. after disconnect)
  useEffect(() => {
    setLocalKey(stored?.apiKey ?? '');
    setModel(stored?.model ?? AVAILABLE_MODELS[0].id);
    if (stored?.endpoint) {
      const match = ENDPOINT_PRESETS.find((p) => p.value === stored.endpoint);
      if (match) {
        setEndpointPreset(match.id);
      } else {
        setEndpointPreset('custom');
        setCustomEndpoint(stored.endpoint);
      }
    }
    setStatus('idle');
    setMessage('');
  }, [stored]);

  const effectiveEndpoint =
    endpointPreset === 'custom'
      ? customEndpoint.trim()
      : ENDPOINT_PRESETS.find((p) => p.id === endpointPreset)?.value ?? '';

  const handleTest = useCallback(async () => {
    setStatus('testing');
    setMessage('');
    const result = await validateClaudeKey(localKey, effectiveEndpoint, model);
    setStatus(result.ok ? 'ok' : 'error');
    setMessage(result.message);
  }, [localKey, effectiveEndpoint, model, validateClaudeKey]);

  const handleConnect = useCallback(async () => {
    setStatus('testing');
    setMessage('');
    const ok = await saveClaudeConfig(localKey, effectiveEndpoint, model);
    setStatus(ok ? 'ok' : 'error');
    setMessage(ok ? 'Saved. The validator will use this key and endpoint.' : 'Could not connect. Check the key and endpoint.');
  }, [localKey, effectiveEndpoint, model, saveClaudeConfig]);

  const handleDisconnect = useCallback(() => {
    disconnectClaude();
    setConfirmDisconnect(false);
    setStatus('idle');
    setMessage('Removed. No key is saved in this browser.');
  }, [disconnectClaude]);

  return (
    <div className={styles.settingsContainer}>
      {/* Saved-key status */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Power size={20} /> Saved Key
        </h2>
        <p className={styles.sectionDescription}>
          A saved key pre-fills the validator on the main page. Removing it only clears this
          browser&apos;s storage — nothing else on your machine is touched.
        </p>

        <div className={styles.statusRow}>
          <span
            className={`${styles.statusPill} ${
              isClaudeActive ? styles.statusPillClaude : styles.statusPillDefault
            }`}
          >
            <span className={styles.statusDot} />
            {isClaudeActive ? `Saved · ${stored?.model || 'auto-detect model'}` : 'No key saved'}
          </span>
          {isClaudeActive && (
            <button type="button" className={styles.linkBtn} onClick={() => setConfirmDisconnect(true)}>
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Provider configuration */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <KeyRound size={15} aria-hidden="true" /> Provider API Key
          <span className={styles.optionalTag}>Optional</span>
        </h2>
        <p className={styles.sectionDescription}>
          Stored locally in this browser only. Leave this empty if you just want to type a key
          straight into the validator each time.
        </p>

        {/* Endpoint */}
        <div className={styles.field}>
          <label className={styles.label}>Endpoint</label>
          <div className={styles.presets}>
            {ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.presetBtn} ${
                  endpointPreset === preset.id ? styles.presetBtnActive : ''
                }`}
                onClick={() => setEndpointPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {endpointPreset === 'custom' && (
            <input
              type="url"
              className={styles.input}
              placeholder="https://api.your-gateway.com"
              value={customEndpoint}
              onChange={(e) => setCustomEndpoint(e.target.value)}
            />
          )}
          {effectiveEndpoint && (
            <span className={styles.hint}>
              Requests go to <code>{effectiveEndpoint}/v1/messages</code>
            </span>
          )}
        </div>

        {/* Key */}
        <div className={styles.field}>
          <label htmlFor="api-key" className={styles.label}>
            API Key
          </label>
          <div className={styles.inputWrapper}>
            <input
              id="api-key"
              type={showKey ? 'text' : 'password'}
              value={localKey}
              onChange={(e) => {
                setLocalKey(e.target.value);
                setStatus('idle');
                setMessage('');
              }}
              placeholder="sk-ant-..."
              className={`${styles.input} ${status === 'ok' ? styles.inputSuccess : ''} ${
                status === 'error' ? styles.inputError : ''
              }`}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className={styles.toggleButton}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Model */}
        <div className={styles.field}>
          <label className={styles.label}>Model to validate against</label>
          <div className={styles.modelGrid}>
            {AVAILABLE_MODELS.map((m) => (
              <label key={m.id} className={styles.modelOption}>
                <input
                  type="radio"
                  name="claude-model"
                  value={m.id}
                  checked={model === m.id}
                  onChange={() => setModel(m.id)}
                  className={styles.radioInput}
                />
                <div className={styles.modelCard}>
                  <div className={styles.modelHeader}>
                    <span className={styles.modelName}>{m.name}</span>
                    <span className={styles.badge}>{m.tier}</span>
                  </div>
                  <span className={styles.modelId}>{m.id || 'whatever this endpoint lists'}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {message && (
          <div
            className={`${styles.message} ${
              status === 'ok' ? styles.messageSuccess : status === 'error' ? styles.messageError : ''
            }`}
            role="status"
          >
            {status === 'ok' && <CheckCircle2 size={16} />}
            {status === 'error' && <XCircle size={16} />}
            {message}
          </div>
        )}

        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.validateButton}
            onClick={handleConnect}
            disabled={isLoading || status === 'testing' || !localKey.trim() || !effectiveEndpoint}
          >
            {status === 'testing' ? (
              <>
                <Loader2 size={18} className={styles.spinner} /> Checking…
              </>
            ) : (
              <>
                <Check size={18} /> Validate &amp; Save
              </>
            )}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleTest}
            disabled={isLoading || status === 'testing' || !localKey.trim() || !effectiveEndpoint}
          >
            Test only
          </button>
        </div>
      </div>

      {/* Danger zone */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <RotateCcw size={20} /> Reset
        </h2>
        <p className={styles.sectionDescription}>
          Remove the stored key and clear everything this app keeps in your browser.
        </p>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={settings.rememberSettings}
            onChange={(e) => updateSettings({ rememberSettings: e.target.checked })}
            className={styles.checkboxInput}
          />
          <span>Remember these settings in this browser</span>
        </label>

        <div className={styles.actionRow}>
          <button type="button" className={styles.dangerButton} onClick={() => setConfirmDisconnect(true)}>
            <Power size={16} /> Remove saved key
          </button>
          <button type="button" className={styles.secondaryButton} onClick={resetAll}>
            <RotateCcw size={16} /> Reset everything
          </button>
        </div>
      </div>

      <div className={styles.infoBox}>
        <AlertCircle size={18} />
        <div>
          <strong>Browser-only.</strong> Saving a key here writes it to this browser&apos;s local
          storage (lightly obfuscated, not encrypted) and nowhere else. No system files, hosts
          entries, or certificates are touched. Removing it clears the stored value immediately.
        </div>
      </div>

      {/* Remove-key confirmation */}
      {confirmDisconnect && (
        <div className={styles.overlay} role="dialog" aria-modal="true">
          <div className={styles.dialog}>
            <h3 className={styles.dialogTitle}>Remove saved key?</h3>
            <p className={styles.dialogBody}>
              The key will be deleted from this browser — you can add it again anytime.
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </button>
              <button type="button" className={styles.dangerButton} onClick={handleDisconnect}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
