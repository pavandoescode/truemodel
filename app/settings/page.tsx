'use client';

import { useSettings } from '@/context/SettingsContext';
import { ApiKeySettings } from '@/components/ApiKeySettings';
import { ChevronLeft, CheckCircle2, Minus } from 'lucide-react';
import Link from 'next/link';
import styles from './settings.module.css';

export default function SettingsPage() {
  const { isClaudeActive } = useSettings();

  return (
    <div className={styles.settingsContainer}>
      <header className={styles.header}>
        <Link href="/" className={styles.backButton} aria-label="Back to validator">
          <ChevronLeft size={20} />
          <span>Back to Validator</span>
        </Link>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Provider Status</h2>
            <div className={styles.statusBadges}>
              {isClaudeActive ? (
                <span className={styles.badgeClaude}>
                  <CheckCircle2 size={13} aria-hidden="true" /> Provider key saved
                </span>
              ) : (
                <span className={styles.badgeInactive}>
                  <Minus size={13} aria-hidden="true" /> No key saved
                </span>
              )}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Provider Configuration</h2>
            <p className={styles.sectionDescription}>
              Save an endpoint and key here to pre-fill the validator. Any provider speaking the
              Anthropic <code>/v1/messages</code> shape works, whoever&apos;s models it resells.
              Your key stays in this browser&apos;s local storage (lightly obfuscated, not encrypted) and is
              never sent anywhere except the provider you configure.
            </p>
          </div>
          <ApiKeySettings />
        </section>
      </main>
    </div>
  );
}
