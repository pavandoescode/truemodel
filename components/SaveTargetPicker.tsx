'use client';
import React from 'react';
import { Terminal, SquareCode } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from '@/app/page.module.css';

export type SaveTarget = 'claude-code' | 'opencode';

interface Props {
  value: SaveTarget;
  onChange: (target: SaveTarget) => void;
}

const TARGETS: { id: SaveTarget; label: string; Icon: LucideIcon; path: string }[] = [
  { id: 'claude-code', label: 'Claude Code', Icon: Terminal,   path: '~/.claude/settings.json' },
  { id: 'opencode',    label: 'OpenCode',    Icon: SquareCode, path: '~/.opencode/config.json' },
];

export function SaveTargetPicker({ value, onChange }: Props) {
  return (
    <div className={styles.saveTargetPicker}>
      {TARGETS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`${styles.saveTargetBtn} ${value === t.id ? styles.saveTargetActive : ''}`}
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
        >
          <span className={styles.saveTargetIcon}>
            <t.Icon size={18} aria-hidden="true" />
          </span>
          <div className={styles.saveTargetInfo}>
            <span className={styles.saveTargetLabel}>{t.label}</span>
            <span className={styles.saveTargetPath}>{t.path}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
