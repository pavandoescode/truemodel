'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { obfuscate, deobfuscate } from '@/lib/apiKeyConfig';

export interface ClaudeConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  isValid: boolean;
  lastValidated?: number;
}

export interface Settings {
  claudeConfig?: ClaudeConfig;
  rememberSettings: boolean;
}

interface SettingsContextType {
  settings: Settings;
  isLoading: boolean;
  /** A validated key is on file, so the dashboard should use it. */
  isClaudeActive: boolean;
  saveClaudeConfig: (key: string, endpoint: string, model: string) => Promise<boolean>;
  validateClaudeKey: (key: string, endpoint: string, model: string) => Promise<{ ok: boolean; message: string }>;
  disconnectClaude: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetAll: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'opencode-claude-settings';
const DEFAULT_SETTINGS: Settings = {
  rememberSettings: true,
};

/** Storage-only shape: records whether `claudeConfig.apiKey` was obfuscated on
 * the way out, so load doesn't have to guess from the string's contents.
 * Mirrors `StoredApiKeyConfig` in lib/apiKeyConfig.ts. */
interface StoredSettings extends Settings {
  __obfuscated?: boolean;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { __obfuscated, ...parsed } = JSON.parse(stored) as StoredSettings;
        // Only reverse the obfuscation the save effect actually applied.
        // Deobfuscating unconditionally would garble a plaintext key written
        // by an older build (deobfuscate returns '' on non-base64 input).
        if (__obfuscated && parsed.claudeConfig?.apiKey) {
          parsed.claudeConfig = {
            ...parsed.claudeConfig,
            apiKey: deobfuscate(parsed.claudeConfig.apiKey),
          };
        }
        setSettings(parsed);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    setMounted(true);
  }, []);

  // Save to storage whenever settings change
  useEffect(() => {
    if (!mounted) return;
    try {
      if (!settings.rememberSettings) {
        // Opting out has to drop whatever a previous opt-in already wrote,
        // otherwise the stored API key outlives the user unchecking the box.
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      // Obfuscate the API key before it touches localStorage. This is
      // XOR + base64 (see lib/apiKeyConfig.ts) — it deters casual reading
      // of the raw value, not a real encryption guarantee.
      const toStore: StoredSettings = settings.claudeConfig?.apiKey
        ? {
            ...settings,
            claudeConfig: {
              ...settings.claudeConfig,
              apiKey: obfuscate(settings.claudeConfig.apiKey),
            },
            __obfuscated: true,
          }
        : settings;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }, [settings, mounted]);

  const validateClaudeKey = useCallback(
    async (key: string, endpoint: string, model: string) => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/validate-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: key, endpoint, model }),
        });

        const data = await response.json();
        return {
          ok: response.ok,
          // The route reports failures in `error`, not `message`. Preferring the
          // generic string would hide the provider's own reason for refusing.
          message:
            data.message ||
            data.error ||
            (response.ok ? 'Key is valid!' : 'Invalid key or endpoint.'),
        };
      } catch (err) {
        return {
          ok: false,
          message: `Connection error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const saveClaudeConfig = useCallback(
    async (key: string, endpoint: string, model: string) => {
      setIsLoading(true);
      try {
        // Validate first
        const validation = await validateClaudeKey(key, endpoint, model);
        if (!validation.ok) {
          setIsLoading(false);
          return false;
        }

        // Save config
        setSettings((s) => ({
          ...s,
          claudeConfig: {
            apiKey: key,
            endpoint,
            model,
            isValid: true,
            lastValidated: Date.now(),
          },
        }));

        setIsLoading(false);
        return true;
      } catch (err) {
        console.error('Failed to save Claude config:', err);
        setIsLoading(false);
        return false;
      }
    },
    [validateClaudeKey]
  );

  const disconnectClaude = useCallback(() => {
    setSettings((s) => ({ ...s, claudeConfig: undefined }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const resetAll = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear storage:', e);
    }
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        isLoading,
        isClaudeActive: settings.claudeConfig?.isValid ?? false,
        saveClaudeConfig,
        validateClaudeKey,
        disconnectClaude,
        updateSettings,
        resetAll,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}
